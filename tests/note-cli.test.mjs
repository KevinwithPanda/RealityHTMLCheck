import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

import { createNoteRunDirectory } from "../realitycheck/scripts/note-check.mjs";

const cli = resolve("realitycheck/scripts/audit.mjs");

function run(args) {
  return spawnSync(process.execPath, [cli, "note", ...args], { encoding: "utf8" });
}

function runAsync(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [cli, "note", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", rejectPromise);
    child.once("close", (status, signal) => resolvePromise({ status, signal, stdout, stderr }));
  });
}

test("note evidence directories remain immutable when two runs share a timestamp", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-note-run-id-"));
  try {
    const first = createNoteRunDirectory(root, "deadbeef", "20260827T001122333Z");
    writeFileSync(join(first.runDirectory, "report.html"), "first run", "utf8");
    const second = createNoteRunDirectory(root, "deadbeef", "20260827T001122333Z");
    assert.equal(first.runId, "20260827T001122333Z-deadbeef");
    assert.equal(second.runId, "20260827T001122333Z-deadbeef-001");
    assert.notEqual(first.runDirectory, second.runDirectory);
    assert.equal(readFileSync(join(first.runDirectory, "report.html"), "utf8"), "first run");
    assert.equal(existsSync(second.runDirectory), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("concurrent note processes publish one complete stable generation", { timeout: 30_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-note-concurrent-publish-"));
  try {
    const baselineNotes = join(root, "baseline-notes");
    const baselineOutput = join(root, "baseline-evidence");
    mkdirSync(baselineNotes);
    writeFileSync(join(baselineNotes, "baseline.html"), '<html><head><title>Baseline</title></head><body><h1>Baseline</h1><p>This intentionally incomplete baseline gives the real concurrent processes deterministic comparison evidence.</p></body></html>', "utf8");
    const baselineResult = run([baselineNotes, "--output", baselineOutput, "--language", "en"]);
    assert.equal(baselineResult.status, 0, `${baselineResult.stdout}\n${baselineResult.stderr}`);
    const baseline = join(baselineOutput, "latest.json");

    const output = join(root, "shared-evidence");
    const candidates = [];
    for (let candidate = 0; candidate < 6; candidate += 1) {
      const notes = join(root, `candidate-${candidate}`);
      mkdirSync(notes);
      for (let page = 0; page < 8; page += 1) {
        const name = `candidate-${candidate}-page-${page}.html`;
        writeFileSync(join(notes, name), `<html><head><title>Candidate ${candidate} page ${page}</title></head><body><h1>Candidate ${candidate} page ${page}</h1><p>TODO: this deliberately imperfect note makes each concurrently rendered evidence generation substantial and uniquely identifiable.</p><img src="missing-${candidate}-${page}.png"><script>window.candidate=${candidate}</script></body></html>`, "utf8");
      }
      const args = [notes, "--output", output, "--language", "en"];
      if (candidate % 2 === 0) args.push("--baseline", baseline);
      candidates.push(runAsync(args));
    }

    const results = await Promise.all(candidates);
    for (const result of results) {
      assert.equal(result.signal, null, `${result.stdout}\n${result.stderr}`);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    }

    const latestText = readFileSync(join(output, "latest.json"), "utf8");
    const latest = JSON.parse(latestText);
    const immutableRun = join(output, latest.id);
    assert.equal(readFileSync(join(output, "report.json"), "utf8"), latestText);
    assert.equal(readFileSync(join(immutableRun, "report.json"), "utf8"), latestText);
    assert.equal(readFileSync(join(output, "latest.html"), "utf8"), readFileSync(join(immutableRun, "report.html"), "utf8"));
    assert.equal(readFileSync(join(output, "repair-plan.md"), "utf8"), readFileSync(join(immutableRun, "repair-plan.md"), "utf8"));
    assert.equal(readFileSync(join(output, "repair-plan.zh-CN.md"), "utf8"), readFileSync(join(immutableRun, "repair-plan.zh-CN.md"), "utf8"));
    assert.match(latest.input.name, /^candidate-[0-5]$/);
    assert.match(readFileSync(join(output, "latest.html"), "utf8"), new RegExp(`${latest.input.name}-page-0\\.html`));
    assert.match(readFileSync(join(output, "repair-plan.md"), "utf8"), new RegExp(`${latest.input.name}-page-0\\.html`));

    if (latest.comparison) {
      assert.equal(readFileSync(join(output, "comparison.json"), "utf8"), readFileSync(join(immutableRun, "comparison.json"), "utf8"));
      assert.equal(readFileSync(join(output, "comparison.html"), "utf8"), readFileSync(join(immutableRun, "comparison.html"), "utf8"));
      assert.deepEqual(JSON.parse(readFileSync(join(output, "comparison.json"), "utf8")), latest.comparison);
    } else {
      assert.equal(existsSync(join(output, "comparison.json")), false);
      assert.equal(existsSync(join(output, "comparison.html")), false);
    }
    assert.deepEqual(readdirSync(output).filter((name) => name === ".stable-publish.lock" || name.endsWith(".tmp")), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stale-lock recovery contenders cannot delete a new publisher lock", { timeout: 30_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-note-stale-publish-lock-"));
  try {
    const output = join(root, "evidence");
    const lock = join(output, ".stable-publish.lock");
    mkdirSync(output);
    // Simulate termination between exclusive lock creation and owner metadata.
    writeFileSync(lock, "", "utf8");
    const old = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(lock, old, old);

    const contenders = [];
    for (let index = 0; index < 3; index += 1) {
      const notes = join(root, `recovery-candidate-${index}`);
      mkdirSync(notes);
      for (let page = 0; page < 6; page += 1) {
        writeFileSync(join(notes, `candidate-${index}-page-${page}.html`), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Recovery candidate ${index}</title></head><body><h1>Recovery candidate ${index}</h1><p>This complete note lets two stale-lock contenders overlap with a newly publishing process without corrupting stable evidence.</p></body></html>`, "utf8");
      }
      contenders.push(runAsync([notes, "--output", output, "--language", "en"]));
    }

    const results = await Promise.all(contenders);
    for (const result of results) assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const latestText = readFileSync(join(output, "latest.json"), "utf8");
    const latest = JSON.parse(latestText);
    const immutableRun = join(output, latest.id);
    assert.equal(readFileSync(join(output, "report.json"), "utf8"), latestText);
    assert.equal(readFileSync(join(immutableRun, "report.json"), "utf8"), latestText);
    assert.equal(readFileSync(join(output, "latest.html"), "utf8"), readFileSync(join(immutableRun, "report.html"), "utf8"));
    assert.equal(existsSync(lock), false);
    assert.equal(existsSync(join(output, ".stable-publish-recovery.lock")), false);
    assert.match(latest.input.name, /^recovery-candidate-[0-2]$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("note CLI checks a folder without a server, config, or upload", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-note-"));
  try {
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "assets", "chart.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>", "utf8");
    writeFileSync(join(root, "note.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Portable note</title></head><body><h1 id="note">Portable note</h1><p>This complete standalone note contains enough readable content to verify the simplest folder-first workflow without a Web server or configuration file.</p><img src="assets/chart.svg" alt="A chart"></body></html>`, "utf8");
    const output = join(root, "evidence");
    const result = run([root, "--output", output, "--language", "en"]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Checked 1 HTML note\(s\): 100\/100/);
    const latest = JSON.parse(readFileSync(join(output, "latest.json"), "utf8"));
    assert.equal(latest.kind, "html-note-check-bundle");
    assert.equal(latest.summary.score, 100);
    assert.deepEqual(latest.packageFindings, []);
    assert.equal(latest.packageSummary.findings, 0);
    assert.equal(latest.privacy.uploaded, false);
    assert.equal(latest.privacy.absolutePathsPersisted, false);
    assert.equal(latest.sourceModified, false);
    const html = readFileSync(join(output, "latest.html"), "utf8");
    assert.match(html, /RealityCheck Note Report/);
    assert.match(html, /data-language="zh-CN"/);
    assert.match(html, /checker did not upload or modify source notes/);
    assert.match(html, /Reports can contain bounded evidence excerpts/);
    assert.doesNotMatch(html, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    for (const stable of ["report.json", "repair-plan.md", "repair-plan.zh-CN.md"]) {
      assert.equal(existsSync(join(output, stable)), true, `missing stable ${stable}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("safe repair mode writes a new copy and leaves the source byte-for-byte unchanged", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-note-fix-"));
  try {
    const source = `<html><head><title>笔记</title></head><body><h1>笔记</h1><p>这是一篇具有足够正文的 HTML 笔记，用来证明修复流程只生成新的副本而不会覆盖来源文件。</p></body></html>`;
    const input = join(root, "note.html");
    const output = join(root, "evidence");
    writeFileSync(input, source, "utf8");
    const result = run([input, "--output", output, "--fix-safe"]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(readFileSync(input, "utf8"), source);
    const latest = JSON.parse(readFileSync(join(output, "latest.json"), "utf8"));
    const runDirectory = join(output, latest.id);
    const repaired = readFileSync(join(runDirectory, "repaired", "note.html"), "utf8");
    assert.match(repaired, /^<!doctype html>/);
    assert.match(repaired, /<html lang="zh-CN">/);
    assert.match(repaired, /<meta charset="utf-8">/);
    assert.match(repaired, /不会覆盖来源文件/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("agentic repair preparation copies the bounded note bundle and applies safe metadata fixes", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-note-prepare-"));
  try {
    const notes = join(root, "notes");
    mkdirSync(join(notes, "assets"), { recursive: true });
    const source = `<html><head><title>Portable bundle</title><link rel="stylesheet" href="assets/note.css"></head><body><h1>Portable bundle</h1><p>This folder has enough content to prove that Codex receives a complete repair working copy with its local resources.</p><a href="guide.html">Guide</a></body></html>`;
    writeFileSync(join(notes, "index.html"), source, "utf8");
    writeFileSync(join(notes, "guide.html"), "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Guide</title></head><body><h1>Guide</h1><p>This linked note remains inside the prepared repair bundle.</p></body></html>", "utf8");
    writeFileSync(join(notes, "assets", "note.css"), "body { max-width: 70rem; }", "utf8");
    writeFileSync(join(notes, "assets", "pixel.bin"), Buffer.from([0, 1, 2, 255]));
    const output = join(root, "evidence");
    const result = run([notes, "--output", output, "--prepare-repair", "--language", "en"]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Codex repair working copy:/);
    const latest = JSON.parse(readFileSync(join(output, "latest.json"), "utf8"));
    const repaired = join(output, latest.id, "repaired");
    const repairedEntry = readFileSync(join(repaired, "index.html"), "utf8");
    assert.match(repairedEntry, /^<!doctype html>/);
    assert.match(repairedEntry, /<html lang="en">/);
    assert.match(repairedEntry, /<meta charset="utf-8">/);
    assert.equal(readFileSync(join(notes, "index.html"), "utf8"), source);
    assert.equal(readFileSync(join(repaired, "assets", "note.css"), "utf8"), "body { max-width: 70rem; }");
    assert.deepEqual(readFileSync(join(repaired, "assets", "pixel.bin")), Buffer.from([0, 1, 2, 255]));
    assert.equal(existsSync(join(repaired, "guide.html")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("note CLI keeps the report when a requested quality threshold fails", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-note-gate-"));
  try {
    const input = join(root, "broken.html");
    const output = join(root, "evidence");
    writeFileSync(input, "<html><head></head><body><h1>TODO �</h1></body></html>", "utf8");
    const result = run([input, "--output", output, "--fail-on", "error", "--language", "en"]);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /error\(s\)/);
    const latest = JSON.parse(readFileSync(join(output, "latest.json"), "utf8"));
    assert.ok(latest.summary.counts.error > 0);
    assert.equal(latest.summary.status, "needs-fix");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("folder report uses the lowest file score so clean notes cannot hide a broken one", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-note-lowest-"));
  try {
    const clean = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Clean note</title></head><body><h1>Clean note</h1><p>This complete portable note has enough useful text for a clean deterministic check.</p></body></html>';
    for (let index = 0; index < 12; index += 1) writeFileSync(join(root, `clean-${index}.html`), clean, "utf8");
    writeFileSync(join(root, "broken.html"), "<html><body><h1>TODO �</h1></body></html>", "utf8");
    const output = join(root, "evidence");
    const result = run([root, "--output", output, "--language", "en"]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const latest = JSON.parse(readFileSync(join(output, "latest.json"), "utf8"));
    const lowest = Math.min(...latest.reports.map((report) => report.score));
    assert.equal(latest.summary.score, lowest);
    assert.equal(latest.summary.scoreBasis, "lowest-file");
    assert.equal(latest.summary.status, "needs-fix");
    assert.match(readFileSync(join(output, "latest.html"), "utf8"), /folder readiness · lowest file/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("note CLI checks CSS dependency chains and cross-document fragments", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-note-package-"));
  try {
    mkdirSync(join(root, "styles"));
    const metadata = '<meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Package note</title>';
    writeFileSync(join(root, "index.html"), `<!doctype html><html lang="en"><head>${metadata}<link rel="stylesheet" href="styles/main.css"></head><body><h1>Index</h1><p>This is a complete entry note with a linked section and local stylesheet.</p><a href="guide.html#missing">Guide section</a></body></html>`, "utf8");
    writeFileSync(join(root, "guide.html"), `<!doctype html><html lang="en"><head>${metadata}</head><body><h1 id="present">Guide</h1><p>This destination note has enough readable content for the package check.</p></body></html>`, "utf8");
    writeFileSync(join(root, "styles", "main.css"), '.hero{background:url("../images/missing.png")}', "utf8");
    const output = join(root, "evidence");
    const result = run([root, "--output", output, "--language", "en", "--fail-on", "error"]);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const latest = JSON.parse(readFileSync(join(output, "latest.json"), "utf8"));
    const rules = new Set(latest.packageFindings.map((finding) => finding.ruleId));
    assert.equal(rules.has("css-missing-local-file"), true);
    assert.equal(rules.has("broken-cross-document-fragment"), true);
    assert.equal(latest.reports.some((report) => report.findings.some((finding) => rules.has(finding.ruleId))), false);
    assert.equal(latest.reports.length, 2);
    assert.equal(latest.summary.files, 2);
    assert.equal(latest.packageSummary.status, "needs-fix");
    assert.equal(latest.summary.lowestFileScore, Math.min(...latest.reports.map((report) => report.score)));
    assert.equal(latest.summary.score, latest.summary.lowestFileScore - latest.packageSummary.scoreDeduction);
    assert.equal(latest.summary.status, "needs-fix");
    const reportHtml = readFileSync(join(output, "latest.html"), "utf8");
    assert.match(reportHtml, /FILE PACKAGE DEPENDENCIES/);
    assert.match(reportHtml, /Repair the following package-level dependencies/);
    const repairPlan = readFileSync(join(output, "repair-plan.md"), "utf8");
    assert.match(repairPlan, /## File package dependencies/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("note CLI discloses a reachable stylesheet above its safe read limit", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-note-large-css-"));
  try {
    const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Large style note</title><link rel="stylesheet" href="large.css"></head><body><h1>Large style note</h1><p>This note links a stylesheet whose contents cannot be safely inspected.</p></body></html>';
    writeFileSync(join(root, "index.html"), html, "utf8");
    writeFileSync(join(root, "large.css"), " ".repeat(5 * 1024 * 1024 + 1), "utf8");
    const output = join(root, "evidence");
    const result = run([root, "--output", output, "--language", "en"]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const latest = JSON.parse(readFileSync(join(output, "latest.json"), "utf8"));
    assert.equal(latest.summary.status, "review");
    assert.equal(latest.packageFindings.some((finding) => finding.ruleId === "package-content-not-verified"), true);
    assert.equal(latest.reports.some((report) => report.findings.some((finding) => finding.ruleId === "package-content-not-verified")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("note CLI help presents the zero-config boundary", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /realitycheck note <FILE\|DIRECTORY>/);
  assert.match(result.stdout, /never uploads files/);
  assert.match(result.stdout, /never overwrites the source note/);
  assert.match(result.stdout, /--prepare-repair/);
  assert.match(result.stdout, /--baseline PATH/);
});

test("note CLI baseline gates only new or worsened findings at the requested level", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-note-baseline-gate-"));
  try {
    const notes = join(root, "notes");
    mkdirSync(notes);
    const input = join(notes, "index.html");
    const baseHtml = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Known debt</title></head><body><h1>Known debt �</h1><p>This note intentionally keeps one known encoding error so the regression gate can prove that persistent debt does not keep CI red.</p></body></html>';
    writeFileSync(input, baseHtml, "utf8");
    const baselineOutput = join(root, "baseline-evidence");
    const baselineRun = run([notes, "--output", baselineOutput, "--language", "en"]);
    assert.equal(baselineRun.status, 0, `${baselineRun.stdout}\n${baselineRun.stderr}`);
    const baseline = join(baselineOutput, "latest.json");

    const warningHtml = baseHtml.replace("</head>", '<link rel="stylesheet" href="https://example.invalid/note.css"></head>');
    writeFileSync(input, warningHtml, "utf8");
    const errorThresholdOutput = join(root, "error-threshold");
    const errorThreshold = run([notes, "--output", errorThresholdOutput, "--baseline", baseline, "--fail-on", "error", "--language", "en"]);
    assert.equal(errorThreshold.status, 0, `${errorThreshold.stdout}\n${errorThreshold.stderr}`);
    assert.match(errorThreshold.stdout, /Baseline comparison: \d+ new, \d+ resolved, \d+ worsened, \d+ persistent, \d+ unverified/);
    const compared = JSON.parse(readFileSync(join(errorThresholdOutput, "latest.json"), "utf8"));
    assert.equal(compared.comparison.gate.failed, false);
    assert.equal(compared.comparison.regressionsByLevel.error, 0);
    assert.ok(compared.comparison.regressionsByLevel.warning > 0);
    assert.ok(compared.comparison.counts.persistent > 0);
    assert.equal(existsSync(join(errorThresholdOutput, "comparison.json")), true);
    assert.equal(existsSync(join(errorThresholdOutput, "comparison.html")), true);
    assert.equal(JSON.parse(readFileSync(join(errorThresholdOutput, "comparison.json"), "utf8")).kind, "html-note-check-comparison");
    const comparisonHtml = readFileSync(join(errorThresholdOutput, "comparison.html"), "utf8");
    assert.match(comparisonHtml, /Regression gate passed/);
    assert.match(comparisonHtml, /data-language="zh-CN"/);
    assert.doesNotMatch(comparisonHtml, /<script\s+src=/i);

    const warningThreshold = run([notes, "--output", join(root, "warning-threshold"), "--baseline", baseline, "--fail-on", "warning", "--language", "en"]);
    assert.equal(warningThreshold.status, 1, `${warningThreshold.stdout}\n${warningThreshold.stderr}`);

    writeFileSync(input, warningHtml.replace("Known debt �", "Known debt ��"), "utf8");
    const worsenedError = run([notes, "--output", join(root, "worsened-error"), "--baseline", baseline, "--fail-on", "error", "--language", "en"]);
    assert.equal(worsenedError.status, 1, `${worsenedError.stdout}\n${worsenedError.stderr}`);
    const worsened = JSON.parse(readFileSync(join(root, "worsened-error", "comparison.json"), "utf8"));
    assert.ok(worsened.counts.worsened > 0);
    assert.ok(worsened.regressionsByLevel.error > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("note CLI baseline cannot report a deleted HTML file as resolved", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-note-baseline-delete-"));
  try {
    const notes = join(root, "notes");
    mkdirSync(notes);
    const clean = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Kept note</title></head><body><h1>Kept note</h1><p>This complete note remains in the package while another baseline file is deliberately removed.</p></body></html>';
    writeFileSync(join(notes, "index.html"), clean, "utf8");
    writeFileSync(join(notes, "removed.html"), '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Removed note</title></head><body><h1>Removed �</h1><p>This note contains a finding that deletion must never disguise as a verified resolution.</p></body></html>', "utf8");
    const baselineOutput = join(root, "baseline");
    assert.equal(run([notes, "--output", baselineOutput]).status, 0);
    rmSync(join(notes, "removed.html"));
    const currentOutput = join(root, "current");
    const result = run([notes, "--output", currentOutput, "--baseline", join(baselineOutput, "latest.json"), "--fail-on", "error", "--language", "en"]);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const comparison = JSON.parse(readFileSync(join(currentOutput, "comparison.json"), "utf8"));
    assert.equal(comparison.resolved.some((item) => item.scope?.path === "removed.html"), false);
    const missing = comparison.unverified.find((item) => item.scope?.path === "removed.html");
    assert.ok(missing, JSON.stringify(comparison, null, 2));
    assert.equal(missing.reason, "html-scope-missing");
    assert.equal(missing.afterAffectedCount, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("note CLI error gate fails when clean HTML or otherwise-unreported package coverage disappears", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-note-baseline-coverage-"));
  try {
    const notes = join(root, "notes");
    mkdirSync(notes);
    const clean = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head><body><h1>${title}</h1><p>${body}</p></body></html>`;
    writeFileSync(join(notes, "index.html"), clean("Index", "This complete portable note remains available throughout the coverage regression proof."), "utf8");
    const removedHtml = clean("Clean companion", "This clean companion has no finding fingerprint, but deleting it must still fail baseline coverage.");
    writeFileSync(join(notes, "clean-companion.html"), removedHtml, "utf8");
    writeFileSync(join(notes, "unused.bin"), Buffer.from([1, 2, 3]));
    const baselineOutput = join(root, "baseline");
    assert.equal(run([notes, "--output", baselineOutput, "--language", "en"]).status, 0);
    const baseline = join(baselineOutput, "latest.json");

    rmSync(join(notes, "clean-companion.html"));
    const missingHtmlOutput = join(root, "missing-html");
    const missingHtml = run([notes, "--output", missingHtmlOutput, "--baseline", baseline, "--fail-on", "error", "--language", "en"]);
    assert.equal(missingHtml.status, 1, `${missingHtml.stdout}\n${missingHtml.stderr}`);
    const htmlComparison = JSON.parse(readFileSync(join(missingHtmlOutput, "comparison.json"), "utf8"));
    assert.equal(htmlComparison.counts.unverified, 1);
    assert.equal(htmlComparison.unverified[0].fingerprint, "html:clean-companion.html::coverage-scope");
    assert.equal(htmlComparison.unverified[0].details.syntheticCoverage, true);

    writeFileSync(join(notes, "clean-companion.html"), removedHtml, "utf8");
    rmSync(join(notes, "unused.bin"));
    const contractedOutput = join(root, "contracted-package");
    const contracted = run([notes, "--output", contractedOutput, "--baseline", baseline, "--fail-on", "error", "--language", "en"]);
    assert.equal(contracted.status, 1, `${contracted.stdout}\n${contracted.stderr}`);
    const packageComparison = JSON.parse(readFileSync(join(contractedOutput, "comparison.json"), "utf8"));
    assert.equal(packageComparison.counts.unverified, 1);
    assert.equal(packageComparison.unverified[0].fingerprint, "package::coverage-scope");
    assert.equal(packageComparison.unverified[0].reason, "package-scope-contracted");
    assert.equal(packageComparison.regressionsByLevel.error, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("note CLI accepts a legacy bundle but keeps ambiguous package changes unverified", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-note-legacy-baseline-"));
  try {
    const notes = join(root, "notes");
    mkdirSync(join(notes, "styles"), { recursive: true });
    writeFileSync(join(notes, "index.html"), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Legacy package</title><link rel="stylesheet" href="styles/main.css"></head><body><h1>Legacy package</h1><p>This note proves that old package findings are never converted into fake resolutions.</p></body></html>', "utf8");
    writeFileSync(join(notes, "styles", "main.css"), '.hero{background:url("../images/missing.png")}', "utf8");
    const firstOutput = join(root, "first");
    assert.equal(run([notes, "--output", firstOutput]).status, 0);
    const legacy = JSON.parse(readFileSync(join(firstOutput, "latest.json"), "utf8"));
    assert.ok(legacy.packageFindings.length > 0);
    legacy.reports[0].findings.push(...legacy.packageFindings);
    delete legacy.packageFindings;
    delete legacy.packageSummary;
    const legacyPath = join(root, "legacy-report.json");
    writeFileSync(legacyPath, JSON.stringify(legacy), "utf8");
    mkdirSync(join(notes, "images"));
    writeFileSync(join(notes, "images", "missing.png"), "restored", "utf8");
    const output = join(root, "current");
    const result = run([notes, "--output", output, "--baseline", legacyPath, "--fail-on", "error", "--language", "en"]);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const comparison = JSON.parse(readFileSync(join(output, "comparison.json"), "utf8"));
    assert.equal(comparison.warnings[0].code, "legacy-baseline-package-scope");
    assert.equal(comparison.resolved.some((item) => item.ruleId === "css-missing-local-file"), false);
    const uncertain = comparison.unverified.find((item) => item.ruleId === "css-missing-local-file");
    assert.ok(uncertain, JSON.stringify(comparison, null, 2));
    assert.equal(uncertain.reason, "legacy-baseline-package-scope");
    assert.match(result.stdout, /baseline predates independent package findings/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("note CLI rejects an invalid baseline as an operational error", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-note-invalid-baseline-"));
  try {
    const note = join(root, "note.html");
    const baseline = join(root, "baseline.json");
    writeFileSync(note, '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Note</title></head><body><h1>Note</h1><p>A complete note for strict baseline validation.</p></body></html>', "utf8");
    writeFileSync(baseline, '{"kind":"not-a-note"}', "utf8");
    const result = run([note, "--output", join(root, "output"), "--baseline", baseline]);
    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /schemaVersion 1 RealityCheck HTML note bundle/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

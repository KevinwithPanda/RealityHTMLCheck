import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import test from "node:test";

const cli = resolve("realitycheck/scripts/audit.mjs");

function run(args) {
  return spawnSync(process.execPath, [cli, "note", ...args], { encoding: "utf8" });
}

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
    assert.equal(latest.privacy.uploaded, false);
    assert.equal(latest.privacy.absolutePathsPersisted, false);
    assert.equal(latest.sourceModified, false);
    const html = readFileSync(join(output, "latest.html"), "utf8");
    assert.match(html, /RealityCheck Note Report/);
    assert.match(html, /data-language="zh-CN"/);
    assert.match(html, /No note content was uploaded/);
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
    const result = run([root, "--output", output, "--language", "en"]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const latest = JSON.parse(readFileSync(join(output, "latest.json"), "utf8"));
    const rules = new Set(latest.reports.flatMap((report) => report.findings.map((finding) => finding.ruleId)));
    assert.equal(rules.has("css-missing-local-file"), true);
    assert.equal(rules.has("broken-cross-document-fragment"), true);
    assert.equal(latest.summary.status, "needs-fix");
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
    assert.equal(latest.reports.some((report) => report.findings.some((finding) => finding.ruleId === "package-content-not-verified")), true);
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
});

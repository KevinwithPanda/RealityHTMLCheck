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

test("note CLI help presents the zero-config boundary", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /realitycheck note <FILE\|DIRECTORY>/);
  assert.match(result.stdout, /never uploads files/);
  assert.match(result.stdout, /never overwrites the source note/);
});

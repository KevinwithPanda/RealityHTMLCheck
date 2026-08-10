import assert from "node:assert/strict";
import test from "node:test";

import { analyzeHtmlNote, applySafeNoteFixes, buildRepairTask } from "../realitycheck/scripts/note-analyzer.mjs";

const healthyNote = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>研究笔记：本地优先的 HTML 工作流</title>
</head>
<body>
  <main>
    <h1 id="summary">研究笔记</h1>
    <p>这是一份完整的中文研究笔记，包含足够的正文内容，可以独立阅读、离线归档并安全分享给其他读者。</p>
    <h2 id="evidence">证据</h2>
    <p><a href="#summary">返回摘要</a></p>
    <img src="assets/chart.svg" alt="季度数据变化折线图">
  </main>
</body>
</html>`;

test("a portable and structured note receives a clean result", () => {
  const report = analyzeHtmlNote({
    path: "notes/research.html",
    html: healthyNote,
    knownFiles: ["notes/research.html", "notes/assets/chart.svg"],
  });
  assert.equal(report.score, 100);
  assert.equal(report.status, "ready");
  assert.deepEqual(report.counts, { error: 0, warning: 0, advice: 0, autoFixable: 0 });
  assert.equal(report.metrics.images, 1);
  assert.equal(report.metrics.localAssets, 1);
  assert.ok(report.metrics.words > 20);
});

test("AI-export and portability problems are explained with stable rules", () => {
  const broken = `<html>
  <head><title></title><style>main{min-width:900px}</style></head>
  <body onclick="start()"><main><section>
    <h1 id="same">Draft</h1><h3 id="same">TODO</h3>
    <a href="#missing">jump</a><a href="#">later</a><a href="javascript:steal()">run</a>
    <img src="missing/chart.png"><img src="C:\\Users\\me\\secret.png" alt="secret">
    <script src="http://cdn.example.invalid/note.js"></script>
    <table><tr><td>value</td></tr></table>
    <p>Broken replacement: �</p>
  </main></body>
  </html>`;
  const report = analyzeHtmlNote({ path: "draft.html", html: broken, knownFiles: ["draft.html"] });
  const rules = new Set(report.findings.map((finding) => finding.ruleId));
  for (const rule of [
    "encoding-replacement-character",
    "missing-doctype",
    "missing-document-language",
    "missing-charset",
    "missing-title",
    "unbalanced-container",
    "duplicate-id",
    "broken-fragment",
    "heading-level-skip",
    "image-missing-alt",
    "missing-local-file",
    "machine-specific-path",
    "insecure-remote-asset",
    "remote-dependency",
    "executable-script",
    "inline-event-handler",
    "javascript-link",
    "empty-link",
    "table-without-header",
    "missing-viewport",
    "wide-fixed-layout",
    "unfinished-placeholder",
  ]) assert.equal(rules.has(rule), true, `missing rule ${rule}`);
  assert.equal(report.status, "needs-fix");
  assert.ok(report.score < 50);
  assert.ok(report.counts.error >= 6);
  assert.ok(report.findings.every((finding) => finding.id.startsWith("NOTE-")));
  assert.ok(report.findings.every((finding) => finding.evidence.length <= 8));
});

test("a single-file browser check reports unverified attachments instead of fake missing files", () => {
  const report = analyzeHtmlNote({ path: "note.html", html: healthyNote, knownFiles: null });
  assert.equal(report.findings.some((finding) => finding.ruleId === "missing-local-file"), false);
  assert.equal(report.findings.some((finding) => finding.ruleId === "local-files-not-verified"), true);
});

test("path casing is portable only when the HTML and file agree exactly", () => {
  const report = analyzeHtmlNote({
    path: "index.html",
    html: healthyNote.replace("assets/chart.svg", "Assets/Chart.svg"),
    knownFiles: ["index.html", "assets/chart.svg"],
  });
  assert.equal(report.findings.some((finding) => finding.ruleId === "path-case-mismatch"), true);
  assert.equal(report.findings.some((finding) => finding.ruleId === "missing-local-file"), false);
});

test("safe fixes are conservative, downloadable, and idempotent", () => {
  const input = `<html><head><title>笔记</title></head><body><h1>笔记</h1><p>这是一段足够长的笔记正文，用于验证语言推断和安全修复不会覆盖原始内容。</p></body></html>`;
  const first = applySafeNoteFixes(input);
  assert.deepEqual(first.changes, ["missing-doctype", "missing-document-language", "missing-charset"]);
  assert.match(first.html, /^<!doctype html>/);
  assert.match(first.html, /<html lang="zh-CN">/);
  assert.match(first.html, /<meta charset="utf-8">/);
  assert.match(first.html, /这是一段足够长的笔记正文/);
  const second = applySafeNoteFixes(first.html);
  assert.deepEqual(second.changes, []);
  assert.equal(second.html, first.html);
});

test("repair tasks stay bilingual and include evidence locations", () => {
  const report = analyzeHtmlNote({ path: "draft.html", html: "<html><head></head><body>TODO</body></html>" });
  const zh = buildRepairTask(report, "zh-CN");
  const en = buildRepairTask(report, "en");
  assert.match(zh, /请修复 HTML 笔记 draft\.html/);
  assert.match(zh, /NOTE-MISSING-CHARSET/);
  assert.match(zh, /重新运行同一检查/);
  assert.match(en, /Repair the following problems in HTML note draft\.html/);
  assert.match(en, /Rerun the same check/);
  assert.doesNotMatch(zh, /undefined/);
});

import assert from "node:assert/strict";
import test from "node:test";

import { analyzeHtmlNote, applySafeNoteFixes, buildRepairTask } from "../realitycheck/scripts/note-analyzer.mjs";
import { analyzeNotePackage } from "../realitycheck/scripts/note-package.mjs";
import { summarizeNoteReports, summarizePackageFindings } from "../realitycheck/scripts/note-summary.mjs";

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
  assert.equal(report.status, "review");
});

test("safe fixes refuse to preserve already damaged decoding", () => {
  const input = "<html><head><title>Damaged</title></head><body><h1>Damaged �</h1></body></html>";
  const report = analyzeHtmlNote({ path: "damaged.html", html: input, knownFiles: ["damaged.html"] });
  assert.equal(report.counts.autoFixable, 0);
  const repaired = applySafeNoteFixes(input);
  assert.equal(repaired.html, input);
  assert.deepEqual(repaired.changes, []);
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

test("ambiguous case-only HTML targets fail closed instead of selecting an arbitrary file", () => {
  const report = analyzeHtmlNote({
    path: "index.html",
    html: healthyNote.replace("assets/chart.svg", "GUIDE.html"),
    knownFiles: ["index.html", "Guide.html", "guide.html"],
  });
  const unsafe = report.findings.find((finding) => finding.ruleId === "unsafe-package-path");
  assert.equal(unsafe?.level, "error");
  assert.equal(unsafe?.affectedCount, 1);
  assert.equal(report.findings.some((finding) => finding.ruleId === "path-case-mismatch"), false);
  assert.equal(report.findings.some((finding) => finding.ruleId === "missing-local-file"), false);
});

test("HTML resource paths cannot escape the selected package or use a root shortcut", () => {
  for (const reference of ["../../private/x.png", "/assets/x.png"]) {
    const report = analyzeHtmlNote({
      path: "notes/index.html",
      html: healthyNote.replace("assets/chart.svg", reference),
      knownFiles: ["notes/index.html", "private/x.png", "assets/x.png"],
    });
    assert.equal(report.findings.some((finding) => finding.ruleId === "unsafe-package-path"), true, reference);
    assert.equal(report.status, "needs-fix");
  }
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

test("safe language inference does not label Japanese or Korean as Chinese", () => {
  const japanese = applySafeNoteFixes("<html><head><title>研究</title></head><body><p>これは日本語の研究ノートです。結果を確認します。</p></body></html>");
  const korean = applySafeNoteFixes("<html><head><title>연구</title></head><body><p>이것은 한국어 연구 노트입니다. 결과를 확인합니다.</p></body></html>");
  assert.match(japanese.html, /<html lang="ja">/);
  assert.match(korean.html, /<html lang="ko">/);
  assert.doesNotMatch(japanese.html, /lang="zh-CN"/);
  assert.doesNotMatch(korean.html, /lang="zh-CN"/);
});

test("code examples and scripts do not masquerade as HTML or CSS dependencies", () => {
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Code note</title></head><body><h1>Code note</h1><p>This note explains the literal snippets url(images/example.png) and min-width: 768px without applying either style.</p><script>const example = "<div>";</script></body></html>';
  const report = analyzeHtmlNote({ path: "code.html", html, knownFiles: ["code.html"] });
  assert.equal(report.findings.some((finding) => finding.ruleId === "missing-local-file"), false);
  assert.equal(report.findings.some((finding) => finding.ruleId === "wide-fixed-layout"), false);
  assert.equal(report.findings.some((finding) => finding.ruleId === "unbalanced-container"), false);
});

test("desktop-only media-query minimum width is not treated as a mobile floor", () => {
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Responsive note</title><style>@media (min-width:768px){main{min-width:768px}}</style></head><body><main><h1>Responsive note</h1><p>This note only applies its desktop layout above the matching viewport.</p></main></body></html>';
  const report = analyzeHtmlNote({ path: "responsive.html", html, knownFiles: ["responsive.html"] });
  assert.equal(report.findings.some((finding) => finding.ruleId === "wide-fixed-layout"), false);
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

test("folder package check follows CSS resources and imported stylesheets", () => {
  const findings = analyzeNotePackage({
    knownFiles: ["index.html", "styles/main.css", "styles/theme.css", "images/Hero.png"],
    entries: [
      { path: "index.html", kind: "html", text: '<!doctype html><html><head><link rel="stylesheet" href="styles/main.css"></head><body><h1>Note</h1></body></html>' },
      { path: "styles/main.css", kind: "css", text: '@import "theme.css"; .hero{background:url(../images/hero.png)} .missing{background:url("../images/missing.png")}' },
      { path: "styles/theme.css", kind: "css", text: "main{min-width:860px}" },
    ],
  });
  const rules = new Set(findings.map((finding) => finding.ruleId));
  assert.equal(rules.has("css-missing-local-file"), true);
  assert.equal(rules.has("css-path-case-mismatch"), true);
  assert.equal(rules.has("external-css-wide-fixed-layout"), true);
  const base = analyzeHtmlNote({ path: "index.html", html: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Note</title></head><body><h1>Note</h1><p>This note has enough useful content for package-check scoring.</p></body></html>', knownFiles: ["index.html"] });
  const packageSummary = summarizePackageFindings(findings);
  const summary = summarizeNoteReports([base], packageSummary);
  assert.equal(packageSummary.status, "needs-fix");
  assert.equal(summary.status, "needs-fix");
  assert.ok(summary.score < base.score);
  assert.deepEqual(base.findings.some((finding) => finding.ruleId.startsWith("css-")), false);
});

test("folder package check verifies fragments in linked HTML notes", () => {
  const entries = [
    { path: "index.html", kind: "html", text: '<!doctype html><html><body><a href="guide.html#missing">Guide</a></body></html>' },
    { path: "guide.html", kind: "html", text: '<!doctype html><html><body><h1 id="present">Guide</h1></body></html>' },
  ];
  const htmlReport = analyzeHtmlNote({ path: "index.html", html: entries[0].text, knownFiles: ["index.html", "guide.html"] });
  assert.equal(htmlReport.findings.some((finding) => finding.ruleId === "broken-cross-document-fragment"), false);
  const broken = analyzeNotePackage({ entries, knownFiles: ["index.html", "guide.html"] });
  assert.equal(broken.find((finding) => finding.ruleId === "broken-cross-document-fragment")?.affectedCount, 1);
  const fixed = analyzeNotePackage({ entries: entries.map((entry) => entry.path === "guide.html" ? { ...entry, text: entry.text.replace("present", "missing") } : entry), knownFiles: ["index.html", "guide.html"] });
  assert.equal(fixed.some((finding) => finding.ruleId === "broken-cross-document-fragment"), false);
});

test("HTML stylesheet entry paths are scored once while package traversal still follows a unique case match", () => {
  const document = (href) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Portable note</title><link rel="stylesheet" href="${href}"></head><body><h1>Portable note</h1><p>This complete note isolates ownership of its stylesheet entry path.</p></body></html>`;
  const cases = [
    {
      href: "../outside.css",
      knownFiles: ["index.html", "outside.css"],
      entries: [{ path: "index.html", kind: "html", text: document("../outside.css") }, { path: "outside.css", kind: "css", text: "body{color:#222}" }],
      ruleId: "unsafe-package-path",
      level: "error",
      score: 93,
    },
    {
      href: "styles/MAIN.css",
      knownFiles: ["index.html", "styles/main.css"],
      entries: [{ path: "index.html", kind: "html", text: document("styles/MAIN.css") }, { path: "styles/main.css", kind: "css", text: "body{color:#222}" }],
      ruleId: "path-case-mismatch",
      level: "warning",
      score: 98,
    },
  ];
  for (const item of cases) {
    const report = analyzeHtmlNote({ path: "index.html", html: item.entries[0].text, knownFiles: item.knownFiles });
    const packageFindings = analyzeNotePackage({ entries: item.entries, knownFiles: item.knownFiles });
    const summary = summarizeNoteReports([report], summarizePackageFindings(packageFindings));
    assert.equal(report.findings.filter((finding) => finding.ruleId === item.ruleId).reduce((count, finding) => count + finding.affectedCount, 0), 1, item.href);
    assert.deepEqual(packageFindings, [], item.href);
    assert.equal(summary.counts[item.level], 1, item.href);
    assert.equal(summary.packageDeduction, 0, item.href);
    assert.equal(summary.score, item.score, item.href);
  }

  const caseHtml = document("styles/MAIN.css");
  const downstream = analyzeNotePackage({
    knownFiles: ["index.html", "styles/main.css"],
    entries: [
      { path: "index.html", kind: "html", text: caseHtml },
      { path: "styles/main.css", kind: "css", text: "main{min-width:860px}" },
    ],
  });
  assert.deepEqual(downstream.map((finding) => finding.ruleId), ["external-css-wide-fixed-layout"]);
});

test("package graph ignores unreachable CSS and follows only reachable imports", () => {
  const entries = [
    { path: "index.html", kind: "html", text: '<!doctype html><html><head><link rel="stylesheet" href="styles/main.css"></head><body></body></html>' },
    { path: "styles/main.css", kind: "css", text: '@import "theme.css"; body{color:#222}' },
    { path: "styles/theme.css", kind: "css", text: '.hero{background:url(../img/missing.png)}' },
    { path: "styles/old.css", kind: "css", text: '.old{background:url(../img/also-missing.png)}' },
  ];
  const knownFiles = ["index.html", "styles/main.css", "styles/theme.css", "styles/old.css"];
  const linked = analyzeNotePackage({ entries, knownFiles });
  assert.equal(linked.find((finding) => finding.ruleId === "css-missing-local-file")?.affectedCount, 1);
  const noImport = analyzeNotePackage({ entries: entries.map((entry) => entry.path === "styles/main.css" ? { ...entry, text: "body{color:#222}" } : entry), knownFiles });
  assert.equal(noImport.some((finding) => finding.ruleId === "css-missing-local-file"), false);
  const noLink = analyzeNotePackage({ entries: entries.map((entry) => entry.path === "index.html" ? { ...entry, text: "<!doctype html><html><body></body></html>" } : entry), knownFiles });
  assert.deepEqual(noLink, []);
});

test("package paths cannot escape the selected root or use root-relative shortcuts", () => {
  const entries = [
    { path: "index.html", kind: "html", text: '<!doctype html><html><head><link rel="stylesheet" href="styles/main.css"></head><body></body></html>' },
    { path: "styles/main.css", kind: "css", text: '.a{background:url(../../private/x.png)}.b{background:url(/assets/x.png)}' },
  ];
  const findings = analyzeNotePackage({ entries, knownFiles: ["index.html", "styles/main.css", "private/x.png", "assets/x.png"] });
  const unsafe = findings.find((finding) => finding.ruleId === "unsafe-package-path");
  assert.equal(unsafe?.affectedCount, 2);
  assert.equal(unsafe?.level, "error");
});

test("cross-document fragments survive query strings", () => {
  const entries = [
    { path: "index.html", kind: "html", text: '<!doctype html><html><body><a href="guide.html?view=print#missing">Guide</a></body></html>' },
    { path: "guide.html", kind: "html", text: '<!doctype html><html><body><h1 id="present">Guide</h1></body></html>' },
  ];
  const findings = analyzeNotePackage({ entries, knownFiles: ["index.html", "guide.html"] });
  assert.equal(findings.some((finding) => finding.ruleId === "broken-cross-document-fragment"), true);
});

test("reachable oversized stylesheet content is disclosed as unverified", () => {
  const findings = analyzeNotePackage({
    entries: [{ path: "index.html", kind: "html", text: '<!doctype html><html><head><link rel="stylesheet" href="large.css"></head><body></body></html>' }],
    knownFiles: ["index.html", "large.css"],
  });
  const unverified = findings.find((finding) => finding.ruleId === "package-content-not-verified");
  assert.equal(unverified?.level, "warning");
});

test("CSS graph handles unquoted imports, comments, remote assets, and cycles once", () => {
  const entries = [
    { path: "index.html", kind: "html", text: '<html><head><link rel="stylesheet" href="a.css"><link rel="stylesheet" href="a.css"></head></html>' },
    { path: "a.css", kind: "css", text: '@import url(b.css); /* url(commented-missing.png); min-width:900px */' },
    { path: "b.css", kind: "css", text: '@import "a.css"; .x{background:url(missing.png)}.r{background:url(https://cdn.example/image.png)}' },
  ];
  const findings = analyzeNotePackage({ entries, knownFiles: ["index.html", "a.css", "b.css"] });
  assert.equal(findings.find((finding) => finding.ruleId === "css-missing-local-file")?.affectedCount, 1);
  assert.equal(findings.some((finding) => finding.ruleId === "external-css-wide-fixed-layout"), false);
  assert.equal(findings.find((finding) => finding.ruleId === "css-remote-dependency")?.affectedCount, 1);
});

test("a unique case-only stylesheet import is inspected after being reported", () => {
  const entries = [
    { path: "index.html", kind: "html", text: '<html><head><link rel="stylesheet" href="main.css"></head></html>' },
    { path: "main.css", kind: "css", text: '@import "theme.css"' },
    { path: "Theme.css", kind: "css", text: '.x{background:url(missing.png)}' },
  ];
  const findings = analyzeNotePackage({ entries, knownFiles: ["index.html", "main.css", "Theme.css"] });
  assert.equal(findings.some((finding) => finding.ruleId === "css-path-case-mismatch"), true);
  assert.equal(findings.some((finding) => finding.ruleId === "css-missing-local-file"), true);
});

test("ambiguous case-only cross-note targets are owned by HTML analysis and not duplicated by package analysis", () => {
  const entries = [
    { path: "index.html", kind: "html", text: '<html><body><a href="GUIDE.html#methods">Guide</a></body></html>' },
    { path: "Guide.html", kind: "html", text: '<html><body><h1 id="methods">A</h1></body></html>' },
    { path: "guide.html", kind: "html", text: '<html><body><h1 id="methods">B</h1></body></html>' },
  ];
  const knownFiles = entries.map((entry) => entry.path);
  const report = analyzeHtmlNote({ path: "index.html", html: entries[0].text, knownFiles });
  const findings = analyzeNotePackage({ entries, knownFiles });
  assert.equal(report.findings.find((finding) => finding.ruleId === "unsafe-package-path")?.affectedCount, 1);
  assert.equal(findings.some((finding) => finding.ruleId === "unsafe-package-path"), false);
});

test("CSS string content and data imports are not treated as missing files", () => {
  const entries = [
    { path: "index.html", kind: "html", text: '<html><head><link rel="stylesheet" href="main.css"></head></html>' },
    { path: "main.css", kind: "css", text: '.x::before{content:"url(missing.png)"}@import url(data:text/css,.x%7Bcolor:red%7D);' },
  ];
  const findings = analyzeNotePackage({ entries, knownFiles: ["index.html", "main.css"] });
  assert.equal(findings.some((finding) => finding.ruleId === "css-missing-local-file"), false);
});

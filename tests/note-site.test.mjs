import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { analyzeHtmlNote } from "../realitycheck/scripts/note-analyzer.mjs";
import { analyzeNotePackage } from "../realitycheck/scripts/note-package.mjs";
import { buildPackageRepairTask, summarizeNoteReports, summarizePackageFindings, noteDecision } from "../realitycheck/scripts/note-summary.mjs";
import { buildPortableNoteReport } from "../site/note-share-report.mjs";

test("zero-install note checker exposes a private file and folder workflow", () => {
  const html = readFileSync("site/note.html", "utf8");
  assert.match(html, /id="file-picker"[^>]+accept="\.html,\.htm,text\/html"/);
  assert.match(html, /id="folder-picker"[^>]+webkitdirectory/);
  assert.match(html, /id="drop-zone"/);
  assert.match(html, /id="demo-button"/);
  assert.match(html, /id="decision"/);
  assert.match(html, /id="download-report"/);
  assert.match(html, /No upload/);
  assert.match(html, /不上传/);
  assert.match(html, /Never overwrites the original/);
  assert.match(html, /不覆盖原文件/);
  assert.match(html, /script type="module" src="note-checker\.js\?v=0\.6\.0-baseline"/);
  assert.doesNotMatch(html, /<script[^>]+src="https?:/i);
  assert.doesNotMatch(html, /<link[^>]+rel="stylesheet"[^>]+href="https?:/i);
});

test("browser note checker analyzes untrusted content without rendering or uploading it", () => {
  const script = readFileSync("site/note-checker.js", "utf8");
  assert.match(script, /file\.text\(\)/);
  assert.match(script, /analyzeHtmlNote/);
  assert.match(script, /applySafeNoteFixes/);
  assert.match(script, /buildRepairTask/);
  assert.match(script, /buildPortableNoteReport/);
  assert.match(script, /packageFindings/);
  assert.match(script, /renderPackage/);
  assert.doesNotMatch(script, /reports\[0\]|mergePackageFindings/);
  assert.match(script, /file\.size <= 5 \* 1024 \* 1024 \? await file\.text\(\) : null/);
  assert.match(script, /HTML file\(s\) exceed 25 MiB/);
  assert.match(script, /new Blob/);
  assert.match(script, /\.repaired\.html/);
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
  assert.doesNotMatch(script, /\beval\s*\(/);
  assert.doesNotMatch(script, /\bfetch\s*\(/);
  assert.doesNotMatch(script, /XMLHttpRequest|WebSocket|sendBeacon/);
  assert.doesNotMatch(script, /document\.write/);
});

test("folder readiness cannot average away one broken note", () => {
  const clean = analyzeHtmlNote({ path: "clean.html", html: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Clean note</title></head><body><h1>Clean note</h1><p>This is a complete portable note with enough useful text to pass the deterministic baseline.</p></body></html>', knownFiles: ["clean.html", "broken.html"] });
  const broken = analyzeHtmlNote({ path: "broken.html", html: "<html><body><h1>TODO �</h1></body></html>", knownFiles: ["clean.html", "broken.html"] });
  const summary = summarizeNoteReports([clean, ...Array.from({ length: 99 }, () => ({ ...clean })), broken]);
  assert.equal(summary.score, broken.score);
  assert.equal(summary.scoreBasis, "lowest-file");
  assert.equal(summary.status, "needs-fix");
  assert.ok(summary.score < 100);
});

test("package findings adjust folder readiness without becoming findings of the first HTML file", () => {
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Package note</title><link rel="stylesheet" href="styles/main.css"></head><body><h1>Package note</h1><p>This complete HTML note has enough content to keep its file report clean.</p></body></html>';
  const report = analyzeHtmlNote({ path: "index.html", html, knownFiles: ["index.html", "styles/main.css"] });
  const packageFindings = analyzeNotePackage({
    entries: [
      { path: "index.html", kind: "html", text: html },
      { path: "styles/main.css", kind: "css", text: '.hero{background:url("../images/missing.png")}' },
    ],
    knownFiles: ["index.html", "styles/main.css"],
  });
  const packageSummary = summarizePackageFindings(packageFindings);
  const summary = summarizeNoteReports([report], packageSummary);
  assert.equal(report.findings.some((finding) => finding.ruleId === "css-missing-local-file"), false);
  assert.equal(packageFindings.some((finding) => finding.ruleId === "css-missing-local-file"), true);
  assert.equal(summary.files, 1);
  assert.equal(summary.lowestFileScore, report.score);
  assert.equal(summary.score, report.score - packageSummary.scoreDeduction);
  assert.equal(summary.status, "needs-fix");
});

test("browser checker exports a self-contained bilingual decision report without source HTML", () => {
  const report = analyzeHtmlNote({ path: "private-note.html", html: "<html><body><h1>TODO �</h1><p>PRIVATE_SENTINEL_CONTENT</p></body></html>", knownFiles: ["private-note.html"] });
  const bundle = { generatedAt: "2026-08-14T00:00:00.000Z", summary: summarizeNoteReports([report]), reports: [report] };
  const html = buildPortableNoteReport(bundle, { buildRepairTask: (value, language) => `${language}:${value.path}`, noteDecision });
  assert.match(html, /Sharing readiness report/);
  assert.match(html, /暂不建议分享/);
  assert.match(html, /folder readiness · lowest file/);
  assert.match(html, /data-language="zh-CN"/);
  assert.match(html, /Print \/ save as PDF/);
  assert.match(html, /noindex,nofollow/);
  assert.ok(!Object.hasOwn(bundle, "sources"));
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /https?:\/\//i);
});

test("portable report renders package dependencies as a separate non-HTML card and repair scope", () => {
  const report = analyzeHtmlNote({ path: "index.html", html: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Clean note</title></head><body><h1>Clean note</h1><p>This note is complete and keeps package evidence separate.</p></body></html>', knownFiles: ["index.html"] });
  const packageFindings = [{
    id: "NOTE-CSS-MISSING-LOCAL-FILE", ruleId: "css-missing-local-file", level: "error", safeFix: false, affectedCount: 1,
    title: { en: "Missing CSS asset", zhCN: "CSS 资源缺失" }, summary: { en: "A CSS asset is missing.", zhCN: "CSS 资源不存在。" },
    remediation: { en: "Restore it.", zhCN: "恢复该资源。" }, evidence: [{ path: "styles/main.css", line: 4, excerpt: "url(missing.png)" }],
  }];
  const packageSummary = summarizePackageFindings(packageFindings);
  const bundle = { generatedAt: "2026-08-14T00:00:00.000Z", summary: summarizeNoteReports([report], packageSummary), reports: [report], packageFindings, packageSummary };
  const html = buildPortableNoteReport(bundle, { buildRepairTask: (value, language) => `${language}:HTML:${value.path}`, buildPackageRepairTask, noteDecision });
  assert.match(html, /FILE PACKAGE DEPENDENCIES/);
  assert.match(html, /styles\/main\.css:4/);
  assert.match(html, /lowest HTML file adjusted by package findings/);
  assert.match(html, /package-level dependencies/);
  const packageCard = html.slice(html.indexOf('<section class="file-card package-card">'), html.indexOf("</section>", html.indexOf('<section class="file-card package-card">')));
  assert.doesNotMatch(packageCard, /HTML:index\.html/);
});

test("note checker has responsive and keyboard-visible controls", () => {
  const css = readFileSync("site/note.css", "utf8");
  const html = readFileSync("site/note.html", "utf8");
  assert.match(css, /@media\s*\(max-width:\s*560px\)/);
  assert.match(css, /min-height:\s*46px/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /role="group" aria-label="Finding filters"/);
  assert.match(html, /<label class="button primary">/);
});

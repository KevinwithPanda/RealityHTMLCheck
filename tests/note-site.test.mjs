import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { analyzeHtmlNote, applySafeNoteFixes, buildRepairTask, normalizeNotePath } from "../realitycheck/scripts/note-analyzer.mjs";
import { analyzeNotePackage } from "../realitycheck/scripts/note-package.mjs";
import { buildPackageRepairTask, summarizeNoteReports, summarizePackageFindings, noteDecision } from "../realitycheck/scripts/note-summary.mjs";
import { buildPortableNoteReport } from "../site/note-share-report.mjs";
import { analyzeBrowserNoteSources, duplicateBrowserNotePaths, safeRepairDownloadName, safeRepairDownloadPayload, verifySafeNoteRepair } from "../site/note-repair-verification.mjs";

const analysisHelpers = { analyzeHtmlNote, applySafeNoteFixes, analyzeNotePackage, summarizeNoteReports, summarizePackageFindings, normalizeNotePath };

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
  assert.match(html, /script type="module" src="note-checker\.js\?v=0\.7\.1"/);
  assert.match(html, /Browser repair downloads one HTML only; folder assets are not bundled/);
  assert.doesNotMatch(html, /<script[^>]+src="https?:/i);
  assert.doesNotMatch(html, /<link[^>]+rel="stylesheet"[^>]+href="https?:/i);
});

test("browser note checker analyzes untrusted content without rendering or uploading it", () => {
  const script = readFileSync("site/note-checker.js", "utf8");
  assert.match(script, /file\.text\(\)/);
  assert.match(script, /analyzeHtmlNote/);
  assert.match(script, /applySafeNoteFixes/);
  assert.match(script, /verifySafeNoteRepair/);
  assert.match(script, /safeRepairDownloadPayload/);
  assert.match(script, /safeRepairDownloadName/);
  assert.match(script, /duplicateBrowserNotePaths/);
  assert.match(script, /inspectionGeneration/);
  assert.match(script, /clearRenderedResult/);
  assert.match(script, /generation !== inspectionGeneration/);
  assert.match(script, /const selectedFiles = \[\.\.\.fileList\]/);
  assert.match(script, /elements\.filePicker\.value = ""/);
  assert.match(script, /Apply safe fixes, recheck & download/);
  assert.match(script, /this does not mean every problem is fixed/);
  assert.match(script, /download is the exact in-memory HTML that was rechecked/);
  assert.match(script, /buildRepairTask/);
  assert.match(script, /buildPortableNoteReport/);
  assert.match(script, /packageFindings/);
  assert.match(script, /renderPackage/);
  assert.doesNotMatch(script, /reports\[0\]|mergePackageFindings/);
  assert.match(script, /file\.size <= 5 \* 1024 \* 1024 \? await file\.text\(\) : null/);
  assert.match(script, /HTML file\(s\) exceed 25 MiB/);
  assert.match(script, /new Blob/);
  assert.match(readFileSync("site/note-repair-verification.mjs", "utf8"), /\.repaired\.html/);
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
  assert.doesNotMatch(script, /\beval\s*\(/);
  assert.doesNotMatch(script, /\bfetch\s*\(/);
  assert.doesNotMatch(script, /XMLHttpRequest|WebSocket|sendBeacon/);
  assert.doesNotMatch(script, /document\.write/);
});

test("browser note analysis refuses duplicate paths before report and repair pairing", () => {
  assert.deepEqual(duplicateBrowserNotePaths(["note.html", "folder/other.html", "note.html"], normalizeNotePath), ["note.html"]);
  assert.deepEqual(duplicateBrowserNotePaths(["a\\note.html", "a/note.html"], normalizeNotePath), ["a/note.html"]);
  assert.deepEqual(duplicateBrowserNotePaths(["a/../note.html", "note.html"], normalizeNotePath), ["note.html"]);
  assert.throws(() => analyzeBrowserNoteSources({
    htmlSources: [
      { path: "note.html", html: "<!doctype html><html><body><h1>One</h1></body></html>" },
      { path: "note.html", html: "<html><body><h1>Two</h1></body></html>" },
    ],
    knownFiles: ["note.html"],
  }, analysisHelpers), /Duplicate note path/);
  assert.throws(() => analyzeBrowserNoteSources({
    htmlSources: [{ path: "note.html", html: "<!doctype html><html><body><h1>One</h1></body></html>" }],
    knownFiles: ["note.html", "note.html"],
  }, analysisHelpers), /Duplicate package path/);
});

test("safe browser repair is rechecked and the download is exactly the verified HTML", () => {
  const original = '<html><head><title>Research draft</title></head><body><h1>Research TODO</h1><p>This unfinished research note has enough readable content while retaining a reviewable placeholder and executable behavior.</p><script>window.startDraft()</script></body></html>';
  const analysis = { htmlSources: [{ path: "draft.html", html: original }], cssSources: [], knownFiles: ["draft.html"] };
  const before = analyzeBrowserNoteSources(analysis, analysisHelpers);
  const verification = verifySafeNoteRepair({ path: "draft.html", beforeBundle: before, analysis }, analysisHelpers);

  assert.deepEqual(verification.changes, ["missing-doctype", "missing-document-language", "missing-charset"]);
  assert.equal(verification.originalModified, false);
  assert.equal(analysis.htmlSources[0].html, original);
  assert.ok(verification.after.report.score > verification.before.report.score);
  assert.deepEqual(new Set(verification.findings.resolved.map((entry) => entry.finding.ruleId)), new Set([
    "missing-doctype",
    "missing-document-language",
    "missing-charset",
  ]));
  assert.equal(verification.findings.remaining.some((entry) => entry.finding.ruleId === "unfinished-placeholder"), true);
  assert.equal(verification.findings.remaining.some((entry) => entry.finding.ruleId === "executable-script"), true);
  assert.deepEqual(verification.findings.introduced, []);
  assert.equal(verification.download.context, "single-html-without-folder-assets");
  assert.equal(verification.download.packageAssetsIncluded, false);
  assert.equal(verification.download.summary.score, verification.after.report.score);

  const payload = safeRepairDownloadPayload(verification, "draft.repaired.html");
  assert.equal(payload.content, verification.repairedHtml);
  assert.deepEqual(new TextEncoder().encode(payload.content), new TextEncoder().encode(verification.repairedHtml));
  assert.equal(payload.name, "draft.repaired.html");
  const downloadedReport = analyzeHtmlNote({ path: "draft.html", html: payload.content, knownFiles: ["draft.html"] });
  assert.equal(downloadedReport.score, verification.after.report.score);
  assert.deepEqual(downloadedReport.findings.map((finding) => finding.ruleId), verification.after.report.findings.map((finding) => finding.ruleId));
  assert.equal(applySafeNoteFixes(payload.content).changes.length, 0);
});

test("browser repair reports the downloaded HTML without pretending folder assets were bundled", () => {
  const original = '<html><head><title>Folder note</title></head><body><h1>Folder note</h1><p>This folder note has enough useful text and one local image that exists only in the selected package.</p><img src="assets/chart.svg" alt="Chart"></body></html>';
  const analysis = {
    htmlSources: [{ path: "folder/note.html", html: original }],
    cssSources: [],
    knownFiles: ["folder/note.html", "folder/assets/chart.svg"],
  };
  const before = analyzeBrowserNoteSources(analysis, analysisHelpers);
  const verification = verifySafeNoteRepair({ path: "folder/note.html", beforeBundle: before, analysis }, analysisHelpers);
  assert.equal(verification.after.report.findings.some((finding) => finding.ruleId === "local-files-not-verified"), false);
  assert.equal(verification.download.report.findings.some((finding) => finding.ruleId === "local-files-not-verified"), true);
  assert.equal(verification.download.onlyFindings.some((entry) => entry.finding.ruleId === "local-files-not-verified"), true);
  assert.equal(verification.download.packageAssetsIncluded, false);
  assert.notEqual(verification.download.summary.score, verification.after.summary.score);
  assert.notEqual(safeRepairDownloadName("folder-a/index.html"), safeRepairDownloadName("folder-b/index.html"));
  assert.equal(safeRepairDownloadName("index.html"), "index.repaired.html");
  const portable = buildPortableNoteReport({
    ...before,
    generatedAt: "2026-08-27T00:00:00.000Z",
    repairVerifications: new Map([[verification.path, verification]]),
  }, { buildRepairTask, buildPackageRepairTask, noteDecision });
  assert.match(portable, /SAFE-FIX PROOF/);
  assert.match(portable, /Original-folder file score/);
  assert.match(portable, /HTML-only score \(assets not bundled\)/);
  assert.match(portable, /folder images, styles, and attachments are not bundled/);
  assert.doesNotMatch(portable, /This folder note has enough useful text/);
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

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { analyzeHtmlNote, applySafeNoteFixes, buildRepairTask, normalizeNotePath } from "../realitycheck/scripts/note-analyzer.mjs";
import { analyzeNotePackage } from "../realitycheck/scripts/note-package.mjs";
import { compareNoteBundles, NOTE_RULESET_ID, noteComparisonGateFailed, noteComparisonRegressionCounts, validateNoteBundleForComparison } from "../realitycheck/scripts/note-compare.mjs";
import { renderNoteComparisonHtml } from "../realitycheck/scripts/note-comparison-report.mjs";
import { buildPackageRepairTask, summarizeNoteReports, summarizePackageFindings, noteDecision } from "../realitycheck/scripts/note-summary.mjs";
import { buildPortableNoteReport } from "../site/note-share-report.mjs";
import { bindSafeFolderCandidate } from "../site/note-folder-repair.mjs";
import { analyzeBrowserNoteSources, duplicateBrowserNotePaths, safeRepairDownloadName, safeRepairDownloadPayload, verifySafeNotePackageRepair, verifySafeNoteRepair } from "../site/note-repair-verification.mjs";

const analysisHelpers = { analyzeHtmlNote, applySafeNoteFixes, analyzeNotePackage, summarizeNoteReports, summarizePackageFindings, normalizeNotePath };

test("zero-install note checker exposes a private file and folder workflow", () => {
  const html = readFileSync("site/note.html", "utf8");
  assert.match(html, /id="file-picker"[^>]+accept="\.html,\.htm,text\/html"/);
  assert.match(html, /id="folder-picker"[^>]+webkitdirectory/);
  assert.match(html, /id="zip-picker"[^>]+accept="\.zip,application\/zip,application\/x-zip-compressed"/);
  assert.match(html, /id="baseline-picker"[^>]+accept="\.json,application\/json"/);
  assert.match(html, /id="baseline-comparison"[^>]+aria-live="polite"/);
  assert.match(html, /id="drop-zone"/);
  assert.match(html, /id="demo-button"/);
  assert.match(html, /id="decision"/);
  assert.match(html, /id="download-report"/);
  assert.match(html, /id="download-folder-zip"[^>]+hidden/);
  assert.match(html, /id="folder-repair"[^>]+aria-live="polite"/);
  assert.match(html, /No upload/);
  assert.match(html, /不上传/);
  assert.match(html, /Never overwrites the original/);
  assert.match(html, /不覆盖原文件/);
  assert.match(html, /Need a deployable ZIP\?/);
  assert.match(html, /exact-final-byte browser proof/);
  assert.match(html, /script type="module" src="note-checker\.js\?v=0\.11\.0"/);
  assert.match(html, /<link rel="manifest" href="site\.webmanifest">/);
  assert.match(html, /Online ZIP repair is a safe-metadata working copy, not a publish verdict/);
  assert.match(html, /local v0\.11 command or publish Action/);
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
  assert.match(script, /verifySafeNotePackageRepair/);
  assert.match(script, /buildVerifiedFolderRepairZip/);
  assert.match(script, /prepareFolderRepairInventory/);
  assert.match(script, /duplicateBrowserNotePaths/);
  assert.match(script, /inspectionGeneration/);
  assert.match(script, /clearRenderedResult/);
  assert.match(script, /generation !== inspectionGeneration/);
  assert.match(script, /let selectedFiles = \[\.\.\.fileList\]/);
  assert.match(script, /elements\.filePicker\.value = ""/);
  assert.match(script, /Apply safe fixes, recheck & download/);
  assert.match(script, /this does not mean every problem is fixed/);
  assert.match(script, /download is the exact in-memory HTML that was rechecked/);
  assert.match(script, /buildRepairTask/);
  assert.match(script, /buildPortableNoteReport/);
  assert.match(script, /packageFindings/);
  assert.match(script, /renderPackage/);
  assert.doesNotMatch(script, /reports\[0\]|mergePackageFindings/);
  assert.match(script, /entry\.file\.size <= 5 \* 1024 \* 1024 \? await entry\.file\.text\(\) : null/);
  assert.match(script, /HTML file\(s\) exceed 25 MiB/);
  assert.match(script, /new Blob/);
  assert.match(script, /selectedInventoryIncluded/);
  assert.match(script, /folderInventory/);
  assert.match(script, /folderZipArtifact/);
  assert.match(script, /basis: "cumulative-all-eligible-html"/);
  assert.match(script, /beforeSummary: folderRepairVerification\.before\.summary/);
  assert.match(script, /afterSummary: folderRepairVerification\.after\.summary/);
  assert.match(script, /activeFolderRepairController/);
  assert.match(script, /activeInspectionController/);
  assert.match(script, /baselineToken = \+\+baselineGeneration/);
  assert.match(script, /baselineGeneration !== baselineToken/);
  assert.match(script, /importHtmlNoteZip/);
  assert.match(script, /importedArchive\.fileEntries/);
  assert.match(script, /singleZipSelection = !folderMode && selectedFiles\.length === 1 && zipFiles\.length === 1/);
  assert.match(script, /zipFiles\.length && !folderMode/);
  assert.match(script, /ZIPs inside a chosen folder remain ordinary attachments/);
  assert.match(script, /path: completeFolderPaths \? file\.webkitRelativePath : pathFor\(file\)/);
  assert.match(script, /sourceArchive: bundle\.importedArchive/);
  assert.match(script, /compareNoteBundles/);
  assert.match(script, /renderNoteComparisonHtml/);
  assert.match(script, /discovery: \{ htmlFiles: analyzed\.reports\.length/);
  assert.match(script, /knownFilePaths: knownFiles \? \[\.\.\.knownFiles\]\.sort\(\) : null/);
  assert.match(script, /rulesetId: NOTE_RULESET_ID/);
  assert.match(script, /selection: \{ html: \{ excludePatterns: \[\], excludedFiles: \[\], excludedCount: 0 \} \}/);
  assert.match(script, /MAX_HTML_TEXT_BYTES = 32 \* 1024 \* 1024/);
  assert.match(script, /MAX_CSS_TEXT_BYTES = 16 \* 1024 \* 1024/);
  assert.match(script, /MAX_SELECTED_FILES = 5000/);
  assert.match(script, /MAX_BASELINE_BYTES = 32 \* 1024 \* 1024/);
  assert.match(script, /allEntries\.length > MAX_SELECTED_FILES/);
  assert.match(script, /current !== bundle \|\| inspectionGeneration !== generation/);
  assert.match(script, /Review ZIP inventory/);
  assert.match(script, /Confirm inventory & build ZIP/);
  assert.match(script, /Downloaded \$\{bundle\.folderZipArtifact\.filename\}/);
  assert.match(script, /Downloaded safe-metadata copy still has|safe-metadata copy still has/);
  assert.match(script, /realitycheck-demo\/guide\.html/);
  assert.match(script, /realitycheck-demo\/images\/result\.svg/);
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
  assert.deepEqual(verification.findings.worsened, []);
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

test("folder repair applies safe metadata fixes once and rechecks the combined package", async () => {
  const draft = '<html><head><title>Folder draft</title><link rel="stylesheet" href="assets/theme.css"></head><body><h1>Folder draft</h1><p>This folder draft has enough content to prove a combined repair while preserving every selected asset.</p><img src="assets/chart.svg" alt="Chart"></body></html>';
  const clean = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Clean sibling</title></head><body><h1>Clean sibling</h1><p>This sibling is already complete and must remain unchanged in the repaired folder.</p></body></html>';
  const analysis = {
    htmlSources: [{ path: "notes/draft.html", html: draft }, { path: "notes/clean.html", html: clean }],
    cssSources: [{ path: "notes/assets/theme.css", text: "body{max-width:70rem}" }],
    knownFiles: ["notes/draft.html", "notes/clean.html", "notes/assets/theme.css", "notes/assets/chart.svg"],
  };
  const before = analyzeBrowserNoteSources(analysis, analysisHelpers);
  assert.throws(() => verifySafeNotePackageRepair({ beforeBundle: { ...before, summary: { ...before.summary, score: 0 } }, analysis }, analysisHelpers), /baseline no longer matches/);
  const verification = await bindSafeFolderCandidate(verifySafeNotePackageRepair({ beforeBundle: before, analysis }, analysisHelpers));
  assert.equal(verification.kind, "html-note-safe-package-repair-verification");
  assert.match(verification.candidateId, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(verification.changes, [{ path: "notes/draft.html", rules: ["missing-doctype", "missing-document-language", "missing-charset"] }]);
  assert.equal(verification.totalChanges, 3);
  assert.equal(Object.hasOwn(verification, "packageAssetsIncluded"), false, "analysis alone must not claim that an archive contains the selected assets");
  assert.equal(verification.originalModified, false);
  assert.equal(analysis.htmlSources[0].html, draft);
  assert.equal(analysis.htmlSources[1].html, clean);
  assert.match(verification.repairedHtmlByPath.get("notes/draft.html"), /^<!doctype html>/);
  assert.equal(verification.repairedHtmlByPath.has("notes/clean.html"), false);
  assert.ok(verification.after.summary.score > verification.before.summary.score);
  assert.deepEqual(verification.findings.introduced, []);
  assert.deepEqual(verification.findings.worsened, []);
  const combined = analyzeBrowserNoteSources({
    ...analysis,
    htmlSources: analysis.htmlSources.map((source) => verification.repairedHtmlByPath.has(source.path)
      ? { ...source, html: verification.repairedHtmlByPath.get(source.path) }
      : source),
  }, analysisHelpers);
  assert.deepEqual(combined.summary, verification.after.summary);
  assert.deepEqual(combined.reports.map((report) => report.findings.map((finding) => finding.ruleId)), verification.after.reports.map((report) => report.findings.map((finding) => finding.ruleId)));
  const portable = buildPortableNoteReport({
    ...verification.after,
    generatedAt: "2026-08-27T00:00:00.000Z",
    reportContext: "folder-candidate",
    safePackageRepairVerification: verification,
  }, { buildRepairTask, buildPackageRepairTask, noteDecision });
  assert.match(portable, /CUMULATIVE FOLDER PROOF/);
  assert.match(portable, /CUMULATIVE FOLDER CANDIDATE · AFTER/);
  assert.match(portable, /realitycheck-report-context" content="folder-candidate/);
  assert.match(portable, new RegExp(verification.candidateId));
  assert.match(portable, /Candidate analysis fingerprint/);
  assert.match(portable, /Copy full ID/);
  assert.match(portable, /All eligible HTML rechecked together/);
  assert.match(portable, /Only doctype, language, and UTF-8 metadata were changed/);
  assert.doesNotMatch(portable, /This folder draft has enough content/);
  assert.throws(() => buildPortableNoteReport({
    ...verification.after,
    generatedAt: "2026-08-27T00:00:00.000Z",
    reportContext: "folder-candidate",
    safePackageRepairVerification: { ...verification, candidateId: undefined },
  }, { buildRepairTask, buildPackageRepairTask, noteDecision }), /requires a bound SHA-256 candidate ID/);
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
  assert.match(html, /ORIGINAL CHECK · BEFORE SAFE-METADATA COPY/);
  assert.match(html, /No source file was uploaded or overwritten/);
  assert.match(html, /暂不建议分享/);
  assert.match(html, /folder readiness · lowest file/);
  assert.match(html, /data-language="zh-CN"/);
  assert.match(html, /Print \/ save as PDF/);
  assert.match(html, /noindex,nofollow/);
  assert.ok(!Object.hasOwn(bundle, "sources"));
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /https?:\/\//i);
});

test("browser evidence shape is accepted as a portable repeat-check baseline", () => {
  const report = analyzeHtmlNote({ path: "notes/index.html", html: "<html><body><h1>TODO</h1></body></html>", knownFiles: ["notes/index.html"] });
  const evidence = {
    schemaVersion: "1",
    kind: "html-note-browser-check",
    id: "browser:2026-08-27T00:00:00.000Z",
    generatedAt: "2026-08-27T00:00:00.000Z",
    rulesetId: NOTE_RULESET_ID,
    discovery: { htmlFiles: 1, knownFiles: 1, knownFilePaths: ["notes/index.html"], truncated: false },
    selection: { html: { excludePatterns: [], excludedFiles: [], excludedCount: 0 } },
    reports: [report],
    packageFindings: [],
  };
  assert.doesNotThrow(() => validateNoteBundleForComparison(evidence));
  const comparison = compareNoteBundles(evidence, structuredClone(evidence));
  assert.equal(comparison.counts.new, 0);
  assert.equal(comparison.counts.worsened, 0);
  assert.equal(comparison.counts.unverified, 0);
  assert.equal(comparison.counts.persistent, report.findings.length);
});

test("browser comparison HTML cannot call a new error regression passed", () => {
  const cleanReport = analyzeHtmlNote({ path: "index.html", html: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Clean</title></head><body><h1>Clean</h1><p>This baseline is clean and complete.</p></body></html>', knownFiles: ["index.html"] });
  const brokenReport = analyzeHtmlNote({ path: "index.html", html: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Broken</title></head><body><h1 id="same">Broken</h1><p id="same">Duplicate navigation identity.</p></body></html>', knownFiles: ["index.html"] });
  const shape = (report, id) => ({
    schemaVersion: "1", kind: "html-note-browser-check", id, generatedAt: "2026-08-27T00:00:00.000Z", rulesetId: NOTE_RULESET_ID,
    discovery: { htmlFiles: 1, knownFiles: 1, knownFilePaths: ["index.html"], truncated: false },
    selection: { html: { excludePatterns: [], excludedFiles: [], excludedCount: 0 } }, reports: [report], packageFindings: [],
  });
  const compared = compareNoteBundles(shape(cleanReport, "before"), shape(brokenReport, "after"));
  const comparison = { ...compared, regressionsByLevel: noteComparisonRegressionCounts(compared), gate: { mode: "browser-repeat-check", failOn: "error", failed: noteComparisonGateFailed(compared, "error"), states: ["new", "worsened", "unverified"] } };
  const html = renderNoteComparisonHtml(comparison);
  assert.match(html, /Regression gate failed/);
  assert.doesNotMatch(html, /Regression gate passed/);
  assert.equal(comparison.regressionsByLevel.error > 0, true);
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

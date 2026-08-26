import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { analyzeHtmlNote } from "../realitycheck/scripts/note-analyzer.mjs";
import { summarizeNoteReports, noteDecision } from "../realitycheck/scripts/note-summary.mjs";
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
  assert.match(html, /script type="module" src="note-checker\.js\?v=0\.5\.0-adoption"/);
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

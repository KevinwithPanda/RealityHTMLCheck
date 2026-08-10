import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("zero-install note checker exposes a private file and folder workflow", () => {
  const html = readFileSync("site/note.html", "utf8");
  assert.match(html, /id="file-picker"[^>]+accept="\.html,\.htm,text\/html"/);
  assert.match(html, /id="folder-picker"[^>]+webkitdirectory/);
  assert.match(html, /id="drop-zone"/);
  assert.match(html, /id="demo-button"/);
  assert.match(html, /No upload/);
  assert.match(html, /不上传/);
  assert.match(html, /Never overwrites the original/);
  assert.match(html, /不覆盖原文件/);
  assert.match(html, /script type="module" src="note-checker\.js\?v=0\.4\.0-simple"/);
  assert.doesNotMatch(html, /<script[^>]+src="https?:/i);
  assert.doesNotMatch(html, /<link[^>]+rel="stylesheet"[^>]+href="https?:/i);
});

test("browser note checker analyzes untrusted content without rendering or uploading it", () => {
  const script = readFileSync("site/note-checker.js", "utf8");
  assert.match(script, /file\.text\(\)/);
  assert.match(script, /analyzeHtmlNote/);
  assert.match(script, /applySafeNoteFixes/);
  assert.match(script, /buildRepairTask/);
  assert.match(script, /new Blob/);
  assert.match(script, /\.repaired\.html/);
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
  assert.doesNotMatch(script, /\beval\s*\(/);
  assert.doesNotMatch(script, /\bfetch\s*\(/);
  assert.doesNotMatch(script, /XMLHttpRequest|WebSocket|sendBeacon/);
  assert.doesNotMatch(script, /document\.write/);
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

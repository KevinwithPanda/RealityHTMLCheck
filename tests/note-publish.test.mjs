import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runNotePublishCommand } from "../realitycheck/scripts/note-publish.mjs";
import { readStoredZipEntries } from "../realitycheck/scripts/note-zip.mjs";

const healthy = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Portable research note</title></head><body><main><h1 id="summary">Portable research note</h1><p>This self-contained note records a complete result with enough meaningful detail to remain readable on desktop and mobile screens after it is shared.</p><p>The attachment is local, navigation is deterministic, and the published copy has no runtime network dependency.</p></main></body></html>`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-note-publish-"));
  const input = join(root, "input");
  const output = join(root, "output");
  mkdirSync(input);
  return { root, input, output, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function passingBrowserStub() {
  let calls = 0;
  return {
    get calls() { return calls; },
    run: async ({ deployContentId }) => {
      calls += 1;
      return { proof: {
        schemaVersion: "1",
        kind: "html-note-publish-browser-proof",
        deploy: { contentId: deployContentId },
        browser: { name: "Test Chromium", version: "1" },
        scenarios: [
          { id: "desktop-root", status: "passed" },
          { id: "mobile-375-root", status: "passed" },
          { id: "desktop-project-mount", status: "passed" },
          { id: "mobile-375-project-mount", status: "passed" },
          { id: "offline-exact-replay", status: "passed" },
          { id: "local-pages-and-fragments", status: "passed" },
        ],
        passed: true,
      } };
    },
  };
}

function onlyRunDirectory(output) {
  const names = readdirSync(output);
  assert.equal(names.length, 1);
  return join(output, names[0]);
}

test("note publish emits a verified deploy ZIP, public proof, technical report, and sidecar", async () => {
  const item = fixture();
  try {
    writeFileSync(join(item.input, "index.html"), healthy);
    const browser = passingBrowserStub();
    const code = await runNotePublishCommand([item.input, "--output", item.output, "--name", "Demo Note", "--language", "en"], { runBrowserProof: browser.run });
    assert.equal(code, 0);
    assert.equal(browser.calls, 2, "deploy bytes and final archive both require browser proof");
    const run = onlyRunDirectory(item.output);
    const archiveName = readdirSync(run).find((name) => name.endsWith(".realitycheck-publish.zip"));
    assert.ok(archiveName);
    const archive = new Uint8Array(readFileSync(join(run, archiveName)));
    const readBack = await readStoredZipEntries(archive);
    assert.equal(readBack.entries.has("index.html"), true);
    assert.equal(readBack.entries.has("realitycheck-proof/report.html"), true);
    assert.equal(readBack.entries.has("realitycheck-proof/manifest.json"), true);
    assert.equal(readBack.entries.has("realitycheck-proof/browser-proof.json"), true);
    const report = new TextDecoder().decode(readBack.entries.get("realitycheck-proof/report.html"));
    assert.doesNotMatch(report, /<script\b/i);
    assert.equal(readdirSync(run).some((name) => name.endsWith(".zip.sha256")), true);
    assert.equal(readdirSync(run).includes("technical-report.json"), true);
    const plan = readFileSync(join(run, "repair-plan.md"), "utf8");
    assert.match(plan, /has completed local verification/);
    assert.doesNotMatch(plan, /After repair, rerun/);
    const receiptName = readdirSync(run).find((name) => name.endsWith(".receipt.json"));
    const manifestName = readdirSync(run).find((name) => name.endsWith(".manifest.json"));
    assert.ok(manifestName);
    const publicManifest = JSON.parse(readFileSync(join(run, manifestName), "utf8"));
    assert.match(publicManifest.manifestId, /^sha256:[a-f0-9]{64}$/);
    const receipt = JSON.parse(readFileSync(join(run, receiptName), "utf8"));
    assert.equal(receipt.publishReady, true);
    assert.equal(receipt.finalArchiveBrowserProofPassed, true);
    assert.match(receipt.archive.sha256, /^[a-f0-9]{64}$/);
  } finally { item.cleanup(); }
});

test("static-only publish is explicitly a non-publishable working copy", async () => {
  const item = fixture();
  try {
    writeFileSync(join(item.input, "index.html"), healthy);
    const code = await runNotePublishCommand([item.input, "--output", item.output, "--static-only"], { runBrowserProof: async () => { throw new Error("must not run"); } });
    assert.equal(code, 1);
    const run = onlyRunDirectory(item.output);
    assert.equal(readdirSync(run).some((name) => name.endsWith(".realitycheck-working-copy.zip")), true);
    const receiptName = readdirSync(run).find((name) => name.endsWith(".receipt.json"));
    const receipt = JSON.parse(readFileSync(join(run, receiptName), "utf8"));
    assert.equal(receipt.status, "browser-proof-required");
    assert.equal(receipt.publishReady, false);
  } finally { item.cleanup(); }
});

test("active input is blocked before a browser can execute it", async () => {
  const item = fixture();
  try {
    writeFileSync(join(item.input, "index.html"), healthy.replace("</body>", "<script>fetch('https://example.com')</script></body>"));
    let calls = 0;
    const code = await runNotePublishCommand([item.input, "--output", item.output], { runBrowserProof: async () => { calls += 1; } });
    assert.equal(code, 1);
    assert.equal(calls, 0);
    const run = onlyRunDirectory(item.output);
    const technical = JSON.parse(readFileSync(join(run, "technical-report.json"), "utf8"));
    assert.equal(technical.status, "working-copy");
    assert.equal(technical.blockers.some((item) => item.code === "active-script"), true);
  } finally { item.cleanup(); }
});

test("publish never overwrites an input-owned proof path", async () => {
  const item = fixture();
  try {
    writeFileSync(join(item.input, "index.html"), healthy);
    mkdirSync(join(item.input, "realitycheck-proof"));
    writeFileSync(join(item.input, "realitycheck-proof", "report.html"), "user-owned");
    await assert.rejects(() => runNotePublishCommand([item.input, "--output", item.output, "--static-only"]), /Refused to overwrite/);
  } finally { item.cleanup(); }
});

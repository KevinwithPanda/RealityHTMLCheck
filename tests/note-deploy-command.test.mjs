import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { join } from "node:path";
import test from "node:test";

import { computeDeployContentId } from "../realitycheck/scripts/note-publish-browser.mjs";
import { runVerifyDeployCommand } from "../realitycheck/scripts/note-deploy-command.mjs";
import { runNotePublishCommand } from "../realitycheck/scripts/note-publish.mjs";
import { loadVerifiedPublishCapsule } from "../realitycheck/scripts/note-publish-stage.mjs";
import { publishContentType, startPublishByteServer } from "../realitycheck/scripts/note-publish-server.mjs";
import { validateArtifactFiles } from "../realitycheck/scripts/artifact-validator.mjs";

const encoder = new TextEncoder();
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function capsule() {
  const content = [
    { path: ".nojekyll", bytes: new Uint8Array() },
    { path: "index.html", bytes: encoder.encode("<!doctype html><title>Live</title>") },
    { path: "realitycheck-proof/manifest.json", bytes: encoder.encode("{}") },
  ].map((entry) => ({ ...entry, size: entry.bytes.byteLength, sha256: sha(entry.bytes) }));
  const deployContentId = await computeDeployContentId(content.filter((entry) => !entry.path.startsWith("realitycheck-proof/")));
  return {
    runDirectory: "publish-run",
    receipt: { status: "ready", publishReady: true, finalArchiveBrowserProofPassed: true, finalArchiveBrowserProofId: `sha256:${"c".repeat(64)}`, deployContentId },
    publicManifest: { manifestId: `sha256:${"d".repeat(64)}` },
    archiveSha256: "a".repeat(64),
    archiveBytes: new Uint8Array(100),
    entries: content,
  };
}

function httpResult(item, { status = "exact-match" } = {}) {
  const checks = item.entries.map((entry) => entry.path === ".nojekyll"
    ? { path: entry.path, expected: { size: 0, sha256: entry.sha256 }, outcome: "skipped", reason: "platform-marker", attempts: 0, status: null, mime: null, actual: null, finalPath: null, redirects: [] }
    : { path: entry.path, expected: { size: entry.size, sha256: entry.sha256 }, outcome: "exact", reason: null, attempts: 1, status: 200, mime: entry.path.endsWith(".html") ? "text/html" : "application/json", actual: { size: entry.size, sha256: entry.sha256 }, finalPath: entry.path, redirects: [] });
  const index = checks.find((entry) => entry.path === "index.html");
  return {
    status,
    target: { baseUrl: "https://example.test/site/", origin: "https://example.test", basePath: "/site/", loopback: false, authorized: true },
    baseProbe: { ...index, path: "/", expectedEntry: "index.html" },
    entries: checks,
  };
}

function browserProof() {
  return {
    schemaVersion: "1", kind: "html-note-deployment-browser-proof", profile: "passive-static-live-v1", generatedAt: "2026-08-27T00:00:01.000Z",
    target: { origin: "https://example.test", basePath: "/site/" }, browser: { family: "chromium", version: "1", javascriptEnabled: false, cleanContextPerScenario: true },
    status: "passed", scenarios: [], summary: { total: 3, passed: 3, failed: 0, incomplete: 0 }, screenshots: [], proofId: `sha256:${"e".repeat(64)}`,
  };
}

test("verify-deploy command turns exact HTTP and browser evidence into one atomic live receipt run", async () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-deploy-command-"));
  const item = await capsule();
  try {
    const code = await runVerifyDeployCommand(["publish-run", "https://example.test/site/", "--allow-remote", "--output", root], {
      now: (() => { const values = [new Date("2026-08-27T00:00:00.000Z"), new Date("2026-08-27T00:00:01.000Z"), new Date("2026-08-27T00:00:02.000Z")]; return () => values.shift() || values.at(-1); })(),
      loadVerifiedPublishCapsule: async () => item,
      verifyNoteDeployment: async () => httpResult(item),
      runLiveDeploymentBrowserProof: async () => browserProof(),
      buildNoteDeploymentArtifacts(input) {
        assert.equal(input.status, "live-match");
        assert.equal(input.files.find((file) => file.path === "realitycheck-proof/manifest.json").role, "public-proof");
        assert.equal(input.files.find((file) => file.path === ".nojekyll").reasonCode, "platform-marker");
        return {
          receipt: { status: input.status, target: input.target, summary: input.summary },
          artifactNames: { json: "deployment-receipt.json", markdown: "deployment-receipt.md", markdownZhCN: "deployment-receipt.zh-CN.md", html: "deployment-receipt.html" },
          receiptJson: "{}\n", markdown: "en\n", markdownZhCN: "zh\n", reportHtml: "<html></html>",
        };
      },
      validateArtifactFiles: () => [{ valid: true, errors: [] }],
    });
    assert.equal(code, 0);
    const run = join(root, readdirSync(root)[0]);
    assert.equal(existsSync(join(run, "deployment-receipt.html")), true);
    assert.equal(JSON.parse(readFileSync(join(run, "deployment-browser-proof.json"), "utf8")).kind, "html-note-deployment-browser-proof");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("verify-deploy command keeps a direct HTTP contradiction broken without pretending browser coverage", async () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-deploy-command-broken-"));
  const item = await capsule();
  const broken = httpResult(item, { status: "broken" });
  const asset = broken.entries.find((entry) => entry.path === "realitycheck-proof/manifest.json");
  Object.assign(asset, { outcome: "broken", reason: "http-status", status: 404, mime: "text/plain", actual: null });
  try {
    const code = await runVerifyDeployCommand(["run", "https://example.test/site/", "--allow-remote", "--output", root], {
      loadVerifiedPublishCapsule: async () => item,
      verifyNoteDeployment: async () => broken,
      runLiveDeploymentBrowserProof: async () => { throw new Error("browser must not run"); },
      buildNoteDeploymentArtifacts(input) {
        assert.equal(input.status, "live-broken");
        assert.equal(input.browser, null);
        return { receipt: { status: input.status, target: input.target, summary: input.summary }, artifactNames: { json: "deployment-receipt.json", markdown: "deployment-receipt.md", markdownZhCN: "deployment-receipt.zh-CN.md", html: "deployment-receipt.html" }, receiptJson: "{}\n", markdown: "en\n", markdownZhCN: "zh\n", reportHtml: "<html></html>" };
      },
      validateArtifactFiles: () => [{ valid: true, errors: [] }],
    });
    assert.equal(code, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("terminal 204 and 206 responses remain direct live-broken evidence", async () => {
  for (const statusCode of [204, 206]) {
    const root = mkdtempSync(join(tmpdir(), `realitycheck-deploy-command-status-${statusCode}-`));
    const item = await capsule();
    const broken = httpResult(item, { status: "broken" });
    const asset = broken.entries.find((entry) => entry.path === "realitycheck-proof/manifest.json");
    Object.assign(asset, { outcome: "broken", reason: "http-status", status: statusCode, mime: null, actual: null });
    try {
      const code = await runVerifyDeployCommand(["run", "https://example.test/site/", "--allow-remote", "--output", root], {
        loadVerifiedPublishCapsule: async () => item,
        verifyNoteDeployment: async () => broken,
        buildNoteDeploymentArtifacts(input) {
          assert.equal(input.status, "live-broken");
          const mapped = input.files.find((file) => file.path === "realitycheck-proof/manifest.json");
          assert.equal(mapped.state, "missing");
          assert.equal(mapped.httpStatus, statusCode);
          return { receipt: { status: input.status, target: input.target, summary: input.summary }, artifactNames: { json: "deployment-receipt.json", markdown: "deployment-receipt.md", markdownZhCN: "deployment-receipt.zh-CN.md", html: "deployment-receipt.html" }, receiptJson: "{}\n", markdown: "en\n", markdownZhCN: "zh\n", reportHtml: "<html></html>" };
        },
        validateArtifactFiles: () => [{ valid: true, errors: [] }],
      });
      assert.equal(code, 1);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("a browser adapter failure cannot leave screenshots beside a browser-not-run receipt", async () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-deploy-command-browser-error-"));
  const item = await capsule();
  try {
    const code = await runVerifyDeployCommand(["run", "https://example.test/site/", "--allow-remote", "--output", root], {
      loadVerifiedPublishCapsule: async () => item,
      verifyNoteDeployment: async () => httpResult(item),
      async runLiveDeploymentBrowserProof({ outputDirectory }) {
        mkdirSync(join(outputDirectory, "screenshots"));
        writeFileSync(join(outputDirectory, "screenshots", "partial.png"), "partial");
        throw new Error("injected browser startup failure");
      },
      buildNoteDeploymentArtifacts(input) {
        assert.equal(input.status, "unverified");
        assert.equal(input.browser, null);
        return { receipt: { status: input.status, target: input.target, summary: input.summary }, artifactNames: { json: "deployment-receipt.json", markdown: "deployment-receipt.md", markdownZhCN: "deployment-receipt.zh-CN.md", html: "deployment-receipt.html" }, receiptJson: "{}\n", markdown: "en\n", markdownZhCN: "zh\n", reportHtml: "<html></html>" };
      },
      validateArtifactFiles: () => [{ valid: true, errors: [] }],
    });
    assert.equal(code, 2);
    const run = join(root, readdirSync(root, { withFileTypes: true }).find((entry) => entry.isDirectory()).name);
    assert.equal(existsSync(join(run, "screenshots")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("verify-deploy command refuses ambiguous arguments before loading a capsule", async () => {
  await assert.rejects(runVerifyDeployCommand([]), /requires a publish run/);
  await assert.rejects(runVerifyDeployCommand(["run", "https://example.test/", "--mystery"]), /Unknown/);
});

test("verify-deploy refuses an output nested in the immutable publish run before creating it or requesting the host", async () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-deploy-output-boundary-"));
  const item = await capsule();
  item.runDirectory = join(root, "publish-run");
  mkdirSync(item.runDirectory);
  const nested = join(item.runDirectory, "deployments");
  let requested = false;
  try {
    await assert.rejects(runVerifyDeployCommand(["run", "https://example.test/site/", "--allow-remote", "--output", nested], {
      loadVerifiedPublishCapsule: async () => item,
      verifyNoteDeployment: async () => { requested = true; return httpResult(item); },
    }), /separate from the publish run/);
    assert.equal(existsSync(nested), false);
    assert.equal(requested, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the public command revalidates a real publish run against a live loopback host and preserves browser evidence", { timeout: 30_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-deploy-command-live-"));
  let server = null;
  try {
    const source = join(root, "source");
    mkdirSync(join(source, "assets"), { recursive: true });
    writeFileSync(join(source, "index.html"), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hosted capsule</title><link rel="stylesheet" href="assets/site.css?v=stall"></head><body><main><h1 id="proof">Hosted capsule</h1><p>This fixture proves that a complete publish-ready run can be compared with the bytes actually served by a host.</p><a href="#proof">Proof section</a></main></body></html>', "utf8");
    writeFileSync(join(source, "assets", "site.css"), "body{font:16px system-ui;margin:0}main{max-width:50rem;margin:auto;padding:2rem}", "utf8");
    const publishRoot = join(root, "publish");
    assert.equal(await runNotePublishCommand([source, "--output", publishRoot, "--language", "en"]), 0);
    const publishRun = join(publishRoot, readdirSync(publishRoot, { withFileTypes: true }).find((entry) => entry.isDirectory()).name);
    const loaded = await loadVerifiedPublishCapsule(publishRun);
    server = await startPublishByteServer(new Map(loaded.entries.map((entry) => [entry.path, entry.bytes])));
    const output = join(root, "deployments");
    const exitCode = await runVerifyDeployCommand([publishRun, `${server.origin}/`, "--output", output]);
    assert.equal(exitCode, 2, "HTTP loopback evidence is complete but intentionally cannot become a public HTTPS green claim");
    const run = join(output, readdirSync(output, { withFileTypes: true }).find((entry) => entry.isDirectory()).name);
    const receipt = JSON.parse(readFileSync(join(run, "deployment-receipt.json"), "utf8"));
    assert.equal(receipt.status, "unverified");
    assert.deepEqual(receipt.reasonCodes, ["target-not-https"]);
    assert.equal(receipt.browser.status, "passed");
    assert.equal(receipt.summary.missing.files, 0);
    assert.equal(receipt.summary.transformed.files, 0);
    assert.equal(receipt.summary.matched.files + receipt.summary.skipped.files, receipt.summary.expected.files);
    assert.equal(existsSync(join(run, "deployment-browser-proof.json")), true);
    const validation = validateArtifactFiles([run]);
    assert.ok(validation.length >= 2);
    assert.equal(validation.every((item) => item.valid), true, validation.flatMap((item) => item.errors).join("\n"));

    await server.close();
    server = createServer((request, response) => {
      const url = new URL(request.url, "http://127.0.0.1");
      let path = decodeURIComponent(url.pathname.slice(1));
      if (!path) path = "index.html";
      const entry = loaded.entries.find((item) => item.path === path);
      if (!entry) { response.writeHead(404); response.end(); return; }
      if (path === "assets/site.css" && url.search === "?v=stall") {
        response.writeHead(200, { "content-type": "text/css", "content-length": 40 * 1024 * 1024 });
        response.write("partial");
        return;
      }
      response.writeHead(200, { "content-type": publishContentType(path), "content-length": entry.bytes.byteLength });
      response.end(Buffer.from(entry.bytes));
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const stalledAddress = server.address();
    const incompleteOutput = join(root, "incomplete-deployments");
    const incompleteCode = await runVerifyDeployCommand([
      publishRun, `http://127.0.0.1:${stalledAddress.port}/`, "--output", incompleteOutput,
    ]);
    assert.equal(incompleteCode, 2);
    const incompleteRun = join(incompleteOutput, readdirSync(incompleteOutput, { withFileTypes: true }).find((entry) => entry.isDirectory()).name);
    const incompleteReceipt = JSON.parse(readFileSync(join(incompleteRun, "deployment-receipt.json"), "utf8"));
    assert.equal(incompleteReceipt.status, "unverified");
    assert.equal(incompleteReceipt.browser.status, "incomplete");
    assert.ok(incompleteReceipt.reasonCodes.includes("browser-incomplete"));
    const incompleteValidation = validateArtifactFiles([incompleteRun]);
    assert.equal(incompleteValidation.every((item) => item.valid), true, incompleteValidation.flatMap((item) => item.errors).join("\n"));

    const receiptPath = join(run, "deployment-receipt.json");
    const originalReceiptText = readFileSync(receiptPath, "utf8");
    const tamperedReceipt = JSON.parse(originalReceiptText);
    tamperedReceipt.browser.scenarios = { expected: 1, completed: 1, passed: 1, failed: 0, skipped: 0 };
    const { receiptId: _oldReceiptId, ...receiptContract } = tamperedReceipt;
    tamperedReceipt.receiptId = `sha256:${createHash("sha256").update(JSON.stringify(receiptContract)).digest("hex")}`;
    writeFileSync(receiptPath, `${JSON.stringify(tamperedReceipt, null, 2)}\n`, "utf8");
    let tamperedValidation = validateArtifactFiles([run]);
    assert.equal(tamperedValidation.every((entry) => entry.valid), false);
    assert.match(tamperedValidation.flatMap((entry) => entry.errors).join("\n"), /browser\/scenarios does not bind/);
    writeFileSync(receiptPath, originalReceiptText, "utf8");

    const browserPath = join(run, "deployment-browser-proof.json");
    const tamperedProof = JSON.parse(readFileSync(browserPath, "utf8"));
    tamperedProof.source.archiveSha256 = "0".repeat(64);
    const { proofId: _oldProofId, ...proofContract } = tamperedProof;
    tamperedProof.proofId = `sha256:${createHash("sha256").update(JSON.stringify(proofContract)).digest("hex")}`;
    writeFileSync(browserPath, `${JSON.stringify(tamperedProof, null, 2)}\n`, "utf8");
    tamperedValidation = validateArtifactFiles([run]);
    assert.equal(tamperedValidation.every((entry) => entry.valid), false);
    assert.match(tamperedValidation.flatMap((entry) => entry.errors).join("\n"), /source\/archiveSha256 differs/);
    const explicitReceiptValidation = validateArtifactFiles([receiptPath]);
    assert.equal(explicitReceiptValidation.every((entry) => entry.valid), false);
    assert.match(explicitReceiptValidation.flatMap((entry) => entry.errors).join("\n"), /source\/archiveSha256 differs|proofId/);
  } finally {
    if (server?.closeAllConnections) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    } else if (server) await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

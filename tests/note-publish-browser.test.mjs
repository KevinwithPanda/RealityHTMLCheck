import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

import { computeDeployContentId, findPublishBrowserExecutable, runPublishBrowserProof } from "../realitycheck/scripts/note-publish-browser.mjs";
import { publishContentType, startPublishByteServer } from "../realitycheck/scripts/note-publish-server.mjs";
import { runNotePublishCommand } from "../realitycheck/scripts/note-publish.mjs";
import { writeStoredZipWithManifest } from "../realitycheck/scripts/note-zip.mjs";

const encoder = new TextEncoder();
const require = createRequire(import.meta.url);

function bytes(text) {
  return encoder.encode(text);
}

function cleanFixture() {
  return [
    { path: "index.html", bytes: bytes('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Publish proof</title><link rel="stylesheet" href="assets/site.css"></head><body><main><h1 id="start">Verified publish proof</h1><p>This passive fixture contains enough visible text for deterministic browser readiness evidence.</p><img src="assets/diagram.svg" alt="A local proof diagram"><a href="guide.html#details">Open details</a></main></body></html>') },
    { path: "guide.html", bytes: bytes('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Guide</title><link rel="stylesheet" href="assets/site.css"></head><body><main><h1 id="details">Details</h1><p>The cross-page fragment resolves inside the exact deploy byte map without activating a business action.</p><a href="index.html#start">Back</a></main></body></html>') },
    { path: "assets/site.css", bytes: bytes("html{font-family:sans-serif}body{margin:0}main{max-width:60rem;margin:auto;padding:2rem}img{display:block;max-width:100%;height:auto}a{display:inline-block;padding:12px}") },
    { path: "assets/diagram.svg", bytes: bytes('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><rect width="120" height="60" fill="#dcecff"/><path d="M10 45 50 15l25 25 35-25" fill="none" stroke="#174f78" stroke-width="5"/></svg>') },
  ];
}

function browserForTest() {
  try {
    const { chromium } = require("playwright-core");
    return findPublishBrowserExecutable(chromium);
  } catch (_) {
    return null;
  }
}

const browserPath = browserForTest();

async function startHttpFailureServer(entries, tracker, { entrypoint = "index.html" } = {}) {
  const server = createServer((request, response) => {
    tracker.count += 1;
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const relative = url.pathname.startsWith("/project/") ? url.pathname.slice("/project/".length) : url.pathname.slice(1);
    const path = relative || entrypoint;
    if (!Array.isArray(tracker.requests)) tracker.requests = [];
    if (path === "assets/site.css") {
      tracker.requests.push({ method: "GET", mount: url.pathname.startsWith("/project/") ? "/project/" : "/", path, status: 503, bytes: 0, hadQuery: false });
      response.writeHead(503, { "content-type": "text/plain", "cache-control": "no-store" }).end("unavailable");
      return;
    }
    const body = entries.get(path);
    if (!body) {
      tracker.requests.push({ method: "GET", mount: null, path: null, status: 404, bytes: 0, hadQuery: false });
      response.writeHead(404).end();
      return;
    }
    tracker.requests.push({ method: "GET", mount: url.pathname.startsWith("/project/") ? "/project/" : "/", path, status: 200, bytes: body.byteLength, hadQuery: false });
    response.writeHead(200, { "content-type": publishContentType(path), "content-length": body.byteLength, "cache-control": "no-store" }).end(Buffer.from(body));
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test("deployContentId uses the canonical sorted final-byte contract", async () => {
  const entries = new Map([
    ["z.txt", bytes("z")],
    ["index.html", bytes("<!doctype html><h1>id</h1>")],
  ]);
  const id = await computeDeployContentId(entries, "index.html");
  const rows = [];
  for (const [path, value] of entries) rows.push({ path, size: value.byteLength, sha256: createHash("sha256").update(value).digest("hex") });
  rows.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const contract = JSON.stringify({ contract: "realitycheck-publish-deploy-content-v1", entrypoint: "index.html", entries: rows });
  assert.equal(id, `sha256:${createHash("sha256").update(contract).digest("hex")}`);
  assert.equal(id, await computeDeployContentId(new Map([...entries].reverse()), "index.html"));
  await assert.rejects(computeDeployContentId([{ path: "index.html", size: 1, sha256: "bad" }]), /SHA-256/);
  await assert.rejects(computeDeployContentId(new Map([["other.html", bytes("x")]])), /entrypoint is absent/);
});

test("deployContentId mismatch fails before loopback server or browser navigation", async () => {
  const built = await writeStoredZipWithManifest(cleanFixture(), { output: "uint8array" });
  const root = await mkdtemp(join(tmpdir(), "realitycheck-publish-id-"));
  let started = 0;
  try {
    await assert.rejects(runPublishBrowserProof({
      archive: built.archive,
      manifest: built.manifest,
      deployContentId: `sha256:${"0".repeat(64)}`,
      outputDirectory: root,
      startServer: async () => { started += 1; throw new Error("must not start"); },
    }), /differs from the exact final ZIP/);
    assert.equal(started, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real Chrome proves root, project mount, offline replay, resources, fragments, and exact response bytes", { skip: !browserPath }, async () => {
  const built = await writeStoredZipWithManifest(cleanFixture(), { output: "uint8array" });
  const deployContentId = await computeDeployContentId(built.manifest.entries, "index.html");
  const root = await mkdtemp(join(tmpdir(), "realitycheck-publish-browser-"));
  try {
    const result = await runPublishBrowserProof({
      archive: built.archive,
      manifest: built.manifest,
      deployContentId,
      entrypoint: "index.html",
      outputDirectory: root,
      browserPath,
      startServer: startPublishByteServer,
    });
    assert.equal(result.proof.passed, true, JSON.stringify(result.proof.scenarios.map((scenario) => ({ id: scenario.id, status: scenario.status, navigationError: scenario.navigationError, consoleErrors: scenario.consoleErrors, requestFailures: scenario.requestFailures, httpErrors: scenario.httpErrors, unexpectedRequests: scenario.unexpectedRequests, responseVerificationErrors: scenario.responseVerificationErrors, responseProof: scenario.responseProof, failures: scenario.failures, overflow: scenario.overflow, coverageTruncated: scenario.coverageTruncated }))));
    assert.equal(result.proof.deploy.contentId, deployContentId);
    assert.equal(result.proof.deploy.files, 4);
    assert.equal(result.proof.evidenceTruncated, false);
    assert.deepEqual(result.proof.scenarios.map((scenario) => scenario.id), [
      "desktop-root", "mobile-375-root", "desktop-project-mount", "mobile-375-project-mount", "offline-exact-replay", "local-pages-and-fragments",
    ]);
    assert.equal(result.proof.scenarios.every((scenario) => scenario.status === "passed"), true);
    assert.equal(result.proof.scenarios.every((scenario) => scenario.consoleErrors.length === 0 && scenario.pageErrors.length === 0 && scenario.httpErrors.length === 0 && scenario.unexpectedRequests.length === 0), true);
    const offline = result.proof.scenarios.find((scenario) => scenario.id === "offline-exact-replay");
    assert.equal(offline.serverRequestCount, 0);
    assert.ok(offline.responseProof.some((entry) => entry.path === "assets/site.css"));
    const fragments = result.proof.scenarios.find((scenario) => scenario.id === "local-pages-and-fragments");
    assert.equal(fragments.htmlFiles, 2);
    assert.equal(fragments.fragments, 2);
    assert.ok(fragments.responseProof.some((entry) => entry.path === "assets/diagram.svg"));
    const expected = new Map(built.manifest.entries.map((entry) => [entry.path, entry]));
    for (const scenario of result.proof.scenarios) {
      for (const response of scenario.responseProof) {
        assert.equal(response.bytes, expected.get(response.path).size);
        assert.equal(response.sha256, expected.get(response.path).sha256);
      }
    }
    assert.equal(existsSync(join(root, "desktop.png")), true);
    assert.equal(existsSync(join(root, "mobile.png")), true);
    const written = JSON.parse(await readFile(join(root, "browser-proof.json"), "utf8"));
    assert.equal(written.archive.sha256, result.proof.archive.sha256);
    assert.equal(written.deploy.contentId, deployContentId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real Chrome fails closed when HTML coverage exceeds the declared ceiling", { skip: !browserPath }, async () => {
  const built = await writeStoredZipWithManifest(cleanFixture(), { output: "uint8array" });
  const deployContentId = await computeDeployContentId(built.manifest.entries, "index.html");
  const root = await mkdtemp(join(tmpdir(), "realitycheck-publish-cap-"));
  try {
    const result = await runPublishBrowserProof({
      archive: built.archive,
      manifest: built.manifest,
      deployContentId,
      outputDirectory: root,
      browserPath,
      limits: { maxHtmlFiles: 1 },
    });
    assert.equal(result.proof.passed, false);
    assert.equal(result.proof.evidenceTruncated, true);
    const coverage = result.proof.scenarios.find((scenario) => scenario.id === "local-pages-and-fragments");
    assert.equal(coverage.status, "failed");
    assert.equal(coverage.coverageTruncated, true);
    assert.ok(coverage.truncatedKinds.includes("htmlFiles"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real Chrome records and blocks unexpected remote and project-root requests in every applicable scenario", { skip: !browserPath }, async () => {
  const fixture = cleanFixture();
  fixture[0] = {
    path: "index.html",
    bytes: bytes('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Boundary</title><link rel="stylesheet" href="/assets/site.css"></head><body><main><h1>Network boundary</h1><p>This fixture deliberately attempts both a root escape and one external passive image request.</p><img src="https://example.invalid/secret.png?token=do-not-retain"><a href="#topic">Jump</a><h2 id="topic">Topic</h2></main></body></html>'),
  };
  const built = await writeStoredZipWithManifest(fixture, { output: "uint8array" });
  const deployContentId = await computeDeployContentId(built.manifest.entries, "index.html");
  const root = await mkdtemp(join(tmpdir(), "realitycheck-publish-network-"));
  try {
    const result = await runPublishBrowserProof({ archive: built.archive, manifest: built.manifest, deployContentId, outputDirectory: root, browserPath });
    assert.equal(result.proof.passed, false);
    const rootScenario = result.proof.scenarios.find((scenario) => scenario.id === "desktop-root");
    assert.ok(rootScenario.unexpectedRequests.some((entry) => entry.scope === "external" && entry.origin === "https://example.invalid" && entry.path === "/secret.png"));
    assert.equal(JSON.stringify(rootScenario).includes("do-not-retain"), false);
    const project = result.proof.scenarios.find((scenario) => scenario.id === "desktop-project-mount");
    assert.ok(project.unexpectedRequests.some((entry) => entry.scope === "same-origin" && entry.path === "/assets/site.css"));
    const offline = result.proof.scenarios.find((scenario) => scenario.id === "offline-exact-replay");
    assert.equal(offline.serverRequestCount, 0);
    assert.ok(offline.unexpectedRequests.some((entry) => entry.scope === "external"));
    const fragments = result.proof.scenarios.find((scenario) => scenario.id === "local-pages-and-fragments");
    assert.ok(fragments.unexpectedRequests.length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real Chrome rejects any loopback response whose bytes differ from the final ZIP", { skip: !browserPath }, async () => {
  const built = await writeStoredZipWithManifest(cleanFixture(), { output: "uint8array" });
  const deployContentId = await computeDeployContentId(built.manifest.entries, "index.html");
  const root = await mkdtemp(join(tmpdir(), "realitycheck-publish-response-"));
  const corruptServer = async (entries, tracker, options) => {
    const altered = new Map(entries);
    altered.set("assets/site.css", bytes("html{background:#fff}body{margin:0}"));
    return startPublishByteServer(altered, tracker, options);
  };
  try {
    const result = await runPublishBrowserProof({ archive: built.archive, manifest: built.manifest, deployContentId, outputDirectory: root, browserPath, startServer: corruptServer });
    assert.equal(result.proof.passed, false);
    for (const id of ["desktop-root", "mobile-375-root", "desktop-project-mount", "mobile-375-project-mount", "local-pages-and-fragments"]) {
      const scenario = result.proof.scenarios.find((item) => item.id === id);
      assert.equal(scenario.status, "failed", id);
      assert.ok(scenario.responseVerificationErrors.some((entry) => entry.path === "assets/site.css"), id);
    }
    const offline = result.proof.scenarios.find((scenario) => scenario.id === "offline-exact-replay");
    assert.equal(offline.status, "passed");
    assert.equal(offline.serverRequestCount, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("console and HTTP failures are captured in every relevant scenario without executing JavaScript", { skip: !browserPath }, async () => {
  const fixture = cleanFixture();
  fixture[0] = {
    path: "index.html",
    bytes: bytes('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Runtime evidence</title><link rel="stylesheet" href="assets/site.css" integrity="sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="></head><body><main><h1>Runtime evidence</h1><p>This passive page deliberately causes a stylesheet integrity or HTTP failure for browser evidence.</p></main></body></html>'),
  };
  const built = await writeStoredZipWithManifest(fixture, { output: "uint8array" });
  const deployContentId = await computeDeployContentId(built.manifest.entries, "index.html");
  const root = await mkdtemp(join(tmpdir(), "realitycheck-publish-events-"));
  try {
    const result = await runPublishBrowserProof({ archive: built.archive, manifest: built.manifest, deployContentId, outputDirectory: root, browserPath, startServer: startHttpFailureServer });
    assert.equal(result.proof.passed, false);
    for (const scenario of result.proof.scenarios) {
      assert.ok(Array.isArray(scenario.consoleErrors), scenario.id);
      assert.ok(Array.isArray(scenario.pageErrors), scenario.id);
      assert.ok(Array.isArray(scenario.httpErrors), scenario.id);
      assert.equal(scenario.workers, 0, scenario.id);
      assert.equal(scenario.websockets, 0, scenario.id);
    }
    for (const id of ["desktop-root", "mobile-375-root", "desktop-project-mount", "mobile-375-project-mount", "local-pages-and-fragments"]) {
      const scenario = result.proof.scenarios.find((item) => item.id === id);
      assert.ok(scenario.httpErrors.some((entry) => entry.status === 503 && entry.path === "/assets/site.css" || entry.status === 503 && entry.path === "/project/assets/site.css"), id);
      assert.ok(scenario.consoleErrors.length > 0, id);
    }
    const offline = result.proof.scenarios.find((scenario) => scenario.id === "offline-exact-replay");
    assert.equal(offline.serverRequestCount, 0);
    assert.ok(offline.consoleErrors.length > 0);
    assert.equal(result.proof.safety.javaScriptEnabled, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the real publish command re-proves the final archive and binds its sidecar receipt", { skip: !browserPath }, async () => {
  const root = await mkdtemp(join(tmpdir(), "realitycheck-publish-command-"));
  const input = join(root, "portable-note.html");
  const output = join(root, "output");
  await writeFile(input, '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Portable note</title></head><body><main><h1 id="start">Portable note</h1><p>This complete passive note has enough meaningful text for an exact final archive browser proof.</p><a href="#start">Return to the heading</a></main></body></html>', "utf8");
  try {
    const exitCode = await runNotePublishCommand([input, "--output", output, "--browser", browserPath, "--language", "en"]);
    const runs = await readdir(output, { withFileTypes: true });
    const run = runs.find((entry) => entry.isDirectory());
    assert.ok(run);
    const runDirectory = join(output, run.name);
    const files = await readdir(runDirectory);
    const technical = JSON.parse(await readFile(join(runDirectory, "technical-report.json"), "utf8"));
    assert.equal(exitCode, 0, JSON.stringify(technical.browser));
    const receiptName = files.find((name) => name.endsWith(".receipt.json"));
    const archiveName = files.find((name) => name.endsWith(".realitycheck-publish.zip"));
    assert.ok(receiptName);
    assert.ok(archiveName);
    const receipt = JSON.parse(await readFile(join(runDirectory, receiptName), "utf8"));
    assert.equal(receipt.publishReady, true);
    assert.equal(receipt.finalArchiveBrowserProofPassed, true);
    assert.match(receipt.deployContentId, /^sha256:[a-f0-9]{64}$/);
    assert.match(receipt.archive.sha256, /^[a-f0-9]{64}$/);
    const finalProof = JSON.parse(await readFile(join(runDirectory, "browser-final-archive", "browser-proof.json"), "utf8"));
    assert.equal(finalProof.passed, true);
    assert.equal(finalProof.deploy.contentId, receipt.deployContentId);
    assert.equal(finalProof.archive.sha256, receipt.archive.sha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

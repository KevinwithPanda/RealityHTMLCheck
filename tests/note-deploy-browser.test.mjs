import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import test from "node:test";

import {
  mapLiveRequestPath,
  normalizeLiveBrowserTarget,
  runLiveDeploymentBrowserProof,
  waitForLiveBrowserDeadline,
} from "../realitycheck/scripts/note-deploy-browser.mjs";
import { startPublishByteServer } from "../realitycheck/scripts/note-publish-server.mjs";
import { computeDeployContentId } from "../realitycheck/scripts/note-publish-browser.mjs";

test("live browser target normalizes an explicit directory URL without credentials or query state", () => {
  assert.deepEqual(normalizeLiveBrowserTarget("https://example.test/project"), {
    url: "https://example.test/project/",
    origin: "https://example.test",
    basePath: "/project/",
  });
  assert.throws(() => normalizeLiveBrowserTarget("file:///tmp/site"), /http or https/);
  assert.throws(() => normalizeLiveBrowserTarget("https://user:secret@example.test/"), /credentials/);
  assert.throws(() => normalizeLiveBrowserTarget("https://example.test/?token=secret"), /query or fragment/);
  assert.throws(() => normalizeLiveBrowserTarget("https://example.test/#secret"), /query or fragment/);
  assert.throws(() => normalizeLiveBrowserTarget("https://example.test/%2fescape"), /encoded separator/);
});

test("live browser request mapping stays inside the exact base and declared archive inventory", () => {
  const target = normalizeLiveBrowserTarget("https://example.test/project/");
  const paths = new Set(["index.html", "assets/app.css", "notes/index.html", "中/图.svg"]);
  assert.equal(mapLiveRequestPath("https://example.test/project/", target, paths), "index.html");
  assert.equal(mapLiveRequestPath("https://example.test/project", target, paths), "index.html");
  assert.equal(mapLiveRequestPath("https://example.test/project/assets/app.css", target, paths), "assets/app.css");
  assert.equal(mapLiveRequestPath("https://example.test/project/notes/", target, paths), "notes/index.html");
  assert.equal(mapLiveRequestPath("https://example.test/project/%E4%B8%AD/%E5%9B%BE.svg", target, paths), "中/图.svg");
  assert.equal(mapLiveRequestPath("https://example.test/project/missing.css", target, paths), null);
  assert.equal(mapLiveRequestPath("https://example.test/other/assets/app.css", target, paths), null);
  assert.equal(mapLiveRequestPath("https://cdn.example/assets/app.css", target, paths), null);
  assert.equal(mapLiveRequestPath("https://example.test/project/%2e%2e/secret", target, paths), null);
  assert.equal(mapLiveRequestPath("https://example.test/project/%2fsecret", target, paths), null);
});

test("live route settlement cannot wait forever past its deadline", async () => {
  const started = Date.now();
  const outcome = await waitForLiveBrowserDeadline(new Promise(() => {}), started + 25);
  assert.equal(outcome.settled, false);
  assert.ok(Date.now() - started < 500, "deadline observer must not inherit a never-settling route action");
});

test("real Chromium rechecks a live exact-byte site at desktop, mobile, pages, and fragments", async () => {
  const encoder = new TextEncoder();
  const entries = new Map([
    ["index.html", encoder.encode('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Live receipt</title><link rel="stylesheet" href="assets/site.css"></head><body><main><h1 id="start">Live receipt</h1><p>This public deployment fixture proves the exact hosted package at two viewports.</p><a href="notes/method.html#proof">Method</a></main></body></html>')],
    ["assets/site.css", encoder.encode("body{font:16px system-ui;margin:0}main{max-width:48rem;margin:auto;padding:2rem}img{max-width:100%}")],
    ["notes/method.html", encoder.encode('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Method</title></head><body><main><h1 id="proof">Method proof</h1><p>The fragment must remain reachable after deployment.</p><a href="../index.html#start">Home</a></main></body></html>')],
  ]);
  const server = await startPublishByteServer(entries);
  const output = mkdtempSync(join(tmpdir(), "realitycheck-live-browser-"));
  try {
    const deployContentId = await computeDeployContentId(entries);
    const proof = await runLiveDeploymentBrowserProof({
      targetUrl: `${server.origin}/`,
      entries,
      source: {
        archiveSha256: "a".repeat(64), archiveBytes: 4096, deployContentId,
        publishManifestId: `sha256:${"b".repeat(64)}`,
        finalArchiveBrowserProofId: `sha256:${"c".repeat(64)}`,
      },
      outputDirectory: output,
    });
    assert.equal(proof.status, "passed");
    assert.equal(proof.kind, "html-note-deployment-browser-proof");
    assert.equal(proof.source.deployContentId, deployContentId);
    assert.equal(proof.summary.total, 3);
    assert.equal(proof.summary.passed, 3);
    assert.match(proof.proofId, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(proof.scenarios.map((scenario) => scenario.id), ["live-desktop", "live-mobile-375", "live-pages-and-fragments"]);
    assert.equal(proof.scenarios[2].htmlPages, 2);
    assert.equal(proof.scenarios[2].fragments, 2);
    assert.deepEqual(proof.screenshots.map((item) => item.role), ["desktop", "mobile-375"]);
    assert.deepEqual(proof.screenshots.map((item) => item.source), ["live-response-only", "live-response-only"]);
    assert.equal(proof.scenarios.every((scenario) => scenario.capsuleFallbackRequests === 0), true);
    assert.ok(proof.screenshots.every((item) => /^[a-f0-9]{64}$/.test(item.sha256) && item.bytes > 0));
  } finally {
    await server.close();
    rmSync(output, { recursive: true, force: true });
  }
});

test("live Chromium hashes query-variant resource responses instead of trusting the query-free inventory", async () => {
  const encoder = new TextEncoder();
  const index = encoder.encode('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Query variant</title><link rel="stylesheet" href="style.css?v=1"></head><body><main><h1>Query variant</h1><p>The host must not serve different bytes for a cache-busting URL.</p></main></body></html>');
  const expectedCss = encoder.encode("body{color:black}");
  const changedCss = encoder.encode("body{color:red}");
  const entries = new Map([["index.html", index], ["style.css", expectedCss]]);
  const server = createServer((request, response) => {
    if (request.url === "/") { response.writeHead(200, { "content-type": "text/html" }); response.end(index); return; }
    if (request.url === "/style.css?v=1") { response.writeHead(200, { "content-type": "text/css" }); response.end(changedCss); return; }
    if (request.url === "/style.css") { response.writeHead(200, { "content-type": "text/css" }); response.end(expectedCss); return; }
    response.writeHead(404); response.end();
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const output = mkdtempSync(join(tmpdir(), "realitycheck-live-browser-query-"));
  try {
    const address = server.address();
    const deployContentId = await computeDeployContentId(entries);
    const proof = await runLiveDeploymentBrowserProof({
      targetUrl: `http://127.0.0.1:${address.port}/`, entries,
      source: {
        archiveSha256: "a".repeat(64), archiveBytes: 4096, deployContentId,
        publishManifestId: `sha256:${"b".repeat(64)}`,
        finalArchiveBrowserProofId: `sha256:${"c".repeat(64)}`,
      },
      outputDirectory: output,
    });
    assert.equal(proof.status, "failed");
    assert.ok(proof.scenarios.some((scenario) => scenario.responseVerificationErrors > 0));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(output, { recursive: true, force: true });
  }
});

test("query-variant response hashing is bounded when headers arrive but the body stalls", async () => {
  const encoder = new TextEncoder();
  const index = encoder.encode('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stalled query</title><link rel="stylesheet" href="style.css?v=stall"></head><body><main><h1>Stalled query</h1><p>The query verifier must stop without buffering an unbounded host response.</p></main></body></html>');
  const css = encoder.encode("body{color:black}");
  const entries = new Map([["index.html", index], ["style.css", css]]);
  const server = createServer((request, response) => {
    if (request.url === "/") { response.writeHead(200, { "content-type": "text/html" }); response.end(index); return; }
    if (request.url === "/style.css?v=stall") { response.writeHead(200, { "content-type": "text/css" }); response.write("partial"); return; }
    response.writeHead(404); response.end();
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const output = mkdtempSync(join(tmpdir(), "realitycheck-live-browser-stall-"));
  try {
    const address = server.address();
    const deployContentId = await computeDeployContentId(entries);
    const proof = await runLiveDeploymentBrowserProof({
      targetUrl: `http://127.0.0.1:${address.port}/`, entries,
      source: {
        archiveSha256: "a".repeat(64), archiveBytes: 4096, deployContentId,
        publishManifestId: `sha256:${"b".repeat(64)}`,
        finalArchiveBrowserProofId: `sha256:${"c".repeat(64)}`,
      },
      outputDirectory: output,
      limits: { browserRequestTimeoutMs: 10, maxRunTimeMs: 5000 },
    });
    assert.equal(proof.status, "incomplete");
    assert.ok(proof.scenarios.some((scenario) => scenario.reasonCodes.includes("response-verification-incomplete")));
    assert.ok(proof.scenarios.some((scenario) => scenario.capsuleFallbackRequests > 0));
    assert.ok(proof.screenshots.some((item) => item.source === "diagnostic-with-capsule-fallback"));
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    rmSync(output, { recursive: true, force: true });
  }
});

test("stalled query preload handlers settle before viewport status, screenshot source, and proof ID are frozen", async () => {
  const encoder = new TextEncoder();
  const index = encoder.encode('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pending preload</title><link rel="preload" as="image" href="slow.png?v=1"></head><body><main><h1>Pending preload</h1><p>A non-blocking resource must finish verification before this proof is returned.</p></main></body></html>');
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const entries = new Map([["index.html", index], ["slow.png", image]]);
  const server = createServer((request, response) => {
    if (request.url === "/") { response.writeHead(200, { "content-type": "text/html" }); response.end(index); return; }
    if (request.url === "/slow.png?v=1") { response.writeHead(200, { "content-type": "image/png" }); response.write(image.subarray(0, 1)); return; }
    response.writeHead(404); response.end();
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const output = mkdtempSync(join(tmpdir(), "realitycheck-live-browser-preload-"));
  try {
    const address = server.address();
    const deployContentId = await computeDeployContentId(entries);
    const proof = await runLiveDeploymentBrowserProof({
      targetUrl: `http://127.0.0.1:${address.port}/`, entries,
      source: {
        archiveSha256: "a".repeat(64), archiveBytes: 4096, deployContentId,
        publishManifestId: `sha256:${"b".repeat(64)}`,
        finalArchiveBrowserProofId: `sha256:${"c".repeat(64)}`,
      },
      outputDirectory: output,
      limits: { browserRequestTimeoutMs: 20, maxRunTimeMs: 5000 },
    });
    assert.equal(proof.status, "incomplete");
    assert.equal(proof.summary.incomplete, 3);
    for (const scenario of proof.scenarios) {
      assert.equal(scenario.status, "incomplete", scenario.id);
      assert.equal(scenario.coverageTruncated, true, scenario.id);
      assert.ok(scenario.reasonCodes.includes("response-verification-incomplete"), scenario.id);
      assert.ok(scenario.capsuleFallbackRequests > 0, scenario.id);
    }
    for (const screenshot of proof.screenshots) {
      const scenarioId = screenshot.role === "desktop" ? "live-desktop" : "live-mobile-375";
      assert.ok(proof.scenarios.find((scenario) => scenario.id === scenarioId)?.capsuleFallbackRequests > 0);
      assert.equal(screenshot.source, "diagnostic-with-capsule-fallback", screenshot.role);
    }
    const { proofId, ...contract } = proof;
    assert.equal(proofId, `sha256:${createHash("sha256").update(JSON.stringify(contract)).digest("hex")}`);
    const frozen = JSON.stringify(proof);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(JSON.stringify(proof), frozen, "returned proof must not mutate after pending route handlers settle");
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    rmSync(output, { recursive: true, force: true });
  }
});

test("a stalled imported stylesheet cannot extend the whole browser proof without bound", { timeout: 20_000 }, async () => {
  const encoder = new TextEncoder();
  const index = encoder.encode('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Deadline chain</title><link rel="stylesheet" href="root.css"></head><body><main><h1>Deadline chain</h1><p>A nested stylesheet request must obey the whole-proof deadline.</p></main></body></html>');
  const rootCss = encoder.encode('@import url("slow.css?v=1");body{color:#111}');
  const slowCss = encoder.encode("main{max-width:40rem}");
  const entries = new Map([["index.html", index], ["root.css", rootCss], ["slow.css", slowCss]]);
  const server = createServer((request, response) => {
    if (request.url === "/") { response.writeHead(200, { "content-type": "text/html" }); response.end(index); return; }
    if (request.url === "/root.css") { response.writeHead(200, { "content-type": "text/css" }); response.end(rootCss); return; }
    if (request.url === "/slow.css?v=1") { response.writeHead(200, { "content-type": "text/css" }); response.write("partial"); return; }
    response.writeHead(404); response.end();
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const output = mkdtempSync(join(tmpdir(), "realitycheck-live-browser-deadline-"));
  const started = Date.now();
  try {
    const address = server.address();
    const deployContentId = await computeDeployContentId(entries);
    const proof = await runLiveDeploymentBrowserProof({
      targetUrl: `http://127.0.0.1:${address.port}/`, entries,
      source: {
        archiveSha256: "a".repeat(64), archiveBytes: 4096, deployContentId,
        publishManifestId: `sha256:${"b".repeat(64)}`,
        finalArchiveBrowserProofId: `sha256:${"c".repeat(64)}`,
      },
      outputDirectory: output,
      limits: { browserRequestTimeoutMs: 5000, maxRunTimeMs: 1000 },
    });
    assert.notEqual(proof.status, "passed", JSON.stringify(proof.scenarios));
    assert.ok(proof.scenarios.some((scenario) => scenario.reasonCodes.includes("browser-time-limit")));
    assert.ok(Date.now() - started < 18_000, "bounded cleanup must not turn the 1s proof deadline into an indefinite wait");
    const frozen = JSON.stringify(proof);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(JSON.stringify(proof), frozen);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    rmSync(output, { recursive: true, force: true });
  }
});

test("compressed live responses are compared by decoded bytes rather than transfer Content-Length", async () => {
  const encoder = new TextEncoder();
  const index = encoder.encode('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Compressed query</title><link rel="stylesheet" href="style.css?v=gzip"></head><body><main><h1>Compressed query</h1><p>Decoded CSS bytes must remain identical even when gzip framing is larger.</p></main></body></html>');
  const css = encoder.encode("body{color:black}");
  const compressed = gzipSync(css);
  assert.ok(compressed.byteLength > css.byteLength + 1);
  const entries = new Map([["index.html", index], ["style.css", css]]);
  const server = createServer((request, response) => {
    if (request.url === "/") { response.writeHead(200, { "content-type": "text/html" }); response.end(index); return; }
    if (request.url === "/style.css?v=gzip") {
      response.writeHead(200, { "content-type": "text/css", "content-encoding": "gzip", "content-length": compressed.byteLength });
      response.end(compressed);
      return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const output = mkdtempSync(join(tmpdir(), "realitycheck-live-browser-gzip-"));
  try {
    const address = server.address();
    const deployContentId = await computeDeployContentId(entries);
    const proof = await runLiveDeploymentBrowserProof({
      targetUrl: `http://127.0.0.1:${address.port}/`, entries,
      source: {
        archiveSha256: "a".repeat(64), archiveBytes: 4096, deployContentId,
        publishManifestId: `sha256:${"b".repeat(64)}`,
        finalArchiveBrowserProofId: `sha256:${"c".repeat(64)}`,
      },
      outputDirectory: output,
    });
    assert.equal(proof.status, "passed");
    assert.equal(proof.scenarios.every((scenario) => scenario.responseVerificationErrors === 0), true);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    rmSync(output, { recursive: true, force: true });
  }
});

test("oversized live response headers abort the background body transfer", async () => {
  const encoder = new TextEncoder();
  const index = encoder.encode('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Oversized response</title><link rel="stylesheet" href="style.css?v=large"></head><body><main><h1>Oversized response</h1><p>The verifier must close a body it refuses from the headers.</p></main></body></html>');
  const css = encoder.encode("body{color:black}");
  const entries = new Map([["index.html", index], ["style.css", css]]);
  let closedTransfers = 0;
  const server = createServer((request, response) => {
    if (request.url === "/") { response.writeHead(200, { "content-type": "text/html" }); response.end(index); return; }
    if (request.url === "/style.css?v=large") {
      request.socket.once("close", () => { closedTransfers += 1; });
      response.writeHead(200, { "content-type": "text/css", "content-length": 40 * 1024 * 1024 });
      response.write("partial");
      return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const output = mkdtempSync(join(tmpdir(), "realitycheck-live-browser-large-"));
  try {
    const address = server.address();
    const deployContentId = await computeDeployContentId(entries);
    const proof = await runLiveDeploymentBrowserProof({
      targetUrl: `http://127.0.0.1:${address.port}/`, entries,
      source: {
        archiveSha256: "a".repeat(64), archiveBytes: 4096, deployContentId,
        publishManifestId: `sha256:${"b".repeat(64)}`,
        finalArchiveBrowserProofId: `sha256:${"c".repeat(64)}`,
      },
      outputDirectory: output,
    });
    assert.equal(proof.status, "incomplete");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(closedTransfers > 0);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    rmSync(output, { recursive: true, force: true });
  }
});

test("direct wrong bytes dominate a later incomplete response verification", async () => {
  const encoder = new TextEncoder();
  const index = encoder.encode('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mixed evidence</title><link rel="stylesheet" href="stall.css?v=1"><link rel="stylesheet" href="wrong.css?v=1"></head><body><main><h1>Mixed evidence</h1><p>A direct byte contradiction must remain broken even when another response is incomplete.</p></main></body></html>');
  const expected = encoder.encode("body{color:black}");
  const changed = encoder.encode("body{color:red}");
  const entries = new Map([["index.html", index], ["stall.css", expected], ["wrong.css", expected]]);
  const server = createServer((request, response) => {
    if (request.url === "/") { response.writeHead(200, { "content-type": "text/html" }); response.end(index); return; }
    if (request.url === "/stall.css?v=1") { response.writeHead(200, { "content-type": "text/css" }); response.write("partial"); return; }
    if (request.url === "/wrong.css?v=1") { response.writeHead(200, { "content-type": "text/css" }); response.end(changed); return; }
    response.writeHead(404); response.end();
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const output = mkdtempSync(join(tmpdir(), "realitycheck-live-browser-mixed-"));
  try {
    const address = server.address();
    const deployContentId = await computeDeployContentId(entries);
    const proof = await runLiveDeploymentBrowserProof({
      targetUrl: `http://127.0.0.1:${address.port}/`, entries,
      source: {
        archiveSha256: "a".repeat(64), archiveBytes: 4096, deployContentId,
        publishManifestId: `sha256:${"b".repeat(64)}`,
        finalArchiveBrowserProofId: `sha256:${"c".repeat(64)}`,
      },
      outputDirectory: output,
      limits: { browserRequestTimeoutMs: 10, maxRunTimeMs: 5000 },
    });
    assert.equal(proof.status, "failed");
    assert.ok(proof.scenarios.some((scenario) => scenario.responseVerificationErrors > 0 && scenario.coverageTruncated));
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    rmSync(output, { recursive: true, force: true });
  }
});

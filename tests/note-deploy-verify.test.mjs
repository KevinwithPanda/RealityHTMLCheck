import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  NOTE_DEPLOY_HTTP_STATUSES,
  validateNoteDeploymentBaseUrl,
  verifyNoteDeployment,
} from "../realitycheck/scripts/note-deploy-verify.mjs";

const encoder = new TextEncoder();
const id = (character) => `sha256:${character.repeat(64)}`;
const sha = (value) => createHash("sha256").update(value).digest("hex");

function declared(path, body) {
  const bytes = body instanceof Uint8Array ? body : encoder.encode(body);
  return { path, size: bytes.byteLength, sha256: sha(bytes) };
}

function identity(entries, overrides = {}) {
  return {
    status: "ready",
    publishReady: true,
    finalArchiveBrowserProofPassed: true,
    archive: { sha256: "a".repeat(64), bytes: 4096, readBackVerified: true },
    manifest: { manifestId: id("b"), deployContentId: id("c") },
    browserProofId: id("d"),
    entrypoint: "index.html",
    entries,
    ...overrides,
  };
}

function response(body, { status = 200, type = "application/octet-stream", headers = {} } = {}) {
  const values = new Headers(headers);
  if (type !== null) values.set("content-type", type);
  return new Response(body, { status, headers: values });
}

function routedFetch(routes, calls = []) {
  return {
    calls,
    async fetch(url, options) {
      calls.push({ url, options });
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "manual");
      assert.equal(options.credentials, "omit");
      assert.equal(options.body, undefined);
      assert.equal(Object.keys(options.headers).some((name) => /authorization|cookie/i.test(name)), false);
      const route = routes.get(url);
      if (route instanceof Error) throw route;
      if (typeof route === "function") return route(url, options, calls.length);
      if (!route) return response("missing", { status: 404, type: "text/plain" });
      return response(route.body, route);
    },
  };
}

test("exact live bytes require a separate base probe and every declared servable entry", async () => {
  assert.deepEqual(NOTE_DEPLOY_HTTP_STATUSES, ["exact-match", "transformed-review", "broken", "unverified"]);
  const index = "<!doctype html><title>PRIVATE_SENTINEL_PAGE</title><h1>Live</h1>";
  const css = "body{color:#123}";
  const entries = [declared("index.html", index), declared("assets/site.css", css), declared(".nojekyll", new Uint8Array())];
  const base = "http://127.0.0.1:4100/site/";
  const transport = routedFetch(new Map([
    [base, { body: index, type: "text/html; charset=utf-8" }],
    [`${base}index.html`, { body: index, type: "text/html; charset=utf-8" }],
    [`${base}assets/site.css`, { body: css, type: "text/css; charset=utf-8" }],
  ]));
  const result = await verifyNoteDeployment({ baseUrl: base, identity: identity(entries), fetchImpl: transport.fetch, limits: { maxAttempts: 1 } });
  assert.equal(result.status, "exact-match");
  assert.equal(result.target.loopback, true);
  assert.equal(result.target.authorized, true);
  assert.equal(result.target.basePath, "/site/");
  assert.equal(result.baseProbe.outcome, "exact");
  assert.equal(result.baseProbe.expectedEntry, "index.html");
  assert.equal(result.entries.find((entry) => entry.path === "assets/site.css").mime, "text/css");
  assert.equal(result.entries.find((entry) => entry.path === ".nojekyll").outcome, "skipped");
  assert.equal(result.summary.exact, 3);
  assert.equal(result.summary.skipped, 1);
  assert.equal(result.summary.completedChecks, 3);
  assert.equal(result.coverage.complete, true);
  assert.equal(transport.calls.length, 3, "base URL and index.html are intentionally separate probes");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SENTINEL_PAGE|body\{color/);
  assert.equal(result.policy.responseBodiesRetained, false);
});

test("reachable modified bytes produce transformed-review without retaining their body", async () => {
  const index = "<!doctype html><title>Exact</title>";
  const expectedCss = "body{color:black}";
  const liveCss = "body{color:red}/*LIVE_PRIVATE_TEXT*/";
  const entries = [declared("index.html", index), declared("style.css", expectedCss)];
  const base = "http://localhost:4200/";
  const transport = routedFetch(new Map([
    [base, { body: index, type: "text/html" }],
    [`${base}index.html`, { body: index, type: "text/html" }],
    [`${base}style.css`, { body: liveCss, type: "text/css" }],
  ]));
  const result = await verifyNoteDeployment({ baseUrl: base, identity: identity(entries), fetchImpl: transport.fetch, limits: { maxAttempts: 1 } });
  assert.equal(result.status, "transformed-review");
  const changed = result.entries.find((entry) => entry.path === "style.css");
  assert.equal(changed.outcome, "transformed");
  assert.equal(changed.reason, "response-bytes-differ");
  assert.equal(changed.actual.sha256, sha(encoder.encode(liveCss)));
  assert.notEqual(changed.actual.sha256, changed.expected.sha256);
  assert.doesNotMatch(JSON.stringify(result), /LIVE_PRIVATE_TEXT/);
});

test("missing entries and deterministic redirect violations are broken", async (context) => {
  await context.test("missing status", async () => {
    const index = "<!doctype html><title>Index</title>";
    const entries = [declared("index.html", index), declared("missing.png", new Uint8Array([1, 2, 3]))];
    const base = "http://localhost:4300/project/";
    const transport = routedFetch(new Map([
      [base, { body: index, type: "text/html" }],
      [`${base}index.html`, { body: index, type: "text/html" }],
      [`${base}missing.png`, { body: "not found", status: 404, type: "text/plain" }],
    ]));
    const result = await verifyNoteDeployment({ baseUrl: base, identity: identity(entries), fetchImpl: transport.fetch, limits: { maxAttempts: 1 } });
    assert.equal(result.status, "broken");
    assert.equal(result.entries.at(-1).status, 404);
    assert.equal(result.entries.at(-1).reason, "http-status");
  });

  await context.test("external redirect", async () => {
    const index = "<!doctype html><title>Index</title>";
    const base = "http://localhost:4301/site/";
    const transport = routedFetch(new Map([
      [base, { body: index, type: "text/html" }],
      [`${base}index.html`, { body: null, status: 302, type: null, headers: { location: "https://evil.example/index.html" } }],
    ]));
    const result = await verifyNoteDeployment({ baseUrl: base, identity: identity([declared("index.html", index)]), fetchImpl: transport.fetch, limits: { maxAttempts: 1 } });
    assert.equal(result.status, "broken");
    assert.equal(result.entries[0].reason, "redirect-left-origin");
    assert.equal(result.entries[0].redirects[0].toPath, null);
    assert.equal(transport.calls.some((call) => call.url.startsWith("https://evil.example")), false);
  });

  await context.test("base path escape", async () => {
    const index = "<!doctype html><title>Index</title>";
    const base = "http://localhost:4302/repository/";
    const transport = routedFetch(new Map([
      [base, { body: index, type: "text/html" }],
      [`${base}index.html`, { body: null, status: 301, type: null, headers: { location: "/outside/index.html" } }],
    ]));
    const result = await verifyNoteDeployment({ baseUrl: base, identity: identity([declared("index.html", index)]), fetchImpl: transport.fetch, limits: { maxAttempts: 1 } });
    assert.equal(result.status, "broken");
    assert.equal(result.entries[0].reason, "redirect-left-base-path");
  });

  await context.test("same-origin redirects are followed but remain capped", async () => {
    const index = "<!doctype html><title>Canonical</title>";
    const base = "http://localhost:4304/repository/";
    const transport = routedFetch(new Map([
      [base, { body: index, type: "text/html" }],
      [`${base}index.html`, { body: null, status: 302, type: null, headers: { location: "canonical.html" } }],
      [`${base}canonical.html`, { body: index, type: "text/html" }],
    ]));
    const followed = await verifyNoteDeployment({ baseUrl: base, identity: identity([declared("index.html", index)]), fetchImpl: transport.fetch, limits: { maxAttempts: 1, maxRedirects: 2 } });
    assert.equal(followed.status, "exact-match");
    assert.deepEqual(followed.entries[0].redirects, [{ status: 302, fromPath: "index.html", toPath: "canonical.html", decision: "followed" }]);

    const cappedTransport = routedFetch(new Map([
      [base, { body: index, type: "text/html" }],
      [`${base}index.html`, { body: null, status: 302, type: null, headers: { location: "one.html" } }],
      [`${base}one.html`, { body: null, status: 302, type: null, headers: { location: "two.html" } }],
    ]));
    const capped = await verifyNoteDeployment({ baseUrl: base, identity: identity([declared("index.html", index)]), fetchImpl: cappedTransport.fetch, limits: { maxAttempts: 1, maxRedirects: 1 } });
    assert.equal(capped.status, "broken");
    assert.equal(capped.entries[0].reason, "redirect-limit");
    assert.equal(cappedTransport.calls.some((call) => call.url.endsWith("two.html")), false);
  });
});

test("public targets require explicit authorization while loopback does not", async () => {
  let calls = 0;
  const entry = declared("index.html", "<!doctype html><title>Remote</title>");
  const result = await verifyNoteDeployment({
    baseUrl: "https://example.com/site/",
    identity: identity([entry]),
    fetchImpl: async () => { calls += 1; throw new Error("must not run"); },
  });
  assert.equal(result.status, "unverified");
  assert.equal(result.target.authorized, false);
  assert.equal(result.coverage.reasons.includes("remote-authorization-required"), true);
  assert.equal(calls, 0);
  assert.equal(validateNoteDeploymentBaseUrl("http://192.168.1.20/site/").authorized, false, "private-network is not loopback and still requires explicit authorization");

  const base = "http://127.9.8.7:4303/";
  const html = "<!doctype html><title>Loopback</title>";
  const transport = routedFetch(new Map([
    [base, { body: html, type: "text/html" }],
    [`${base}index.html`, { body: html, type: "text/html" }],
  ]));
  const local = await verifyNoteDeployment({ baseUrl: base, identity: identity([declared("index.html", html)]), fetchImpl: transport.fetch, limits: { maxAttempts: 1 } });
  assert.equal(local.status, "exact-match");
});

test("bounded retry covers a timeout and short post-deploy 404 propagation", async () => {
  const index = "<!doctype html><title>Propagated</title>";
  const css = "body{max-width:70rem}";
  const base = "http://localhost:4400/site/";
  const attempts = new Map();
  const sleeps = [];
  const fetchImpl = async (url, options) => {
    const count = (attempts.get(url) || 0) + 1;
    attempts.set(url, count);
    if (url === base && count === 1) {
      return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true }));
    }
    if (url === `${base}style.css` && count === 1) return response("not ready", { status: 404, type: "text/plain" });
    if (url === base || url === `${base}index.html`) return response(index, { type: "text/html" });
    if (url === `${base}style.css`) return response(css, { type: "text/css" });
    throw new Error(`unexpected URL ${url}`);
  };
  const result = await verifyNoteDeployment({
    baseUrl: base,
    identity: identity([declared("index.html", index), declared("style.css", css)]),
    fetchImpl,
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
    limits: { maxAttempts: 2, retryDelayMs: 0, requestTimeoutMs: 5 },
  });
  assert.equal(result.status, "exact-match");
  assert.equal(result.baseProbe.attempts, 2);
  assert.equal(result.entries.find((entry) => entry.path === "style.css").attempts, 2);
  assert.deepEqual(sleeps, [0, 0]);

  let failures = 0;
  const unavailable = await verifyNoteDeployment({
    baseUrl: "http://localhost:4401/",
    identity: identity([declared("index.html", index)]),
    fetchImpl: async () => { failures += 1; throw new Error("connection refused PRIVATE_DETAIL"); },
    sleep: async () => {},
    limits: { maxAttempts: 2, retryDelayMs: 0 },
  });
  assert.equal(unavailable.status, "unverified");
  assert.equal(unavailable.baseProbe.reason, "network-error");
  assert.equal(unavailable.entries[0].attempts, 2);
  assert.equal(failures, 4, "base and index each receive the bounded retry allowance");
  assert.doesNotMatch(JSON.stringify(unavailable), /PRIVATE_DETAIL|connection refused/);
});

test("request timeout remains active while a response body stalls after headers", async () => {
  const html = "<!doctype html><title>Body deadline</title>";
  const base = "http://localhost:4450/";
  const stalled = () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode("partial")); },
  }), { status: 200, headers: { "content-type": "text/html" } });
  const result = await verifyNoteDeployment({
    baseUrl: base,
    identity: identity([declared("index.html", html)]),
    fetchImpl: async () => stalled(),
    limits: { maxAttempts: 1, requestTimeoutMs: 5, maxRunTimeMs: 50 },
  });
  assert.equal(result.status, "unverified");
  assert.equal(result.baseProbe.reason, "request-timeout");
  assert.equal(result.entries[0].reason, "request-timeout");
});

test("one global deadline stops the remaining inventory with explicit unverified coverage", async () => {
  const html = "<!doctype html><title>Global deadline</title>";
  let clock = 0;
  let calls = 0;
  const result = await verifyNoteDeployment({
    baseUrl: "http://localhost:4451/",
    identity: identity([declared("index.html", html), declared("asset.txt", "asset")]),
    fetchImpl: async () => { calls += 1; return response(html, { type: "text/html" }); },
    now: () => { clock += 10; return clock; },
    limits: { maxAttempts: 1, maxRunTimeMs: 5 },
  });
  assert.equal(result.status, "unverified");
  assert.equal(result.baseProbe.reason, "global-time-limit");
  assert.ok(result.entries.every((entry) => entry.reason === "global-time-limit"));
  assert.equal(calls, 0);
});

test("coverage ceilings return unverified without making a partial request", async () => {
  const entries = [declared("index.html", "<title>A</title>"), declared("other.html", "<title>B</title>")];
  let calls = 0;
  const result = await verifyNoteDeployment({
    baseUrl: "http://localhost:4500/",
    identity: identity(entries),
    fetchImpl: async () => { calls += 1; throw new Error("must not fetch a partial prefix"); },
    limits: { maxEntries: 1, maxExpectedBytes: 1 },
  });
  assert.equal(result.status, "unverified");
  assert.equal(result.coverage.ceilingExceeded, true);
  assert.equal(result.coverage.reasons.includes("entry-count-limit"), true);
  assert.equal(result.coverage.reasons.includes("expected-bytes-limit"), true);
  assert.equal(result.summary.completedChecks, 0);
  assert.equal(calls, 0);

  const index = "<!doctype html><title>Budget</title>";
  const css = "body{color:black}";
  const base = "http://localhost:4501/";
  const transport = routedFetch(new Map([
    [base, { body: index, type: "text/html" }],
    [`${base}index.html`, { body: index, type: "text/html" }],
    [`${base}style.css`, { body: css, type: "text/css" }],
  ]));
  const runtimeLimited = await verifyNoteDeployment({
    baseUrl: base,
    identity: identity([declared("index.html", index), declared("style.css", css)]),
    fetchImpl: transport.fetch,
    limits: { maxAttempts: 1, maxTotalResponseBytes: encoder.encode(index).byteLength + 1 },
  });
  assert.equal(runtimeLimited.status, "unverified");
  assert.equal(runtimeLimited.entries[0].reason, "total-response-bytes-limit");
  assert.equal(runtimeLimited.entries[1].attempts, 0, "remaining entries are not contacted after the global byte ceiling");
  assert.equal(transport.calls.length, 2, "only the base and first entry were contacted");
});

test("unicode base paths and encoded archive names are requested without path ambiguity", async () => {
  const index = "<!doctype html><title>Unicode</title>";
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
  const path = "资料/图 #1%.svg";
  const target = validateNoteDeploymentBaseUrl("http://localhost:4600/笔记/");
  assert.equal(target.basePath, "/%E7%AC%94%E8%AE%B0/");
  const assetUrl = `${target.baseUrl}%E8%B5%84%E6%96%99/%E5%9B%BE%20%231%25.svg`;
  const transport = routedFetch(new Map([
    [target.baseUrl, { body: index, type: "text/html" }],
    [`${target.baseUrl}index.html`, { body: index, type: "text/html" }],
    [assetUrl, { body: svg, type: "image/svg+xml" }],
  ]));
  const result = await verifyNoteDeployment({
    baseUrl: "http://localhost:4600/笔记/",
    identity: identity([declared("index.html", index), declared(path, svg)]),
    fetchImpl: transport.fetch,
    limits: { maxAttempts: 1 },
  });
  assert.equal(result.status, "exact-match");
  assert.equal(transport.calls.some((call) => call.url === assetUrl), true);
  assert.equal(result.entries.find((entry) => entry.path === path).finalPath, "%E8%B5%84%E6%96%99/%E5%9B%BE%20%231%25.svg");
});

test("URL and publish identity validation fail before network access", async () => {
  const entry = declared("index.html", "<title>x</title>");
  const validIdentity = identity([entry]);
  for (const [url, expected] of [
    ["ftp://localhost/site/", /http or https/],
    ["https://user:secret@example.com/site/", /credentials/],
    ["https://example.com/site/?token=x", /query or fragment/],
    ["https://example.com/site/#private", /query or fragment/],
    ["https://example.com/site", /end with a slash/],
    ["https://example.com/%2e%2e/site/", /unsafe decoded path segment/],
    ["https://example.com/site%2fsub/", /unsafe encoded path/],
  ]) await assert.rejects(verifyNoteDeployment({ baseUrl: url, allowRemote: true, identity: validIdentity, fetchImpl: async () => { throw new Error("must not fetch"); } }), expected);
  await assert.rejects(verifyNoteDeployment({
    baseUrl: "http://localhost:4700/",
    identity: identity([entry], { publishReady: false }),
    fetchImpl: async () => { throw new Error("must not fetch"); },
  }), /publish-ready capsule/);
});

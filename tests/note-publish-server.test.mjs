import assert from "node:assert/strict";
import test from "node:test";

import { publishContentType, resolvePublishRequest, startPublishByteServer } from "../realitycheck/scripts/note-publish-server.mjs";

const encoder = new TextEncoder();

function fixtureEntries() {
  return new Map([
    ["index.html", encoder.encode("<!doctype html><title>Exact</title><h1>Exact bytes</h1>")],
    ["assets/raw.bin", new Uint8Array([0, 255, 1, 128, 13, 10])],
    ["assets/site.css", encoder.encode("h1{color:#123456}")],
  ]);
}

test("publish byte server serves exact archive entry bytes at root and project mounts", async () => {
  const entries = fixtureEntries();
  const tracker = { count: 0 };
  const server = await startPublishByteServer(entries, tracker);
  try {
    for (const path of ["/", "/project/", "/index.html?cache=1", "/project/index.html#ignored"]) {
      const response = await fetch(`${server.origin}${path}`);
      assert.equal(response.status, 200, path);
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), entries.get("index.html"), path);
      assert.equal(response.headers.get("content-length"), String(entries.get("index.html").byteLength));
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    }
    const binary = await fetch(`${server.origin}/project/assets/raw.bin`);
    assert.equal(binary.status, 200);
    assert.deepEqual(new Uint8Array(await binary.arrayBuffer()), entries.get("assets/raw.bin"));
    assert.equal(binary.headers.get("content-type"), "application/octet-stream");
    const head = await fetch(`${server.origin}/project/assets/site.css`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal(head.headers.get("content-length"), String(entries.get("assets/site.css").byteLength));
    assert.equal(tracker.count, 6);
    assert.equal(tracker.requests.length, 6);
    assert.equal(tracker.requests.every((entry) => entry.status === 200), true);
    assert.equal(tracker.requests.filter((entry) => entry.hadQuery).length, 1);
  } finally {
    await server.close();
  }
});

test("publish byte server rejects mount escape, encoded separators, directories, and unsafe methods", async () => {
  const entries = fixtureEntries();
  const tracker = { count: 0 };
  const server = await startPublishByteServer(entries, tracker);
  try {
    const requests = [
      ["/project/missing.bin", {}, 404],
      ["/project/assets/", {}, 404],
      ["/offline/index.html", {}, 404],
      ["/project/%2findex.html", {}, 404],
      ["/project/%5cindex.html", {}, 404],
      ["/project/index.html", { method: "POST", body: "no" }, 405],
    ];
    for (const [path, options, expected] of requests) {
      const response = await fetch(`${server.origin}${path}`, options);
      assert.equal(response.status, expected, path);
    }
    assert.equal(tracker.requests.some((entry) => entry.status === 405), true);
    assert.equal(tracker.requests.some((entry) => entry.status === 404), true);
  } finally {
    await server.close();
  }
});

test("publish server request evidence limit fails closed with 429 and truncation", async () => {
  const entries = fixtureEntries();
  const tracker = { count: 0 };
  const server = await startPublishByteServer(entries, tracker, { limits: { maxRequests: 2, maxRecordedPathCharacters: 40 } });
  try {
    assert.equal((await fetch(`${server.origin}/`)).status, 200);
    assert.equal((await fetch(`${server.origin}/project/`)).status, 200);
    assert.equal((await fetch(`${server.origin}/index.html`)).status, 429);
    assert.equal(tracker.count, 3);
    assert.equal(tracker.requests.length, 2);
    assert.equal(tracker.truncated, true);
  } finally {
    await server.close();
  }
});

test("request resolver and MIME map are deterministic and do not guess", async () => {
  const entries = fixtureEntries();
  assert.deepEqual(resolvePublishRequest("/project/?x=1", entries), { mount: "/project/", path: "index.html", hadQuery: true, hadFragment: false });
  assert.equal(resolvePublishRequest("/project/assets/", entries), null);
  assert.equal(resolvePublishRequest("/project/../index.html", entries), null);
  assert.equal(resolvePublishRequest("/project/%2E%2E/index.html", entries), null);
  assert.equal(publishContentType("FONT.WOFF2"), "font/woff2");
  assert.equal(publishContentType("unknown.bin"), "application/octet-stream");
  await assert.rejects(startPublishByteServer(new Map(), {}), /non-empty/);
});

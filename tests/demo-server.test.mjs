import assert from "node:assert/strict";
import test from "node:test";

import { startBundledDemoServer } from "../realitycheck/scripts/demo-server.mjs";

test("bundled demo server is loopback-only, finite, and read-only", async () => {
  const demo = await startBundledDemoServer();
  try {
    const url = new URL(demo.url);
    assert.equal(url.hostname, "127.0.0.1");
    assert.ok(Number(url.port) > 0);

    const page = await fetch(demo.url);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.match(page.headers.get("content-security-policy"), /form-action 'none'/);
    assert.match(await page.text(), /INTENTIONALLY BROKEN/);

    const head = await fetch(new URL("styles.css", demo.url), { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.ok(Number(head.headers.get("content-length")) > 100);

    const api = await fetch(new URL("api/orders.json?ignored=1", demo.url));
    assert.equal(api.status, 200);
    assert.equal((await api.json()).length, 3);

    assert.equal((await fetch(new URL("..%2Fpackage.json", demo.url))).status, 404);
    assert.equal((await fetch(new URL("unknown", demo.url))).status, 404);
    assert.equal((await fetch(demo.url, { method: "POST" })).status, 405);
  } finally {
    await demo.close();
    await demo.close();
  }
});

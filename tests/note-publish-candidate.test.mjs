import assert from "node:assert/strict";
import test from "node:test";

import { preparePublishCandidate } from "../realitycheck/scripts/note-publish-candidate.mjs";
import { computeDeployContentId } from "../realitycheck/scripts/note-publish-browser.mjs";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const bytes = (value) => encoder.encode(value);
const healthy = (body = '<h1 id="start">Portable note</h1><p>This is a complete portable note with enough meaningful text for publication.</p>') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Portable note</title></head><body>${body}</body></html>`;

test("publish candidate applies safe metadata and unique path repairs then binds exact deploy bytes", async () => {
  const candidate = preparePublishCandidate(new Map([
    ["note.html", bytes('<html><head><title>Note</title><meta name="viewport" content="width=device-width"></head><body><h1>Note</h1><p>This complete note contains a local illustration for portable sharing.</p><img src="Images\\Hero.PNG" alt="Hero"></body></html>')],
    ["images/Hero.png", bytes("png")],
  ]));
  assert.equal(candidate.entry, "note.html");
  assert.equal(candidate.gatewayGenerated, true);
  assert.match(decoder.decode(candidate.entries.get("note.html")), /src="images\/Hero\.png"/);
  assert.equal(candidate.changes.metadata.length, 3);
  assert.equal(candidate.changes.references.length, 1);
  assert.match(candidate.deployContentId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(await computeDeployContentId(candidate.contentContract.entries), candidate.deployContentId);
  assert.equal(candidate.staticGatePassed, true);
  assert.equal(candidate.entries.has("index.html"), true);
  assert.equal(candidate.entries.has("404.html"), true);
  assert.equal(candidate.entries.has(".nojekyll"), true);
});

test("publish candidate blocks active content before path editing", () => {
  const candidate = preparePublishCandidate(new Map([
    ["index.html", bytes(healthy('<h1>Note</h1><script>const x = "<img src=\\"Images\\\\Hero.PNG\\">"</script>'))],
    ["images/Hero.png", bytes("png")],
  ]));
  assert.equal(candidate.staticGatePassed, false);
  assert.equal(candidate.blockers.some((item) => item.code === "active-script"), true);
  assert.equal(candidate.changes.pathRepairSkippedForActiveContent, true);
});

test("publish candidate blocks deterministic note errors and external runtime dependencies", () => {
  const broken = preparePublishCandidate(new Map([["index.html", bytes(healthy('<h1>Note</h1><img src="missing.png" alt="Missing">'))]]));
  assert.equal(broken.blockers.some((item) => item.code === "note-missing-local-file"), true);
  const remote = preparePublishCandidate(new Map([["index.html", bytes(healthy('<h1>Note</h1><img src="https://cdn.example/image.png" alt="Remote">'))]]));
  assert.equal(remote.blockers.some((item) => item.code === "note-remote-dependency"), true);
});

test("publish candidate requires explicit entry when a folder has multiple pages", () => {
  const entries = new Map([["a.html", bytes(healthy())], ["b.html", bytes(healthy())]]);
  assert.throws(() => preparePublishCandidate(entries), /pass --entry/);
  assert.equal(preparePublishCandidate(entries, { entry: "b.html" }).entry, "b.html");
});

test("deploy identity uses locale-independent ordering for Unicode paths", async () => {
  const candidate = preparePublishCandidate(new Map([
    ["中/图.svg", bytes("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>")],
    ["index.html", bytes(healthy())],
    ["é/readme.txt", bytes("note")],
  ]));
  assert.deepEqual(candidate.contentContract.entries.map((entry) => entry.path), [".nojekyll", "404.html", "index.html", "é/readme.txt", "中/图.svg"]);
  assert.equal(await computeDeployContentId(candidate.contentContract.entries), candidate.deployContentId);
});

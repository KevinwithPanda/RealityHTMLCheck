import assert from "node:assert/strict";
import test from "node:test";

import { buildPublishLayout, choosePublishEntry, inspectPassiveStaticEntries, publishPlatformDecisions } from "../realitycheck/scripts/note-publish-policy.mjs";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const entry = (path, text = "") => ({ path, bytes: encoder.encode(text) });

test("publish entry selection never guesses among multiple HTML files", () => {
  assert.deepEqual(choosePublishEntry(["index.html", "guide.html"]), { entry: "index.html", selectedBy: "root-index", htmlPaths: ["guide.html", "index.html"] });
  assert.equal(choosePublishEntry(["notes/only.html", "assets/x.svg"]).entry, "notes/only.html");
  assert.throws(() => choosePublishEntry(["a.html", "b.html"]), /pass --entry/);
  assert.throws(() => choosePublishEntry(["index.html", "other.html"], "other.html"), /root index\.html already exists/);
  assert.throws(() => choosePublishEntry(["readme.txt"]), /no HTML entry/);
});

test("non-root entry receives a passive root gateway, 404 page, and nojekyll marker", () => {
  const layout = buildPublishLayout([
    entry("notes/研究 note.html", '<!doctype html><html><body><h1 id="topic">Note</h1></body></html>'),
    entry("notes/assets/x.svg", '<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
  ], "notes/研究 note.html");
  assert.equal(layout.gatewayGenerated, true);
  assert.equal(layout.launchPath, "notes/研究 note.html");
  assert.equal(layout.entries.has(".nojekyll"), true);
  assert.equal(layout.entries.has("404.html"), true);
  const gateway = decoder.decode(layout.entries.get("index.html"));
  assert.match(gateway, /notes\/%E7%A0%94%E7%A9%B6%20note\.html/);
  assert.doesNotMatch(gateway, /<script/i);
  assert.throws(() => buildPublishLayout([entry("index.html", "index"), entry("other.html", "other")], "other.html"), /overwrite/);
});

test("passive-static policy blocks active, server, reserved, and oversized surfaces before browser launch", () => {
  const result = inspectPassiveStaticEntries([
    entry("index.html", '<html><body onload="go()"><script src="app.js"></script><form></form><iframe src="x"></iframe></body></html>'),
    entry("media.html", '<video src="clip.mp4" autoplay></video>'),
    entry("app.js", "alert(1)"),
    entry("functions/submit.js", "export default {}"),
    entry("realitycheck-proof/manifest.json", "{}"),
    entry("image.svg", '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject></foreignObject></svg>'),
  ]);
  const codes = new Set(result.blockers.map((item) => item.code));
  for (const code of ["active-script", "inline-event-handler", "form-submission", "embedded-active-content", "media-autoplay", "active-code-file", "server-runtime-file", "reserved-proof-path", "svg-foreign-object"]) assert.equal(codes.has(code), true, code);
});

test("passive policy ignores comments and ordinary prose while still blocking real active tags", () => {
  const harmless = inspectPassiveStaticEntries(new Map([["index.html", encoder.encode('<!doctype html><!-- <script src="x.js"></script> --><p>Example text: onload= and javascript:</p>')]]));
  assert.deepEqual(harmless.blockers, []);
  const active = inspectPassiveStaticEntries(new Map([["index.html", encoder.encode('<!doctype html><img alt=">" src="x.png" onload="run()">')]]));
  assert.equal(active.blockers.some((item) => item.code === "inline-event-handler"), true);
});

test("passive policy refuses invalid UTF-8 markup with the exact path", () => {
  assert.throws(() => inspectPassiveStaticEntries(new Map([["broken.html", new Uint8Array([0xff, 0xfe])]])), /valid UTF-8: broken\.html/);
});

test("platform decisions distinguish direct ZIP support from GitHub Pages source deployment", () => {
  const clean = publishPlatformDecisions({ files: 20, bytes: 2_000_000, maxFileBytes: 100_000, hasRootIndex: true, browserProofPassed: true, projectMountPassed: true, blockers: [] });
  assert.equal(clean.netlifyDrop.status, "pass");
  assert.equal(clean.cloudflarePagesDirectUpload.status, "review");
  assert.ok(clean.cloudflarePagesDirectUpload.reasons.includes("cloudflare-direct-upload-cannot-switch-to-git"));
  assert.equal(clean.githubPages.status, "review");
  assert.ok(clean.githubPages.reasons.includes("github-pages-zip-requires-extraction-or-action"));

  const large = publishPlatformDecisions({ files: 20, bytes: 49_000_000, maxFileBytes: 11 * 1024 * 1024, hasRootIndex: true, browserProofPassed: true, projectMountPassed: true, blockers: [] });
  assert.equal(large.netlifyDrop.status, "review");
  assert.equal(large.cloudflarePagesDirectUpload.status, "review");
  const blocked = publishPlatformDecisions({ files: 20, bytes: 1, maxFileBytes: 1, hasRootIndex: true, browserProofPassed: false, projectMountPassed: false, blockers: [{ code: "x" }] });
  assert.equal(blocked.netlifyDrop.status, "block");
  assert.equal(blocked.cloudflarePagesDirectUpload.status, "block");
  assert.equal(blocked.githubPages.status, "block");
});

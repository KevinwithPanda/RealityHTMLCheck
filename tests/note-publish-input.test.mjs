import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadPublishInput } from "../realitycheck/scripts/note-publish-input.mjs";
import { writeStoredZip } from "../realitycheck/scripts/note-zip.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-publish-input-"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("publish input freezes a complete directory without adding its outer folder", async () => {
  const item = fixture();
  try {
    mkdirSync(join(item.root, "assets"));
    writeFileSync(join(item.root, "index.html"), "<!doctype html><title>Note</title>");
    writeFileSync(join(item.root, "assets", "图.png"), "png");
    const loaded = await loadPublishInput(item.root, { name: "My Notes" });
    assert.deepEqual([...loaded.entries.keys()], ["assets/图.png", "index.html"]);
    assert.equal(loaded.slug, "my-notes");
    assert.equal(loaded.sourceKind, "directory");
    assert.match(loaded.sourceContentId, /^sha256:[a-f0-9]{64}$/);
  } finally { item.cleanup(); }
});

test("publish input blocks sensitive trees", async () => {
  const sensitive = fixture();
  try {
    writeFileSync(join(sensitive.root, "index.html"), "<title>x</title>");
    writeFileSync(join(sensitive.root, ".env"), "SECRET=x");
    await assert.rejects(() => loadPublishInput(sensitive.root), /sensitive/);
  } finally { sensitive.cleanup(); }
});

test("publish input fails closed on symbolic links when the platform permits them", async (context) => {
  const item = fixture();
  try {
    writeFileSync(join(item.root, "index.html"), "<title>x</title>");
    try { symlinkSync(join(item.root, "index.html"), join(item.root, "linked.html")); }
    catch { context.skip("symbolic link creation is unavailable"); return; }
    await assert.rejects(() => loadPublishInput(item.root), /Symbolic links/);
  } finally { item.cleanup(); }
});

test("publish ZIP intake verifies bytes and strips exactly one common export root", async () => {
  const item = fixture();
  try {
    const archive = await writeStoredZip([
      { path: "Export/index.html", bytes: new TextEncoder().encode("<!doctype html><title>ZIP note</title>") },
      { path: "Export/assets/a.txt", bytes: new TextEncoder().encode("asset") },
    ], { output: "uint8array" });
    const path = join(item.root, "notes.zip");
    writeFileSync(path, archive);
    const loaded = await loadPublishInput(path);
    assert.equal(loaded.sourceKind, "zip");
    assert.equal(loaded.rootStripped, true);
    assert.deepEqual([...loaded.entries.keys()], ["assets/a.txt", "index.html"]);
    assert.equal(loaded.archiveManifest.archiveName, "notes.zip");
  } finally { item.cleanup(); }
});

test("a prepared repair copy keeps the original package name unless --name overrides it", async () => {
  const item = fixture();
  try {
    const run = join(item.root, "run");
    const repaired = join(run, "repaired");
    mkdirSync(repaired, { recursive: true });
    writeFileSync(join(repaired, "index.html"), "<!doctype html><title>Note</title>");
    writeFileSync(join(run, "report.json"), JSON.stringify({ kind: "html-note-check-bundle", input: { name: "Original Research Notes" } }));
    assert.equal((await loadPublishInput(repaired)).slug, "original-research-notes");
    assert.equal((await loadPublishInput(repaired, { name: "Reviewed Release" })).slug, "reviewed-release");
  } finally { item.cleanup(); }
});

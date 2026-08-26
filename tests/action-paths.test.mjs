import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { resolveActionPaths } from "../realitycheck/scripts/action-paths.mjs";

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-action-paths-"));
  mkdirSync(join(root, "project", "notes"), { recursive: true });
  writeFileSync(join(root, "project", "notes", "index.html"), "<!doctype html>", "utf8");
  return root;
}

test("Action paths resolve one canonical note scope and artifact directory", () => {
  const root = workspace();
  try {
    mkdirSync(join(root, "project", "baseline"));
    writeFileSync(join(root, "project", "baseline", "report.json"), "{}", "utf8");
    const result = resolveActionPaths({
      workspace: root,
      workingDirectory: "project",
      kind: "note",
      notePath: "notes/index.html",
      baseline: "baseline/report.json",
      output: ".realitycheck/notes",
    });
    assert.equal(result.workingDirectory, "project");
    assert.equal(result.notePath, "notes/index.html");
    assert.equal(result.output, ".realitycheck/notes");
    assert.equal(result.reportRoot, "project/.realitycheck/notes");
    assert.equal(result.baseline, "baseline/report.json");
    assert.match(result.baselineAbsolute, /project[\\/]baseline[\\/]report\.json$/);
    assert.equal(result.sourceRoot, "project/notes");
    assert.match(result.artifactPath, /project[\\/].realitycheck[\\/]notes$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Action paths reject workflow injection, glob uploads, escapes, and output aliases", () => {
  const root = workspace();
  try {
    const base = { workspace: root, workingDirectory: "project", kind: "note", notePath: "notes", output: ".realitycheck/notes" };
    for (const [field, value] of [
      ["workingDirectory", "project\n../outside"],
      ["workingDirectory", "project/*"],
      ["notePath", "../outside"],
      ["notePath", "notes/[abc]"],
      ["baseline", "../outside.json"],
      ["baseline", "baseline/[abc].json"],
      ["output", "*"],
      ["output", "../outside"],
      ["output", "."],
    ]) assert.throws(() => resolveActionPaths({ ...base, [field]: value }), /cannot|must|outside|child directory/);
    assert.throws(() => resolveActionPaths({ ...base, baseline: "missing.json" }), /existing regular file/);
    mkdirSync(join(root, "project", ".realitycheck", "notes"), { recursive: true });
    writeFileSync(join(root, "project", ".realitycheck", "notes", "latest.json"), "{}", "utf8");
    assert.throws(() => resolveActionPaths({ ...base, baseline: ".realitycheck/notes/latest.json" }), /mutable top-level report/);
    assert.throws(() => resolveActionPaths({ ...base, output: "notes" }), /same location/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Action paths resolve existing symlink ancestors before containment checks", { skip: process.platform === "win32" }, () => {
  const root = workspace();
  const outside = mkdtempSync(join(tmpdir(), "realitycheck-action-outside-"));
  try {
    symlinkSync(outside, join(root, "project", "escape"), "dir");
    const base = { workspace: root, workingDirectory: "project", kind: "note", notePath: "notes", output: ".realitycheck/notes" };
    assert.throws(() => resolveActionPaths({ ...base, notePath: "escape/note.html" }), /outside working-directory/);
    assert.throws(() => resolveActionPaths({ ...base, output: "escape/reports" }), /outside working-directory/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

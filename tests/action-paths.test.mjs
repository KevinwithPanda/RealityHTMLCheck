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

test("Action paths isolate one publish invocation beneath the configured output root", () => {
  const root = workspace();
  try {
    const result = resolveActionPaths({
      workspace: root,
      workingDirectory: "project",
      kind: "publish",
      notePath: "notes",
      output: ".realitycheck/publish",
      publishRunKey: "action-12345-2",
      materializeOutput: ".realitycheck/pages-stage",
    });
    assert.equal(result.workingDirectory, "project");
    assert.equal(result.notePath, "notes");
    assert.equal(result.publishRunKey, "action-12345-2");
    assert.equal(result.output, ".realitycheck/publish/action-12345-2");
    assert.equal(result.reportRoot, "project/.realitycheck/publish/action-12345-2");
    assert.equal(result.sourceRoot, "project/notes");
    assert.match(result.artifactPath, /project[\\/].realitycheck[\\/]publish[\\/]action-12345-2$/);
    assert.equal(result.materializeOutput, ".realitycheck/pages-stage");
    assert.equal(result.materializeReceipt, ".realitycheck/pages-stage.realitycheck-stage.receipt.json");
    assert.equal(result.materializeRoot, "project/.realitycheck/pages-stage");
    assert.equal(result.materializeReceiptRoot, "project/.realitycheck/pages-stage.realitycheck-stage.receipt.json");
    assert.match(result.materializeOutputAbsolute, /project[\\/].realitycheck[\\/]pages-stage$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Action publish paths require an isolated run key and reject note-only baselines", () => {
  const root = workspace();
  try {
    const base = { workspace: root, workingDirectory: "project", kind: "publish", notePath: "notes", output: ".realitycheck/publish" };
    assert.throws(() => resolveActionPaths(base), /publish-run-key is required/);
    assert.throws(() => resolveActionPaths({ ...base, publishRunKey: "../escape" }), /cannot escape/);
    assert.throws(() => resolveActionPaths({ ...base, publishRunKey: "custom/nested" }), /must match action-RUN_ID-RUN_ATTEMPT/);
    assert.throws(() => resolveActionPaths({ ...base, publishRunKey: "action-1-1", baseline: "prior.json" }), /baseline is not supported/);
    assert.throws(() => resolveActionPaths({ ...base, notePath: ".", publishRunKey: "action-1-1" }), /separate, non-nested/);
    assert.throws(() => resolveActionPaths({ ...base, output: "notes/results", publishRunKey: "action-1-1" }), /separate, non-nested/);
    assert.throws(() => resolveActionPaths({ ...base, kind: "note", publishRunKey: "action-1-1" }), /only valid when kind is publish/);
    assert.throws(() => resolveActionPaths({ ...base, kind: "web", publishRunKey: "", materializeOutput: "stage" }), /only valid when kind is publish/);
    assert.throws(() => resolveActionPaths({ ...base, publishRunKey: "action-1-1", materializeOutput: "notes/stage" }), /separate, non-nested/);
    assert.throws(() => resolveActionPaths({ ...base, publishRunKey: "action-1-1", materializeOutput: ".realitycheck/publish/action-1-1/stage" }), /separate, non-nested/);
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
    assert.throws(() => resolveActionPaths({ workspace: root, workingDirectory: "project", kind: "publish", notePath: "notes", output: ".realitycheck/publish", publishRunKey: "action-1-1", materializeOutput: "escape/stage" }), /symbolic-link ancestor/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

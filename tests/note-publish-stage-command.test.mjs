import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runPublishStageCommand } from "../realitycheck/scripts/note-publish-stage-command.mjs";

function receipt() {
  return {
    schemaVersion: "1",
    kind: "html-note-publish-stage-receipt",
    generatedAt: "2026-08-27T00:00:00.000Z",
    status: "ready-for-static-host-artifact",
    source: {
      publishStatus: "ready",
      receiptFilename: "notes.realitycheck-publish.receipt.json",
      archiveFilename: "notes.realitycheck-publish.zip",
      archiveBytes: 123,
      archiveSha256: "a".repeat(64),
      deployContentId: `sha256:${"b".repeat(64)}`,
      finalArchiveBrowserProofId: `sha256:${"c".repeat(64)}`,
    },
    stage: {
      contract: "realitycheck-publish-stage-v1",
      contentId: `sha256:${"d".repeat(64)}`,
      files: 1,
      bytes: 42,
      entrypoint: "index.html",
      entries: [{ path: "index.html", size: 42, sha256: "e".repeat(64) }],
    },
    checks: { evidenceValidated: true, archiveReadBackVerified: true, destinationWasAbsent: true, regularFilesOnly: true, entryCoverageComplete: true, byteForByte: true },
    boundaries: { sourceModified: false, receiptWrittenIntoSite: false, uploaded: false, deployed: false },
  };
}

test("materialize command writes a validated receipt outside the staged site", async () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-stage-command-"));
  try {
    const output = join(root, "site");
    const receiptPath = join(root, "receipt.json");
    let sourceSeen = null;
    const code = await runPublishStageCommand(["publish-run", "--output", output, "--receipt", receiptPath], {
      async stageVerifiedPublishCapsule(source, destination) {
        sourceSeen = source;
        assert.equal(destination, output);
        mkdirSync(destination);
        return receipt();
      },
      validateArtifactFiles(paths) {
        assert.deepEqual(paths, [receiptPath]);
        return [{ path: receiptPath, kind: "html-note-publish-stage-receipt", valid: true, errors: [] }];
      },
    });
    assert.equal(code, 0);
    assert.equal(sourceSeen, "publish-run");
    assert.equal(JSON.parse(readFileSync(receiptPath, "utf8")).kind, "html-note-publish-stage-receipt");
    assert.equal(existsSync(join(output, "receipt.json")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("materialize command removes only its new staged tree when receipt validation fails", async () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-stage-command-fail-"));
  try {
    const output = join(root, "site");
    const receiptPath = join(root, "receipt.json");
    await assert.rejects(runPublishStageCommand(["publish-run", "--output", output, "--receipt", receiptPath], {
      async stageVerifiedPublishCapsule(_source, destination) {
        mkdirSync(destination);
        return receipt();
      },
      validateArtifactFiles() {
        return [{ path: receiptPath, kind: "html-note-publish-stage-receipt", valid: false, errors: ["tampered"] }];
      },
    }), /failed validation/);
    assert.equal(existsSync(output), false);
    assert.equal(existsSync(receiptPath), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("materialize command requires an explicit absent output and external receipt", async () => {
  await assert.rejects(runPublishStageCommand(["run"]), /requires --output/);
  await assert.rejects(runPublishStageCommand(["run", "--output", "site", "--receipt", "site/receipt.json"]), /outside/);
  await assert.rejects(runPublishStageCommand(["run", "--output", "site", "--unknown"]), /Unknown/);
});

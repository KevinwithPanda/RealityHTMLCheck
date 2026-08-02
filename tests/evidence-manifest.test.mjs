import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateArtifactFiles } from "../realitycheck/scripts/artifact-validator.mjs";
import { writeEvidenceManifest } from "../realitycheck/scripts/evidence-manifest.mjs";

test("evidence manifest validates every captured file and detects later tampering", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-integrity-"));
  try {
    mkdirSync(join(root, "screenshots"));
    writeFileSync(join(root, "report.json"), "{\"score\":100}\n", "utf8");
    writeFileSync(join(root, "report.html"), "<!doctype html><title>Evidence</title>", "utf8");
    writeFileSync(join(root, "screenshots", "baseline.png"), Buffer.from([137, 80, 78, 71]));
    const output = writeEvidenceManifest(root, {
      artifactKind: "page-audit",
      runId: "integrity-demo",
      target: "http://127.0.0.1:4175/",
    }, { generatedAt: new Date("2026-08-01T17:30:00Z") });
    assert.equal(output.manifest.summary.files, 3);
    assert.equal(output.manifest.files[0].path.includes("\\"), false);
    let [validation] = validateArtifactFiles([output.path]);
    assert.equal(validation.kind, "evidence-manifest");
    assert.equal(validation.valid, true, validation.errors.join("\n"));

    writeFileSync(join(root, "report.html"), "changed after capture", "utf8");
    [validation] = validateArtifactFiles([output.path]);
    assert.equal(validation.valid, false);
    assert.match(validation.errors.join("\n"), /SHA-256 mismatch/);

    writeFileSync(join(root, "unexpected.txt"), "not part of the completed run", "utf8");
    [validation] = validateArtifactFiles([output.path]);
    assert.match(validation.errors.join("\n"), /unlisted evidence file: unexpected\.txt/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

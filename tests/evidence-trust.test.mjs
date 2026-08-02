import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { validateArtifactFiles } from "../realitycheck/scripts/artifact-validator.mjs";
import { loadEvidenceTrustPolicy } from "../realitycheck/scripts/evidence-trust.mjs";

const KEY_ID = `sha256:${"a".repeat(64)}`;

function policy(keys, requireAttestation = true) {
  return { schemaVersion: "1", kind: "evidence-trust-policy", requireAttestation, keys };
}

test("evidence trust policy applies status and validity windows conservatively", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-trust-"));
  try {
    const path = join(root, "evidence-trust.json");
    const active = policy([{ keyId: KEY_ID, name: "Release CI", status: "trusted", notBefore: "2026-01-01T00:00:00Z", notAfter: "2027-01-01T00:00:00Z" }]);
    writeFileSync(path, JSON.stringify(active), "utf8");
    const [schema] = validateArtifactFiles([path]);
    assert.equal(schema.kind, "evidence-trust-policy");
    assert.equal(schema.valid, true, schema.errors.join("\n"));
    const loaded = loadEvidenceTrustPolicy(path, { now: new Date("2026-08-01T00:00:00Z") });
    assert.deepEqual(loaded.trustedKeyIds, [KEY_ID]);
    assert.equal(loaded.policy.requireAttestation, true);

    writeFileSync(path, JSON.stringify(policy([
      { keyId: KEY_ID, name: "Release CI", status: "trusted" },
      { keyId: KEY_ID, name: "Duplicate", status: "revoked" },
    ])), "utf8");
    assert.throws(() => loadEvidenceTrustPolicy(path), /repeats key ID/);

    writeFileSync(path, JSON.stringify(policy([{ keyId: KEY_ID, name: "Bad window", status: "trusted", notBefore: "2027-01-01T00:00:00Z", notAfter: "2026-01-01T00:00:00Z" }])), "utf8");
    assert.throws(() => loadEvidenceTrustPolicy(path), /non-increasing validity window/);

    writeFileSync(path, JSON.stringify(policy([{ keyId: KEY_ID, name: "Revoked", status: "revoked" }])), "utf8");
    assert.throws(() => loadEvidenceTrustPolicy(path), /no active trusted keys/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("published evidence trust example satisfies its schema", () => {
  const [result] = validateArtifactFiles([resolve("examples/evidence-trust.example.json")]);
  assert.equal(result.kind, "evidence-trust-policy");
  assert.equal(result.valid, true, result.errors.join("\n"));
});

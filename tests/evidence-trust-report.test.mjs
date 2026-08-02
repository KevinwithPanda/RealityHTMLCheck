import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { validateArtifactFiles } from "../realitycheck/scripts/artifact-validator.mjs";
import { writeEvidenceAttestationWithKey } from "../realitycheck/scripts/evidence-attestation.mjs";
import { writeEvidenceTrustReport } from "../realitycheck/scripts/evidence-trust-report.mjs";
import { buildLatestRun, writeLatestRun } from "../realitycheck/scripts/latest-run.mjs";

test("trust report separates integrity, signature, and signer authorization", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-trust-report-"));
  try {
    const run = join(root, "run");
    cpSync(resolve("examples/reference-run"), run, { recursive: true });
    const report = JSON.parse(readFileSync(join(run, "report.json"), "utf8"));
    writeLatestRun(buildLatestRun({
      artifactKind: "page-audit", outputRoot: root, runId: report.run.id, target: report.target.finalUrl,
      score: report.score.overall, gateFailed: report.threshold.met,
      artifacts: { html: join(run, "report.html"), json: join(run, "report.json") },
      updatedAt: new Date("2026-08-01T17:59:00Z"),
    }), root);
    const { privateKey } = generateKeyPairSync("ed25519");
    const signed = writeEvidenceAttestationWithKey(join(run, "evidence-manifest.json"), privateKey, { createdAt: new Date("2026-08-01T18:00:00Z") });
    const policyPath = join(root, "evidence-trust.json");
    const writePolicy = (keyId, name = "Release CI") => writeFileSync(policyPath, JSON.stringify({
      schemaVersion: "1",
      kind: "evidence-trust-policy",
      requireAttestation: true,
      keys: [{ keyId, name, status: "trusted", notAfter: "2027-01-01T00:00:00Z" }],
    }), "utf8");
    writePolicy(signed.attestation.signer.keyId);
    const trusted = writeEvidenceTrustReport(join(run, "evidence-manifest.json"), policyPath, { generatedAt: new Date("2026-08-01T18:01:00Z") });
    assert.equal(trusted.report.state, "trusted");
    assert.deepEqual(trusted.report.checks, { integrity: true, signature: true, authorization: true });
    assert.equal(trusted.report.signer.name, "Release CI");
    assert.equal(trusted.report.errors.length, 0);
    assert.equal(trusted.latestUpdated, true);
    const latest = JSON.parse(readFileSync(join(root, "latest.json"), "utf8"));
    assert.equal(latest.artifacts.trustReportHtml, "run/evidence-trust-report.html");
    assert.equal(validateArtifactFiles([join(root, "latest.json")])[0].valid, true);
    assert.match(readFileSync(join(root, "latest.html"), "utf8"), /Open trust decision →/);
    assert.match(readFileSync(trusted.htmlPath, "utf8"), /TRUSTED EVIDENCE/);
    assert.match(readFileSync(trusted.htmlPath, "utf8"), /证据可信/);
    assert.equal(validateArtifactFiles([trusted.jsonPath])[0].valid, true);
    assert.equal(validateArtifactFiles([join(run, "evidence-manifest.json")])[0].valid, true);
    const tamperedDecision = structuredClone(trusted.report);
    tamperedDecision.state = "rejected";
    writeFileSync(trusted.jsonPath, JSON.stringify(tamperedDecision), "utf8");
    const tamperedValidation = validateArtifactFiles([trusted.jsonPath])[0];
    assert.equal(tamperedValidation.valid, false);
    assert.match(tamperedValidation.errors.join("\n"), /state does not match|errors must explain/);

    writePolicy(`sha256:${"b".repeat(64)}`, "Other CI");
    const rejected = writeEvidenceTrustReport(join(run, "evidence-manifest.json"), policyPath, { generatedAt: new Date("2026-08-01T18:02:00Z") });
    assert.equal(rejected.report.state, "rejected");
    assert.deepEqual(rejected.report.checks, { integrity: true, signature: true, authorization: false });
    assert.match(rejected.report.errors.join("\n"), /not in the trusted key allowlist/);
    assert.match(readFileSync(rejected.htmlPath, "utf8"), /REJECTED EVIDENCE/);

    writeFileSync(policyPath, JSON.stringify({
      schemaVersion: "1", kind: "evidence-trust-policy", requireAttestation: true,
      keys: [
        { keyId: signed.attestation.signer.keyId, name: "Expired release key", status: "trusted", notAfter: "2026-07-01T00:00:00Z" },
        { keyId: `sha256:${"c".repeat(64)}`, name: "Current release key", status: "trusted", notAfter: "2027-01-01T00:00:00Z" },
      ],
    }), "utf8");
    const expired = writeEvidenceTrustReport(join(run, "evidence-manifest.json"), policyPath, { generatedAt: new Date("2026-08-01T18:03:00Z"), now: new Date("2026-08-01T18:03:00Z") });
    assert.equal(expired.report.state, "rejected");
    assert.equal(expired.report.signer.status, "expired");
    assert.equal(expired.report.checks.signature, true);
    assert.equal(expired.report.checks.authorization, false);

    writeFileSync(policyPath, JSON.stringify({
      schemaVersion: "1", kind: "evidence-trust-policy", requireAttestation: true,
      keys: [{ keyId: signed.attestation.signer.keyId, name: "Emergency-revoked key", status: "revoked" }],
    }), "utf8");
    const revoked = writeEvidenceTrustReport(join(run, "evidence-manifest.json"), policyPath, { generatedAt: new Date("2026-08-01T18:04:00Z") });
    assert.equal(revoked.report.state, "rejected");
    assert.equal(revoked.report.policy.activeKeys, 0);
    assert.equal(revoked.report.signer.status, "revoked");
    assert.deepEqual(revoked.report.checks, { integrity: true, signature: true, authorization: false });
    assert.match(revoked.report.errors.join("\n"), /not in the trusted key allowlist/);
    assert.equal(validateArtifactFiles([revoked.jsonPath])[0].valid, true);
    const revokedCli = spawnSync(process.execPath, ["realitycheck/scripts/audit.mjs", "trust-report", join(run, "evidence-manifest.json"), "--trust-policy", policyPath], { encoding: "utf8" });
    assert.equal(revokedCli.status, 1, `${revokedCli.stdout}\n${revokedCli.stderr}`);
    assert.match(revokedCli.stdout, /trust decision:\s+REJECTED/);

    writeFileSync(join(run, "evidence-attestation.json"), "{not-json", "utf8");
    const malformed = writeEvidenceTrustReport(join(run, "evidence-manifest.json"), policyPath, { generatedAt: new Date("2026-08-01T18:05:00Z") });
    assert.equal(malformed.report.state, "rejected");
    assert.equal(malformed.report.checks.integrity, true);
    assert.equal(malformed.report.checks.signature, false);
    assert.equal(malformed.report.checks.authorization, false);
    assert.equal(malformed.report.signer.status, "unknown");
    assert.match(malformed.report.errors.join("\n"), /valid JSON/);
    assert.equal(validateArtifactFiles([malformed.jsonPath])[0].valid, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { validateArtifactFiles } from "../realitycheck/scripts/artifact-validator.mjs";
import { writeEvidenceAttestation, writeEvidenceAttestationWithKey } from "../realitycheck/scripts/evidence-attestation.mjs";
import { buildLatestRun, writeLatestRun } from "../realitycheck/scripts/latest-run.mjs";

test("Ed25519 attestation binds an evidence manifest without exposing its private key", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-attestation-"));
  try {
    const run = join(root, "run");
    cpSync(resolve("examples/reference-run"), run, { recursive: true });
    const report = JSON.parse(readFileSync(join(run, "report.json"), "utf8"));
    writeLatestRun(buildLatestRun({
      artifactKind: "page-audit",
      outputRoot: root,
      runId: report.run.id,
      target: report.target.finalUrl,
      score: report.score.overall,
      gateFailed: report.threshold.met,
      artifacts: { html: join(run, "report.html"), json: join(run, "report.json") },
      updatedAt: new Date("2026-08-01T17:59:00Z"),
    }), root);
    const unsigned = validateArtifactFiles([join(run, "evidence-manifest.json")], { requireAttestation: true });
    assert.equal(unsigned.length, 1);
    assert.equal(unsigned[0].valid, false);
    assert.match(unsigned[0].errors.join("\n"), /required sibling evidence-attestation\.json is missing/);
    const { privateKey } = generateKeyPairSync("ed25519");
    const privateKeyPath = join(root, "private.pem");
    const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    writeFileSync(privateKeyPath, privatePem, { encoding: "utf8", mode: 0o600 });

    const outputs = writeEvidenceAttestation(join(run, "evidence-manifest.json"), privateKeyPath, { createdAt: new Date("2026-08-01T18:00:00Z") });
    const inMemoryOutputs = writeEvidenceAttestationWithKey(join(run, "evidence-manifest.json"), privateKey, { createdAt: new Date("2026-08-01T18:00:01Z") });
    assert.equal(inMemoryOutputs.jsonPath, outputs.jsonPath);
    assert.equal(outputs.latestUpdated, true);
    const latest = JSON.parse(readFileSync(join(root, "latest.json"), "utf8"));
    assert.equal(latest.artifacts.attestationJson, "run/evidence-attestation.json");
    assert.equal(latest.artifacts.attestationHtml, "run/evidence-attestation.html");
    assert.equal(validateArtifactFiles([join(root, "latest.json")])[0].valid, true);
    assert.match(readFileSync(join(root, "latest.html"), "utf8"), /Open signed receipt →/);
    const attestation = JSON.parse(readFileSync(outputs.jsonPath, "utf8"));
    const html = readFileSync(outputs.htmlPath, "utf8");
    assert.equal(attestation.algorithm, "Ed25519");
    assert.match(attestation.signer.keyId, /^sha256:[a-f0-9]{64}$/);
    assert.match(attestation.signer.publicKey, /BEGIN PUBLIC KEY/);
    assert.doesNotMatch(JSON.stringify(attestation), /BEGIN PRIVATE KEY/);
    assert.doesNotMatch(JSON.stringify(attestation), new RegExp(privatePem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, /Evidence signed for accountable delivery\./);
    assert.match(html, /证据已签名，交付可追责。/);

    const valid = validateArtifactFiles([outputs.jsonPath])[0];
    assert.equal(valid.kind, "evidence-attestation");
    assert.equal(valid.valid, true, valid.errors.join("\n"));
    const trusted = validateArtifactFiles([outputs.jsonPath], { trustedKeyIds: [attestation.signer.keyId] })[0];
    assert.equal(trusted.valid, true, trusted.errors.join("\n"));
    const untrusted = validateArtifactFiles([outputs.jsonPath], { trustedKeyIds: [`sha256:${"0".repeat(64)}`] })[0];
    assert.equal(untrusted.valid, false);
    assert.match(untrusted.errors.join("\n"), /not in the trusted key allowlist/);
    assert.throws(() => validateArtifactFiles([outputs.jsonPath], { trustedKeyIds: ["not-a-key"] }), /invalid trusted Ed25519 key ID/);
    const requiredAndTrusted = validateArtifactFiles([join(run, "evidence-manifest.json")], { requireAttestation: true, trustedKeyIds: [attestation.signer.keyId] });
    assert.equal(requiredAndTrusted.length, 2);
    assert.equal(requiredAndTrusted.every((item) => item.valid), true, requiredAndTrusted.flatMap((item) => item.errors).join("\n"));
    const trustPolicyPath = join(root, "evidence-trust.json");
    writeFileSync(trustPolicyPath, JSON.stringify({
      schemaVersion: "1",
      kind: "evidence-trust-policy",
      requireAttestation: true,
      keys: [{ keyId: attestation.signer.keyId, name: "Test release key", status: "trusted", notAfter: "2027-01-01T00:00:00Z" }],
    }), "utf8");
    const cli = spawnSync(process.execPath, ["realitycheck/scripts/audit.mjs", "validate", join(run, "evidence-manifest.json"), "--trust-policy", trustPolicyPath], { encoding: "utf8" });
    assert.equal(cli.status, 0, `${cli.stdout}\n${cli.stderr}`);
    assert.match(cli.stdout, /Validated 3 artifact\(s\): 3 passed/);
    writeLatestRun(buildLatestRun({
      artifactKind: "page-audit", outputRoot: root, runId: report.run.id, target: report.target.finalUrl,
      score: report.score.overall, gateFailed: report.threshold.met,
      artifacts: { html: join(run, "report.html"), json: join(run, "report.json") },
      updatedAt: new Date("2026-08-01T18:02:00Z"),
    }), root);
    const untrustedCli = spawnSync(process.execPath, ["realitycheck/scripts/audit.mjs", "attest", join(run, "evidence-manifest.json"), "--private-key", privateKeyPath, "--trusted-key", `sha256:${"f".repeat(64)}`], { encoding: "utf8" });
    assert.equal(untrustedCli.status, 2, `${untrustedCli.stdout}\n${untrustedCli.stderr}`);
    assert.match(untrustedCli.stderr, /not in the trusted key allowlist/);
    const latestAfterRejectedSigning = JSON.parse(readFileSync(join(root, "latest.json"), "utf8"));
    assert.equal(latestAfterRejectedSigning.artifacts.attestationJson, undefined);
    assert.equal(latestAfterRejectedSigning.artifacts.attestationHtml, undefined);
    const manifestValid = validateArtifactFiles([join(run, "evidence-manifest.json")])[0];
    assert.equal(manifestValid.valid, true, manifestValid.errors.join("\n"));

    const manifestPath = join(run, "evidence-manifest.json");
    writeFileSync(manifestPath, `${readFileSync(manifestPath, "utf8")} `, "utf8");
    const tampered = validateArtifactFiles([outputs.jsonPath])[0];
    assert.equal(tampered.valid, false);
    assert.match(tampered.errors.join("\n"), /sha256 does not match|signature failed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("attestation rejects non-Ed25519 private keys", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-attestation-key-"));
  try {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPath = join(root, "rsa.pem");
    writeFileSync(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
    assert.throws(
      () => writeEvidenceAttestation(resolve("examples/reference-run/evidence-manifest.json"), privateKeyPath),
      /must be Ed25519/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("attestation refuses to sign an internally inconsistent evidence bundle", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-attestation-integrity-"));
  try {
    const run = join(root, "run");
    cpSync(resolve("examples/reference-run"), run, { recursive: true });
    writeFileSync(join(run, "report.md"), `${readFileSync(join(run, "report.md"), "utf8")}\nchanged after manifest\n`, "utf8");
    const { privateKey } = generateKeyPairSync("ed25519");
    assert.throws(
      () => writeEvidenceAttestationWithKey(join(run, "evidence-manifest.json"), privateKey),
      /integrity check failed before signing:.*SHA-256 mismatch/,
    );
    assert.equal(existsSync(join(run, "evidence-attestation.json")), false);
    assert.equal(existsSync(join(run, "evidence-attestation.html")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { buildArtifactCatalog, writeArtifactCatalog } from "../realitycheck/scripts/catalog.mjs";
import { validateArtifactFiles } from "../realitycheck/scripts/artifact-validator.mjs";
import { writeEvidenceAttestation } from "../realitycheck/scripts/evidence-attestation.mjs";

test("artifact catalog indexes valid audits and proofs with portable bilingual links", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-catalog-"));
  try {
    const pageDirectory = join(root, "runs", "page");
    const proofDirectory = join(root, "proof");
    const invalidDirectory = join(root, "old");
    const attestedDirectory = join(root, "attested");
    const policyDirectory = join(root, "policy");
    const output = join(root, "catalog");
    mkdirSync(pageDirectory, { recursive: true });
    mkdirSync(proofDirectory, { recursive: true });
    mkdirSync(invalidDirectory, { recursive: true });
    cpSync(resolve("examples/reference-run"), attestedDirectory, { recursive: true });
    cpSync(resolve("examples/policy-review-lab/review"), policyDirectory, { recursive: true });
    copyFileSync(resolve("examples/reference-run/report.json"), join(pageDirectory, "report.json"));
    const ownedReport = JSON.parse(readFileSync(join(pageDirectory, "report.json"), "utf8"));
    ownedReport.findings[0].ownership = { id: "web-platform", name: "Web Platform" };
    writeFileSync(join(pageDirectory, "report.json"), JSON.stringify(ownedReport), "utf8");
    writeFileSync(join(pageDirectory, "report.html"), "<!doctype html><title>report</title>", "utf8");
    writeFileSync(join(proofDirectory, "verification.json"), JSON.stringify({
      schemaVersion: "1",
      toolVersion: "0.3.0",
      before: { runId: "before", score: 78 },
      after: { runId: "after", score: 100 },
      scoreDelta: 22,
      counts: { resolved: 6, remaining: 0, worsened: 0, new: 0, unverified: 0 },
      resolved: [], remaining: [], worsened: [], new: [], unverified: [],
      threshold: { failOn: "major", scope: "regressions-only", met: false },
    }), "utf8");
    writeFileSync(join(proofDirectory, "verification.html"), "<!doctype html><title>proof</title>", "utf8");
    writeFileSync(join(invalidDirectory, "report.json"), JSON.stringify({ schemaVersion: "1" }), "utf8");
    const { privateKey } = generateKeyPairSync("ed25519");
    const privateKeyPath = join(root, "private.pem");
    writeFileSync(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
    const signed = writeEvidenceAttestation(join(attestedDirectory, "evidence-manifest.json"), privateKeyPath, { createdAt: new Date("2026-08-01T15:00:00Z") });

    const catalog = buildArtifactCatalog([pageDirectory, proofDirectory, invalidDirectory, signed.jsonPath, policyDirectory], output, { now: new Date("2026-08-01T16:00:00Z") });
    assert.equal(catalog.summary.artifacts, 4);
    assert.equal(catalog.summary.audits, 1);
    assert.equal(catalog.summary.verifications, 1);
    assert.equal(catalog.summary.repairPlans, 0);
    assert.equal(catalog.summary.policyReviews, 1);
    assert.equal(catalog.summary.attestations, 1);
    assert.equal(catalog.summary.trustReports, 0);
    assert.equal(catalog.summary.failing, 2);
    assert.equal(catalog.summary.passing, 1);
    assert.equal(catalog.entries.find((entry) => entry.kind === "page-audit").gateViolations[0].code, "severity-threshold");
    assert.deepEqual(catalog.entries.find((entry) => entry.kind === "page-audit").owners, ["Web Platform"]);
    const policyEntry = catalog.entries.find((entry) => entry.kind === "policy-review");
    assert.equal(policyEntry.state, "failed");
    assert.deepEqual(policyEntry.changes, { weakened: 38, strengthened: 0, review: 2 });
    assert.equal(catalog.warnings.length, 1);
    assert.equal(catalog.entries.every((entry) => !/^[A-Za-z]:|^\//.test(entry.visualPath)), true);

    const outputs = writeArtifactCatalog(catalog, output);
    const html = readFileSync(outputs.htmlPath, "utf8");
    assert.match(html, /Every audit\. One place\./);
    assert.match(html, /每次核查，集中查看。/);
    assert.match(html, /data-filter="verification"/);
    assert.match(html, /data-filter="evidence-attestation"/);
    assert.match(html, /data-filter="evidence-trust-report"/);
    assert.match(html, /data-filter="policy-review"/);
    assert.match(html, /<b>38<\/b> weakened/);
    assert.match(html, /<b>6<\/b> resolved/);
    assert.match(html, /Gate policy/);
    assert.match(html, /门禁策略/);
    assert.match(html, /Owner<\/b> · Web Platform/);
    assert.doesNotMatch(html, /&quot;resolved&quot;/);
    assert.match(html, /filter==='verification'\?entry\.dataset\.kind\.endsWith\('verification'\)/);
    assert.match(html, /class="search"/);
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /\.\.\/runs\/page\/report\.html/);
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    assert.doesNotThrow(() => new Function(script));
    const [validation] = validateArtifactFiles([outputs.jsonPath]);
    assert.equal(validation.kind, "artifact-catalog");
    assert.equal(validation.valid, true, validation.errors.join("\n"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

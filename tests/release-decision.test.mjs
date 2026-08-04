import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { validateArtifactFiles } from "../realitycheck/scripts/artifact-validator.mjs";
import {
  buildReleaseDecision,
  releaseDecisionExitCode,
  renderReleaseDecisionHtml,
  renderReleaseDecisionMarkdown,
  writeReleaseDecision,
} from "../realitycheck/scripts/release-decision.mjs";

const NOW = new Date("2026-08-05T12:00:00.000Z");

function tempDirectory() {
  return mkdtempSync(join(tmpdir(), "realitycheck-release-"));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}

function passingReport(directory, { finishedAt = NOW.toISOString(), id = "release-pass" } = {}) {
  const report = readJson("examples/reference-run/report.json");
  report.run.id = id;
  report.run.startedAt = new Date(Date.parse(finishedAt) - 42_000).toISOString();
  report.run.finishedAt = finishedAt;
  report.threshold.failOn = "never";
  report.threshold.met = false;
  report.threshold.violations = [];
  return writeJson(join(directory, "report.json"), report);
}

function passingPolicy(directory, generatedAt = NOW.toISOString()) {
  const policy = readJson("examples/policy-review-lab/review/policy-review.json");
  policy.generatedAt = generatedAt;
  policy.summary = { changes: 0, weakened: 0, strengthened: 0, review: 0, gateFailed: false };
  policy.changes = [];
  return writeJson(join(directory, "policy-review.json"), policy);
}

function trustedEvidence(directory, generatedAt = NOW.toISOString()) {
  const hexA = "a".repeat(64);
  const hexB = "b".repeat(64);
  const hexC = "c".repeat(64);
  return writeJson(join(directory, "evidence-trust-report.json"), {
    schemaVersion: "1",
    toolVersion: "0.4.0",
    kind: "evidence-trust-report",
    generatedAt,
    state: "trusted",
    manifest: { path: "evidence-manifest.json", artifactKind: "page-audit", runId: "release-pass", sha256: `sha256:${hexA}` },
    policy: { sha256: `sha256:${hexB}`, requireAttestation: true, activeKeys: 1 },
    signer: { keyId: `sha256:${hexC}`, name: "Release Bot", status: "trusted" },
    checks: { integrity: true, signature: true, authorization: true },
    errors: [],
  });
}

function passingRisk(directory, generatedAt = NOW.toISOString()) {
  return writeJson(join(directory, "risk-register.json"), {
    schemaVersion: "1",
    toolVersion: "0.4.0",
    kind: "risk-register",
    generatedAt,
    summary: { risks: 0, open: 0, recurring: 0, overdue: 0, waived: 0, resolved: 0, unverified: 0, targets: 1, runs: 1 },
    policy: { maxOpenAgeDays: 30, maxOpenRisks: 10, maxRecurringRisks: 3, gateFailed: false, violations: [] },
    entries: [],
    warnings: ["A passing empty synthetic register is used only by this release-decision contract test."],
  });
}

function reviewIssues(directory, generatedAt = NOW.toISOString()) {
  const issues = readJson("examples/issue-drafts-lab/github-issue-drafts.json");
  issues.generatedAt = generatedAt;
  return writeJson(join(directory, "github-issue-drafts.json"), issues);
}

test("release decision produces a private schema-valid GO bundle from fresh passing controls", () => {
  const root = tempDirectory();
  const sources = join(root, "sources");
  const output = join(root, "decision");
  writeFileSync(join(root, ".keep"), "", "utf8");
  // mkdir is performed by writing helpers' parent through the first output fixture.
  mkdirSync(sources, { recursive: true });
  const paths = [passingReport(sources), passingPolicy(sources), trustedEvidence(sources), passingRisk(sources)];
  const bundle = buildReleaseDecision(paths, output, { now: NOW, maxAgeHours: 24, requiredControls: ["audit", "policy", "trust", "risk"] });
  assert.equal(bundle.decision, "go");
  assert.equal(releaseDecisionExitCode(bundle.decision), 0);
  assert.deepEqual(bundle.summary, { controls: 4, required: 4, passed: 4, review: 0, failed: 0, missing: 0, stale: 0, decision: "go" });
  assert.match(bundle.id, /^RELEASE-[A-F0-9]{12}$/);
  const serialized = JSON.stringify(bundle);
  assert.doesNotMatch(serialized, /127\.0\.0\.1|Northstar|query|password/i);
  assert.ok(bundle.controls.every((item) => item.artifact.sha256.startsWith("sha256:")));
  assert.ok(bundle.controls.every((item) => !/^[A-Za-z]:/.test(item.artifact.path)));

  const outputs = writeReleaseDecision(bundle, output);
  const [validated] = validateArtifactFiles([outputs.jsonPath]);
  assert.equal(validated.valid, true, validated.errors.join("\n"));
  const tampered = structuredClone(bundle);
  tampered.summary.passed -= 1;
  tampered.decision = "review";
  const tamperedPath = writeJson(join(root, "tampered", "release-decision.json"), tampered);
  const [rejected] = validateArtifactFiles([tamperedPath]);
  assert.equal(rejected.valid, false);
  assert.match(rejected.errors.join("\n"), /summary\/passed|decision|id/);
  assert.match(readFileSync(outputs.markdownPath, "utf8"), /Decision: \*\*GO\*\*/);
  assert.match(readFileSync(outputs.markdownZhPath, "utf8"), /结论: \*\*可发布\*\*/);
  const html = readFileSync(outputs.htmlPath, "utf8");
  assert.match(html, /NO AUTOMATIC DEPLOYMENT/);
  assert.match(html, /data-language="zh-CN"/);
  assert.match(html, /data-filter="stale"/);
  assert.match(html, /navigator\.clipboard\.writeText/);
  assert.match(html, /connect-src 'none';img-src 'none'/);
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  for (const script of [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1])) new Function(script);
});

test("optional review evidence yields REVIEW while failed, missing, and stale required controls yield NO-GO", () => {
  const root = tempDirectory();
  const sources = join(root, "sources");
  mkdirSync(sources, { recursive: true });
  const report = passingReport(sources);
  const policy = passingPolicy(sources);
  const issues = reviewIssues(sources);
  const reviewed = buildReleaseDecision([report, policy, issues], join(root, "review"), { now: NOW, requiredControls: ["audit", "policy"] });
  assert.equal(reviewed.decision, "review");
  assert.equal(reviewed.controls.find((item) => item.key === "issues").state, "review");
  assert.equal(releaseDecisionExitCode(reviewed.decision), 3);

  const failingSource = readJson("examples/reference-run/report.json");
  const failingPath = writeJson(join(root, "failing-source", "report.json"), failingSource);
  const failing = buildReleaseDecision([failingPath], join(root, "failed"), { now: new Date("2026-08-02T00:00:00Z"), maxAgeHours: 24, requiredControls: ["audit"] });
  assert.equal(failing.decision, "no-go");
  assert.equal(failing.controls[0].state, "fail");

  const missing = buildReleaseDecision([report], join(root, "missing"), { now: NOW, requiredControls: ["audit", "trust"] });
  assert.equal(missing.decision, "no-go");
  assert.equal(missing.controls.find((item) => item.key === "trust").state, "missing");

  const staleReport = passingReport(join(root, "stale-source"), { finishedAt: "2026-08-03T00:00:00.000Z", id: "stale-pass" });
  const stale = buildReleaseDecision([staleReport], join(root, "stale"), { now: NOW, maxAgeHours: 24, requiredControls: ["audit"] });
  assert.equal(stale.decision, "no-go");
  assert.equal(stale.controls[0].state, "stale");
  assert.match(stale.controls[0].reasons[0].message, /limit is 24/);
});

test("release decision selects the newest candidate, records ambiguity, and rejects invalid evidence", () => {
  const root = tempDirectory();
  const older = join(root, "older");
  const newer = join(root, "newer");
  mkdirSync(older, { recursive: true });
  mkdirSync(newer, { recursive: true });
  passingReport(older, { finishedAt: "2026-08-05T10:00:00.000Z", id: "older" });
  passingReport(newer, { finishedAt: "2026-08-05T11:00:00.000Z", id: "newer" });
  const bundle = buildReleaseDecision([root], join(root, "decision"), { now: NOW, requiredControls: ["audit"] });
  assert.equal(bundle.controls[0].candidates, 2);
  assert.match(bundle.controls[0].artifact.runFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(bundle.controls[0].artifact.runFingerprint, "newer");
  assert.match(bundle.controls[0].artifact.path, /newer\/report\.json$/);

  const invalid = readJson(join(newer, "report.json"));
  invalid.score.overall = 999;
  writeJson(join(newer, "report.json"), invalid);
  assert.throws(() => buildReleaseDecision([join(newer, "report.json")], join(root, "invalid"), { now: NOW }), /refuses invalid evidence/);

  const mislabeled = join(root, "mislabeled", "policy-review.json");
  writeJson(mislabeled, readJson(join(older, "report.json")));
  assert.throws(() => buildReleaseDecision([mislabeled], join(root, "mislabeled-output"), { now: NOW, requiredControls: ["policy"] }), /refuses mislabeled evidence/);
});

test("release-decision CLI exposes stable tri-state exit codes and refuses audit options", () => {
  const root = tempDirectory();
  const sources = join(root, "sources");
  mkdirSync(sources, { recursive: true });
  const cliObservedAt = new Date(Date.now() - 60_000).toISOString();
  const report = passingReport(sources, { finishedAt: cliObservedAt, id: "cli-pass" });
  const issues = reviewIssues(sources, cliObservedAt);
  const cli = resolve("realitycheck/scripts/audit.mjs");
  const run = (...args) => spawnSync(process.execPath, [cli, "release-decision", ...args], { encoding: "utf8" });

  const go = run(report, "--require", "audit", "--output", join(root, "go"));
  assert.equal(go.status, 0, `${go.stdout}\n${go.stderr}`);
  assert.match(go.stdout, /decision:\s+GO/);

  const review = run(report, issues, "--require", "audit", "--output", join(root, "review"));
  assert.equal(review.status, 3, `${review.stdout}\n${review.stderr}`);
  assert.match(review.stdout, /decision:\s+REVIEW/);

  const noGoSource = join(root, "no-go-source");
  const failedReport = readJson("examples/reference-run/report.json");
  failedReport.run.startedAt = new Date(Date.parse(cliObservedAt) - 42_000).toISOString();
  failedReport.run.finishedAt = cliObservedAt;
  const failedReportPath = writeJson(join(noGoSource, "report.json"), failedReport);
  const noGo = run(failedReportPath, "--max-age-hours", "168", "--output", join(root, "no-go"));
  assert.equal(noGo.status, 1, `${noGo.stdout}\n${noGo.stderr}`);
  assert.match(noGo.stdout, /decision:\s+NO-GO/);

  const invalid = run(report, "--mode", "quick", "--output", join(root, "invalid"));
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /accepts evidence paths/);
});

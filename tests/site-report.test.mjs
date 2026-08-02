import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildSiteReport, compareSiteReports, sanitizeOperationalError, writeSiteReport, writeSiteVerification } from "../realitycheck/scripts/site-report.mjs";
import { validateArtifactFiles } from "../realitycheck/scripts/artifact-validator.mjs";

function pageReport(url, score, thresholdMet, findings = [], gateViolations = null) {
  return {
    target: { requestedUrl: url, finalUrl: url, title: `Page ${new URL(url).pathname}` },
    score: {
      overall: score,
      scenarioCounts: { passed: 5, "completed-with-findings": findings.length ? 1 : 0, skipped: 0, unsupported: 0, failed: 0 },
    },
    threshold: { met: thresholdMet, violations: gateViolations ?? (thresholdMet ? [{ code: "severity-threshold", actual: 1, expected: 0 }] : []) },
    scenarios: [
      { id: "baseline", status: "passed" },
      { id: "mobile-375", status: findings.length ? "completed-with-findings" : "passed" },
    ],
    findings,
  };
}

test("site operational errors redact machine paths, query values, and tokens", () => {
  const message = sanitizeOperationalError("Failed C:\\Users\\mina\\secret.json at https://example.test/app?token=secret Bearer abc.def.secret");
  assert.doesNotMatch(message, /mina|secret\.json|token=secret|abc\.def\.secret/);
  assert.match(message, /\[local path\]|redacted/);
});

test("site reports summarize page gates and keep evidence links portable", () => {
  const site = buildSiteReport({
    id: "site-1",
    baseUrl: "http://127.0.0.1:3000/",
    mode: "quick",
    failOn: "major",
    startedAt: "2026-08-01T00:00:00Z",
    finishedAt: "2026-08-01T00:01:00Z",
    discovery: { enabled: true, maxPages: 8, maxDepth: 2, visited: 2, discovered: 1, truncated: false, warnings: [] },
    pages: [
      {
        status: "completed",
        reportPath: "pages/01/run/report.html",
        report: pageReport("http://127.0.0.1:3000/", 100, false),
      },
      {
        status: "completed",
        reportPath: "pages/02/run/report.html",
        report: pageReport("http://127.0.0.1:3000/settings", 82, true, [{ id: "RC-ONE", fingerprint: "one", ruleId: "overflow", scenarioId: "mobile-375", severity: "major", confidence: "high", classification: "existing", title: "Overflow", ownership: { id: "web-platform", name: "Web Platform" } }]),
      },
    ],
  });
  assert.equal(site.summary.pagesCompleted, 2);
  assert.equal(site.summary.averageScore, 91);
  assert.equal(site.summary.minimumScore, 82);
  assert.equal(site.summary.gateFailed, true);
  assert.equal(site.summary.findings.major, 1);
  assert.equal(site.summary.waivedFindings, 0);
  assert.equal(site.summary.gateViolations, 1);
  assert.deepEqual(site.pages[1].owners, ["Web Platform"]);

  const directory = mkdtempSync(join(tmpdir(), "realitycheck-site-"));
  try {
    const outputs = writeSiteReport(site, directory);
    const serialized = readFileSync(outputs.jsonPath, "utf8");
    const page = readFileSync(outputs.htmlPath, "utf8");
    const markdown = readFileSync(outputs.markdownPath, "utf8");
    assert.match(serialized, /pages\/02\/run\/report\.html/);
    assert.doesNotMatch(serialized, /[A-Z]:\\/i);
    assert.match(page, /Which page will break your release\?/);
    assert.match(page, /哪一个页面会拖垮这次发布？/);
    assert.match(page, /Content-Security-Policy/);
    assert.match(page, /href="pages\/02\/run\/report\.html"/);
    assert.match(page, /Gate reasons/);
    assert.match(markdown, /\[Open\]\(pages\/01\/run\/report\.html\)/);
    const [validation] = validateArtifactFiles([outputs.jsonPath]);
    assert.equal(validation.valid, true, validation.errors.join("\n"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("site baseline comparison proves resolutions and blocks new regressions", () => {
  const known = { id: "RC-KNOWN", fingerprint: "known", ruleId: "known-rule", scenarioId: "mobile-375", severity: "major", confidence: "high", classification: "new", title: "Known mobile problem" };
  const regression = { id: "RC-NEW", fingerprint: "new", ruleId: "new-rule", scenarioId: "baseline", severity: "major", confidence: "high", classification: "existing", title: "New runtime problem" };
  const common = {
    baseUrl: "http://127.0.0.1:3000/",
    mode: "quick",
    failOn: "major",
    discovery: { enabled: true, maxPages: 8, maxDepth: 2, visited: 1, discovered: 0, truncated: false, warnings: [] },
  };
  const before = buildSiteReport({
    ...common,
    id: "before",
    startedAt: "2026-08-01T00:00:00Z",
    finishedAt: "2026-08-01T00:01:00Z",
    pages: [{ status: "completed", reportPath: "before/report.html", report: pageReport("http://127.0.0.1:3000/", 92, true, [known]) }],
  });
  const fixed = buildSiteReport({
    ...common,
    id: "fixed",
    startedAt: "2026-08-02T00:00:00Z",
    finishedAt: "2026-08-02T00:01:00Z",
    pages: [{ status: "completed", reportPath: "fixed/report.html", report: pageReport("http://127.0.0.1:3000/", 100, false, []) }],
  });
  const proof = compareSiteReports(before, fixed, { regressionsOnly: true, failOn: "major" });
  assert.equal(proof.counts.resolved, 1);
  assert.equal(proof.counts.new, 0);
  assert.equal(proof.threshold.met, false);

  const regressed = buildSiteReport({
    ...common,
    id: "regressed",
    startedAt: "2026-08-03T00:00:00Z",
    finishedAt: "2026-08-03T00:01:00Z",
    pages: [{ status: "completed", reportPath: "regressed/report.html", report: pageReport("http://127.0.0.1:3000/", 92, true, [regression]) }],
  });
  const failed = compareSiteReports(fixed, regressed, { regressionsOnly: true, failOn: "major" });
  assert.equal(failed.counts.new, 1);
  assert.equal(failed.threshold.met, true);

  const waivedRegression = { ...regression, waiver: { id: "temporary-risk", reason: "Tracked in WEB-42", owner: "Web Platform", expires: "2027-01-31" } };
  const waivedSite = buildSiteReport({
    ...common,
    id: "waived",
    startedAt: "2026-08-04T00:00:00Z",
    finishedAt: "2026-08-04T00:01:00Z",
    pages: [{ status: "completed", reportPath: "waived/report.html", report: pageReport("http://127.0.0.1:3000/", 100, false, [waivedRegression]) }],
  });
  const waivedProof = compareSiteReports(fixed, waivedSite, { regressionsOnly: true, failOn: "major" });
  assert.equal(waivedSite.summary.waivedFindings, 1);
  assert.equal(waivedProof.counts.new, 1);
  assert.equal(waivedProof.threshold.met, false);

  const policySite = buildSiteReport({
    ...common,
    id: "policy-failed",
    startedAt: "2026-08-05T00:00:00Z",
    finishedAt: "2026-08-05T00:01:00Z",
    pages: [{ status: "completed", reportPath: "policy/report.html", report: pageReport("http://127.0.0.1:3000/", 90, true, [], [{ code: "minimum-score", actual: 90, expected: 95 }]) }],
  });
  const policyProof = compareSiteReports(fixed, policySite, { regressionsOnly: true, failOn: "major" });
  assert.equal(policyProof.counts.new, 0);
  assert.equal(policyProof.policyViolations.length, 1);
  assert.equal(policyProof.threshold.met, true);

  const staleAfter = structuredClone(fixed);
  staleAfter.id = "stale-after";
  staleAfter.startedAt = "2026-09-15T00:00:00Z";
  staleAfter.finishedAt = "2026-09-15T00:01:00Z";
  before.policyFingerprint = `sha256:${"a".repeat(64)}`;
  staleAfter.policyFingerprint = `sha256:${"b".repeat(64)}`;
  const staleProof = compareSiteReports(before, staleAfter, { regressionsOnly: true, failOn: "major", maxBaselineAgeDays: 30, requireSamePolicy: true });
  assert.equal(staleProof.threshold.met, true);
  assert.equal(staleProof.threshold.maximumBaselineAgeDays, 30);
  assert.deepEqual(staleProof.policyViolations.slice(-2).map((item) => item.code), ["baseline-age", "policy-drift"]);
  assert.equal(staleProof.before.mode, "quick");
  assert.equal(staleProof.after.policyFingerprint, `sha256:${"b".repeat(64)}`);

  const directory = mkdtempSync(join(tmpdir(), "realitycheck-site-proof-"));
  try {
    const outputs = writeSiteVerification(failed, directory);
    assert.match(readFileSync(outputs.htmlPath, "utf8"), /Did the whole site get safer\?/);
    assert.match(readFileSync(outputs.htmlPath, "utf8"), /整个站点真的更可靠吗？/);
    const [validation] = validateArtifactFiles([outputs.jsonPath]);
    assert.equal(validation.valid, true, validation.errors.join("\n"));
    const policyOutputs = writeSiteVerification(policyProof, directory);
    assert.match(readFileSync(policyOutputs.htmlPath, "utf8"), /发布策略违规/);
    const [policyValidation] = validateArtifactFiles([policyOutputs.jsonPath]);
    assert.equal(policyValidation.valid, true, policyValidation.errors.join("\n"));
    const staleOutputs = writeSiteVerification(staleProof, directory);
    assert.match(readFileSync(staleOutputs.markdownPath, "utf8"), /Baseline age:/);
    const [staleValidation] = validateArtifactFiles([staleOutputs.jsonPath]);
    assert.equal(staleValidation.valid, true, staleValidation.errors.join("\n"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildGitHubSummary, buildGitHubSummaryFromReports, workflowAnnotation, writeGitHubSummary } from "../realitycheck/scripts/github-summary.mjs";

const reference = JSON.parse(readFileSync("examples/reference-run/report.json", "utf8"));

test("GitHub summary selects latest targets, localizes output, and bounds annotations", () => {
  const result = buildGitHubSummary(["examples/public-evidence"], { maxAnnotations: 5, language: "zh-CN" });
  assert.ok(result.summary.validatedReports >= 10);
  assert.equal(result.summary.latestTargets, 11);
  assert.equal(result.summary.annotations, 5);
  assert.ok(result.summary.truncatedAnnotations > 0);
  assert.match(result.markdown, /RealityCheck 拉取请求摘要/);
  assert.match(result.markdown, /优先问题/);
  assert.match(result.markdown, /viewport-lab\/broken\.html/);
  assert.doesNotMatch(result.markdown, /\?[^\s|)]/);
  for (const annotation of result.annotations) {
    assert.match(annotation, /^::(?:error|warning|notice) title=[^\r\n]+::[^\r\n]+$/);
    assert.doesNotMatch(annotation, /\?[^\s]+/);
  }
});

test("workflow commands and Markdown neutralize hostile report text", () => {
  const report = structuredClone(reference);
  report.target.requestedUrl = "http://127.0.0.1:4173/path?token=SECRET#private";
  report.target.finalUrl = report.target.requestedUrl;
  report.run.id = "hostile-latest";
  report.run.startedAt = "2026-08-05T00:00:00Z";
  report.run.finishedAt = "2026-08-05T00:00:01Z";
  report.findings = [structuredClone(reference.findings[0])];
  report.findings[0].ruleId = "rule:comma,value";
  report.findings[0].title = "Broken | <script>\n::error title=pwn::boom 100%";
  report.findings[0].remediation.summary = "Fix it\n::notice::injected";
  report.findings[0].waiver = undefined;
  report.threshold.met = false;
  report.threshold.violations = [];
  report.score.overall = 90;
  const result = buildGitHubSummaryFromReports([{ path: "hostile/report.json", report }], { maxAnnotations: 10, language: "en" });
  assert.equal(result.annotations.length, 1);
  assert.doesNotMatch(result.annotations[0], /SECRET|\r|\n/);
  assert.match(result.annotations[0], /rule%3Acomma%2Cvalue/);
  assert.match(result.annotations[0], /100%25/);
  assert.doesNotMatch(result.annotations[0], /::error title=pwn::/);
  assert.doesNotMatch(result.markdown, /SECRET|<script>/);
  assert.match(result.markdown, /Broken \\| &lt;script&gt;/);

  const direct = workflowAnnotation("warning", "a:b,c%", "line one\n::notice::fake 100%");
  assert.match(direct, /^::warning title=a%3Ab%2Cc%25::/);
  assert.doesNotMatch(direct, /\r|\n|::notice::/);
});

test("stale findings disappear when a newer exact-target report passes", () => {
  const older = structuredClone(reference);
  older.target.requestedUrl = "http://127.0.0.1:4173/app?revision=old";
  older.run.id = "older";
  older.run.finishedAt = "2026-08-01T00:00:00Z";
  const newer = structuredClone(older);
  newer.run.id = "newer";
  newer.run.finishedAt = "2026-08-02T00:00:00Z";
  newer.findings = [];
  newer.score.totalFindings = 0;
  newer.score.counts = { critical: 0, major: 0, minor: 0, info: 0 };
  newer.score.overall = 100;
  newer.threshold.met = false;
  newer.threshold.violations = [];
  const result = buildGitHubSummaryFromReports([{ path: "older.json", report: older }, { path: "newer.json", report: newer }]);
  assert.equal(result.summary.validatedReports, 2);
  assert.equal(result.summary.latestTargets, 1);
  assert.equal(result.summary.activeFindings, 0);
  assert.equal(result.annotations.length, 1);
  assert.match(result.annotations[0], /^::notice title=RealityCheck passed::/);
  assert.doesNotMatch(result.markdown, /revision=old/);
});

test("summary writer emits a bounded standalone Markdown artifact", () => {
  const directory = mkdtempSync(join(tmpdir(), "realitycheck-github-summary-"));
  try {
    const result = buildGitHubSummaryFromReports([{ path: "reference.json", report: reference }], { maxAnnotations: 3 });
    const path = writeGitHubSummary(result, join(directory, "nested", "github-summary.md"));
    assert.equal(readFileSync(path, "utf8"), result.markdown);
    assert.ok(result.markdown.length < 100_000);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("summary generation refuses non-RealityCheck or invalid evidence", () => {
  assert.throws(() => buildGitHubSummary(["package.json"]), /Cannot summarize invalid evidence/);
  assert.throws(() => buildGitHubSummaryFromReports([], { maxAnnotations: 20 }), /At least one validated page report/);
  assert.throws(() => buildGitHubSummaryFromReports([{ path: "x", report: reference }], { maxAnnotations: 51 }), /1 to 50/);
});

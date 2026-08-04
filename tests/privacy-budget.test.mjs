import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const evidenceRoot = resolve("examples/public-evidence/privacy");

function publishedReport() {
  const latest = JSON.parse(readFileSync(join(evidenceRoot, "latest.json"), "utf8"));
  return {
    latest,
    report: JSON.parse(readFileSync(join(evidenceRoot, latest.artifacts.json), "utf8")),
    html: readFileSync(join(evidenceRoot, latest.artifacts.html), "utf8"),
  };
}

test("published privacy evidence proves six aggregate budget failures without retaining fixture state", () => {
  const { latest, report } = publishedReport();
  assert.equal(latest.score, 76);
  assert.equal(report.score.overall, 76);
  assert.deepEqual(report.findings.map((item) => item.ruleId), [
    "privacy-cookie-count-budget",
    "privacy-cookie-byte-budget",
    "privacy-local-storage-entry-budget",
    "privacy-local-storage-byte-budget",
    "privacy-session-storage-entry-budget",
    "privacy-session-storage-byte-budget",
  ]);
  const cookieSummary = report.findings[0].measurements.aggregate.cookieSummary;
  assert.deepEqual(cookieSummary, { available: true, bytes: 368, count: 4, thirdPartyCount: 0 });
  assert.equal(report.findings[2].measurements.aggregate.localStorage.bytes, 1136);
  assert.equal(report.findings[4].measurements.aggregate.sessionStorage.bytes, 654);
  assert.ok(report.adapter.capabilities.includes("aggregate-browser-storage-privacy-budgets"));

  const serialized = JSON.stringify(report);
  for (const marker of ["rc_fixture_", "fixture-", "rc-local-", "local-fixture-", "rc-session-", "session-fixture-"]) {
    assert.doesNotMatch(serialized, new RegExp(marker));
  }
  assert.match(serialized, /without retaining cookie names, values, storage keys, or storage values/);
});

test("published privacy report is bilingual, offline, and repair-oriented", () => {
  const { report, html } = publishedReport();
  assert.ok(report.findings.every((item) => item.translations["zh-CN"]?.title));
  assert.ok(report.findings.every((item) => item.remediation.summary && item.translations["zh-CN"].remediation.summary));
  assert.match(html, /data-language="zh-CN"/);
  assert.match(html, /privacy-cookie-count-budget/);
  assert.match(html, /Cookie 数量超过项目隐私预算/);
  assert.doesNotMatch(html, /<script[^>]+src=/i);
});

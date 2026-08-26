import assert from "node:assert/strict";
import test from "node:test";

import {
  compareNoteBundles,
  markLegacyPackageScopeUnverified,
  NOTE_RULESET_ID,
  noteComparisonGateFailed,
  noteComparisonRegressionCounts,
  noteFindingFingerprint,
  prepareNoteBaselineForComparison,
  validateNoteBundleForComparison,
} from "../realitycheck/scripts/note-compare.mjs";

function finding(ruleId, affectedCount = 1, extra = {}) {
  return {
    id: `NOTE-${ruleId.toUpperCase()}`,
    ruleId,
    level: "warning",
    category: "integrity",
    title: { en: ruleId, zhCN: ruleId },
    summary: { en: "summary", zhCN: "摘要" },
    remediation: { en: "repair", zhCN: "修复" },
    affectedCount,
    evidence: [{ path: "index.html", line: 1, excerpt: ruleId }],
    evidenceTruncated: false,
    safeFix: false,
    ...extra,
  };
}

function report(path, findings = []) {
  return { schemaVersion: "1", kind: "html-note-check", path, findings };
}

function bundle({
  id = "NOTE-RUN",
  reports = [report("index.html")],
  packageFindings = [],
  knownFiles = reports.length,
  truncated = false,
  kind = "html-note-check-bundle",
  selection,
  knownFilePaths,
  rulesetId = NOTE_RULESET_ID,
  importedArchive,
} = {}) {
  const selectedKnownPaths = selection?.html?.excludedFiles || [];
  const requiredPaths = [...new Set([...reports.map((entry) => entry.path), ...selectedKnownPaths])];
  const paths = knownFilePaths === undefined
    ? knownFiles === null ? null : [...requiredPaths, ...Array.from({ length: Math.max(0, knownFiles - requiredPaths.length) }, (_, index) => `__known__/file-${index + 1}.bin`)].sort()
    : knownFilePaths;
  const value = {
    schemaVersion: "1",
    kind,
    id,
    generatedAt: "2026-08-27T00:00:00.000Z",
    rulesetId,
    discovery: { htmlFiles: reports.length, knownFiles, knownFilePaths: paths, truncated },
    reports,
    packageFindings,
  };
  if (importedArchive !== undefined) value.importedArchive = importedArchive;
  if (selection !== undefined) value.selection = selection;
  return value;
}

test("stable fingerprints bind a rule to an exact HTML or package scope", () => {
  assert.equal(noteFindingFingerprint("notes/index.html", "missing-title"), "html:notes/index.html::missing-title");
  assert.equal(noteFindingFingerprint({ kind: "html", path: "notes/index.html" }, "missing-title"), "html:notes/index.html::missing-title");
  assert.equal(noteFindingFingerprint("package", "css-missing-local-file"), "package::css-missing-local-file");
  assert.throws(() => noteFindingFingerprint("../index.html", "missing-title"), /without traversal/);
  assert.throws(() => noteFindingFingerprint("index.html", "Missing_Title"), /lowercase letters/);
});

test("comparison classifies new, resolved, worsened, persistent, and package findings deterministically", () => {
  const before = bundle({
    id: "BEFORE",
    knownFiles: 4,
    reports: [
      report("guide.html", [finding("unfinished-placeholder")]),
      report("index.html", [finding("duplicate-id", 2), finding("missing-title")]),
    ],
    packageFindings: [finding("broken-cross-document-fragment", 2), finding("css-missing-local-file")],
  });
  const after = bundle({
    id: "AFTER",
    knownFiles: 5,
    reports: [
      report("index.html", [finding("unsafe-script"), finding("missing-title"), finding("duplicate-id", 3)]),
      report("guide.html"),
    ],
    packageFindings: [finding("broken-cross-document-fragment")],
  });

  const comparison = compareNoteBundles(before, after);
  assert.equal(comparison.kind, "html-note-check-comparison");
  assert.deepEqual(comparison.counts, {
    new: 1,
    resolved: 2,
    worsened: 1,
    persistent: 2,
    unverified: 0,
    regressions: 2,
    active: 4,
    compared: 6,
  });
  assert.equal(comparison.new[0].fingerprint, "html:index.html::unsafe-script");
  assert.equal(comparison.worsened[0].fingerprint, "html:index.html::duplicate-id");
  assert.equal(comparison.worsened[0].affectedCountDelta, 1);
  assert.equal(comparison.persistent.find((item) => item.ruleId === "broken-cross-document-fragment").reason, "affected-count-decreased-but-persists");
  assert.deepEqual(comparison.resolved.map((item) => item.fingerprint), [
    "html:guide.html::unfinished-placeholder",
    "package::css-missing-local-file",
  ]);
  assert.ok(comparison.resolved.every((item) => item.afterAffectedCount === 0 && item.reason === "not-detected-in-complete-scope"));
  assert.deepEqual(comparison.before.htmlPaths, ["guide.html", "index.html"]);
  assert.deepEqual(comparison.after.htmlPaths, ["guide.html", "index.html"]);
});

test("deleting an HTML file cannot turn its finding or package finding into a resolution", () => {
  const before = bundle({
    knownFiles: 3,
    reports: [report("index.html"), report("removed.html", [finding("duplicate-id")])],
    packageFindings: [finding("broken-cross-document-fragment")],
  });
  const after = bundle({ reports: [report("index.html")], knownFiles: 2 });
  const comparison = compareNoteBundles(before, after);

  assert.equal(comparison.counts.resolved, 0);
  assert.equal(comparison.counts.unverified, 2);
  assert.equal(comparison.unverified.find((item) => item.scope.kind === "html").reason, "html-scope-missing");
  const packageItem = comparison.unverified.find((item) => item.scope.kind === "package");
  assert.equal(packageItem.reason, "package-html-scope-missing");
  assert.deepEqual(packageItem.details.missingHtmlPaths, ["removed.html"]);
  assert.equal(packageItem.afterAffectedCount, null);
  assert.equal(packageItem.affectedCountDelta, null);
  assert.equal(comparison.unverified.some((item) => item.ruleId === "coverage-scope"), false, "real unverified findings must not be duplicated by synthetic coverage items");
});

test("same-size package replacement cannot disguise a deleted asset as a resolution", () => {
  const before = bundle({
    knownFiles: 2,
    knownFilePaths: ["index.html", "styles.css"],
    packageFindings: [finding("css-remote-dependency")],
  });
  const after = bundle({
    knownFiles: 2,
    knownFilePaths: ["index.html", "replacement.txt"],
  });
  const comparison = compareNoteBundles(before, after);
  assert.equal(comparison.counts.resolved, 0);
  const item = comparison.unverified.find((entry) => entry.ruleId === "css-remote-dependency");
  assert.equal(item.reason, "package-file-scope-missing");
  assert.deepEqual(item.details.missingKnownFilePaths, ["styles.css"]);
});

test("ruleset drift and missing imported-archive identity remain unverified", () => {
  const before = bundle({
    reports: [report("index.html", [finding("missing-title")])],
    importedArchive: { archiveSha256: "a".repeat(64), importContentId: `sha256:${"b".repeat(64)}` },
  });
  const drifted = bundle({ reports: [report("index.html")], rulesetId: `sha256:${"c".repeat(64)}` });
  const comparison = compareNoteBundles(before, drifted);
  assert.equal(comparison.counts.resolved, 0);
  assert.ok(comparison.unverified.some((item) => item.reason === "note-ruleset-drift"));
  assert.ok(comparison.unverified.some((item) => item.reason === "source-archive-identity-unavailable"));
  assert.equal(comparison.before.importedArchive.importContentId, `sha256:${"b".repeat(64)}`);
  assert.equal(comparison.after.importedArchive, null);
});

test("deleting a clean HTML file creates an error-level synthetic coverage regression", () => {
  const before = bundle({ reports: [report("index.html"), report("removed-clean.html")], knownFiles: 2 });
  const after = bundle({ reports: [report("index.html")], knownFiles: 1 });
  const comparison = compareNoteBundles(before, after);
  assert.equal(comparison.counts.resolved, 0);
  assert.equal(comparison.counts.unverified, 1);
  const coverage = comparison.unverified[0];
  assert.equal(coverage.fingerprint, "html:removed-clean.html::coverage-scope");
  assert.equal(coverage.reason, "html-scope-missing");
  assert.equal(coverage.before.level, "error");
  assert.equal(coverage.details.syntheticCoverage, true);
  assert.deepEqual(noteComparisonRegressionCounts(comparison), { error: 1, warning: 0, advice: 0, total: 1 });
  assert.equal(noteComparisonGateFailed(comparison, "error"), true);
});

test("an exact current HTML exclusion changes the audited scope without pretending resolution or deletion", () => {
  const before = bundle({
    reports: [report("archive/old.html", [finding("replacement-character", 1, { level: "error" })]), report("index.html")],
    knownFiles: 2,
  });
  const after = bundle({
    reports: [report("index.html")],
    knownFiles: 2,
    selection: { html: { excludePatterns: ["archive/**"], excludedFiles: ["archive/old.html"], excludedCount: 1 } },
  });
  const comparison = compareNoteBundles(before, after);
  assert.equal(comparison.counts.resolved, 0);
  assert.equal(comparison.counts.unverified, 1);
  assert.equal(comparison.unverified[0].reason, "html-scope-newly-excluded");
  assert.equal(comparison.unverified[0].before.level, "error");
  assert.deepEqual(comparison.scopeExclusions.html, {
    patterns: ["archive/**"],
    files: ["archive/old.html"],
    count: 1,
    baselineScopesExcluded: 1,
    baselineFindingsExcluded: 1,
    newlyExcludedScopes: 1,
  });
  assert.equal(noteComparisonGateFailed(comparison, "error"), true);

  const accepted = compareNoteBundles(after, after);
  assert.equal(accepted.counts.unverified, 0, "the same explicit exclusion in an accepted baseline must not keep CI red");
  assert.equal(accepted.scopeExclusions.html.newlyExcludedScopes, 0);
  assert.equal(noteComparisonGateFailed(accepted, "error"), false);

  const reIncluded = bundle({
    reports: [report("archive/old.html", [finding("replacement-character", 1, { level: "error" })]), report("index.html")],
    knownFiles: 2,
  });
  const restoredComparison = compareNoteBundles(after, reIncluded);
  assert.equal(restoredComparison.counts.new, 1, "removing an exclusion must resume ordinary finding comparison");
  assert.equal(restoredComparison.new[0].fingerprint, "html:archive/old.html::replacement-character");
  assert.equal(noteComparisonGateFailed(restoredComparison, "error"), true);

  const absentAfter = bundle({
    reports: [report("index.html")],
    knownFiles: 1,
    selection: { html: { excludePatterns: ["archive/**"], excludedFiles: [], excludedCount: 0 } },
  });
  const absentComparison = compareNoteBundles(before, absentAfter);
  assert.equal(absentComparison.counts.unverified, 1);
  assert.equal(absentComparison.unverified[0].scope.path, "archive/old.html");
  assert.equal(noteComparisonGateFailed(absentComparison, "error"), true);
});

test("incomplete or contracted package coverage is gated even when neither bundle has package findings", () => {
  const before = bundle({ reports: [report("index.html")], knownFiles: 3 });
  const cases = [
    [bundle({ reports: [report("index.html")], knownFiles: null, truncated: true }), "after-discovery-truncated"],
    [bundle({ reports: [report("index.html")], knownFiles: null }), "package-scope-not-verified"],
    [bundle({ reports: [report("index.html")], knownFiles: 2 }), "package-scope-contracted"],
  ];
  for (const [after, expectedReason] of cases) {
    const comparison = compareNoteBundles(before, after);
    assert.equal(comparison.counts.unverified, 1, expectedReason);
    const coverage = comparison.unverified[0];
    assert.equal(coverage.fingerprint, "package::coverage-scope");
    assert.equal(coverage.reason, expectedReason);
    assert.equal(coverage.after.level, "error");
    assert.equal(coverage.details.syntheticCoverage, true);
    assert.equal(noteComparisonGateFailed(comparison, "error"), true);
  }
});

test("more than 500 excluded HTML inventory files remain valid as the tool's own baseline", () => {
  const excludedFiles = Array.from({ length: 501 }, (_, index) => `archive/old-${index}.html`);
  const evidence = bundle({
    reports: [report("index.html")],
    knownFiles: 502,
    selection: { html: { excludePatterns: ["archive/**"], excludedFiles, excludedCount: excludedFiles.length } },
  });
  const comparison = compareNoteBundles(evidence, evidence);
  assert.equal(comparison.counts.regressions, 0);
  assert.equal(comparison.scopeExclusions.html.count, 501);
  assert.equal(comparison.scopeExclusions.html.newlyExcludedScopes, 0);
});

test("a truncated after discovery leaves disappeared findings unverified even when the HTML path remains", () => {
  const before = bundle({ reports: [report("index.html", [finding("missing-title")])], knownFiles: 1 });
  const after = bundle({ reports: [report("index.html")], knownFiles: null, truncated: true });
  const comparison = compareNoteBundles(before, after);
  assert.equal(comparison.counts.unverified, 1);
  assert.equal(comparison.unverified[0].reason, "after-discovery-truncated");
  assert.equal(comparison.counts.resolved, 0);
});

test("package disappearance is unverified without a complete or non-contracted package scope", () => {
  const before = bundle({ knownFiles: 4, packageFindings: [finding("css-missing-local-file")] });
  const noPackageScope = bundle({ knownFiles: null });
  const unavailable = compareNoteBundles(before, noPackageScope);
  assert.equal(unavailable.unverified[0].reason, "package-scope-not-verified");

  const contracted = compareNoteBundles(before, bundle({ knownFiles: 3 }));
  assert.equal(contracted.unverified[0].reason, "package-scope-contracted");
  assert.deepEqual(contracted.unverified[0].details, { beforeKnownFiles: 4, afterKnownFiles: 3 });
});

test("a lower affected count remains persistent instead of being called resolved", () => {
  const before = bundle({ reports: [report("index.html", [finding("duplicate-id", 4)])] });
  const after = bundle({ reports: [report("index.html", [finding("duplicate-id", 1)])] });
  const comparison = compareNoteBundles(before, after);
  assert.equal(comparison.counts.persistent, 1);
  assert.equal(comparison.persistent[0].reason, "affected-count-decreased-but-persists");
  assert.equal(comparison.persistent[0].affectedCountDelta, -3);
});

test("severity escalation is worsened and baseline gates preserve the fail-on level", () => {
  const before = bundle({ reports: [report("index.html", [finding("remote-dependency", 1, { level: "warning" })])] });
  const after = bundle({ reports: [report("index.html", [finding("remote-dependency", 1, { level: "error" })])] });
  const comparison = compareNoteBundles(before, after);
  assert.equal(comparison.worsened[0].reason, "severity-increased");
  assert.deepEqual(noteComparisonRegressionCounts(comparison), { error: 1, warning: 0, advice: 0, total: 1 });
  assert.equal(noteComparisonGateFailed(comparison, "error"), true);
  assert.equal(noteComparisonGateFailed(comparison, "never"), false);
});

test("legacy package ownership is accepted but cannot produce a trusted resolution", () => {
  const legacy = bundle({ reports: [report("index.html", [finding("css-missing-local-file", 1, { level: "error" })])], knownFiles: 2 });
  delete legacy.packageFindings;
  const prepared = prepareNoteBaselineForComparison(legacy);
  assert.equal(prepared.packageScopeUnverified, true);
  assert.equal(prepared.warnings[0].code, "legacy-baseline-package-scope");
  const comparison = markLegacyPackageScopeUnverified(compareNoteBundles(prepared.bundle, bundle({ knownFiles: 3 })));
  assert.equal(comparison.counts.resolved, 0);
  assert.equal(comparison.counts.unverified, 1);
  assert.equal(comparison.unverified[0].reason, "legacy-baseline-package-scope");
});

test("validation rejects ambiguous, incomplete, and non-JSON comparison inputs", () => {
  assert.throws(() => validateNoteBundleForComparison(null), /must be an object/);
  assert.throws(() => validateNoteBundleForComparison({}), /schemaVersion 1/);
  assert.throws(() => validateNoteBundleForComparison(bundle({ kind: "site-audit" })), /HTML note bundle/);
  assert.throws(() => validateNoteBundleForComparison(bundle({ reports: [], knownFiles: 0 })), /at least one HTML note report/);
  assert.throws(() => validateNoteBundleForComparison({ ...bundle(), discovery: { htmlFiles: 2, knownFiles: 2, truncated: false } }), /equal reports.length/);
  assert.throws(() => validateNoteBundleForComparison(bundle({ reports: [report("../index.html")] })), /without traversal/);
  assert.throws(() => validateNoteBundleForComparison(bundle({ reports: [report("index.html"), report("index.html")] })), /duplicate HTML path/);
  assert.throws(() => validateNoteBundleForComparison(bundle({ reports: [report("index.html", [finding("missing-title"), finding("missing-title")])] })), /duplicate ruleId/);
  assert.throws(() => validateNoteBundleForComparison(bundle({ reports: [report("index.html", [finding("missing-title", 0)])] })), /positive safe integer/);
  assert.throws(() => validateNoteBundleForComparison(bundle({ knownFiles: null, packageFindings: [finding("css-missing-local-file")] })), /complete package scope/);
  assert.throws(() => validateNoteBundleForComparison(bundle({ selection: { html: { excludePatterns: ["../archive/**"], excludedFiles: [], excludedCount: 0 } } })), /relative portable glob|parent/);
  assert.throws(() => validateNoteBundleForComparison(bundle({ selection: { html: { excludePatterns: ["archive/**"], excludedFiles: ["index.html"], excludedCount: 1 } } })), /cannot overlap/);
  assert.throws(() => validateNoteBundleForComparison(bundle({ knownFiles: 1, selection: { html: { excludePatterns: ["archive/**"], excludedFiles: ["archive/old.html"], excludedCount: 1 } } })), /knownFilePaths length|known file inventory/);
  assert.throws(() => validateNoteBundleForComparison(bundle({ knownFiles: 2, selection: { html: { excludePatterns: ["archive/**"], excludedFiles: ["archive/old.html"], excludedCount: 0 } } })), /equal excludedFiles.length/);
  const circular = finding("missing-title");
  circular.extra = circular;
  assert.throws(() => validateNoteBundleForComparison(bundle({ reports: [report("index.html", [circular])] })), /circular references/);
});

test("comparison is pure, detached, and stable regardless of report and finding order", () => {
  const sourceFinding = finding("missing-title");
  const before = bundle({ reports: [report("z.html", [sourceFinding]), report("a.html", [finding("duplicate-id")])] });
  const after = bundle({ reports: [report("a.html"), report("z.html", [finding("missing-title")])] });
  const snapshot = JSON.stringify({ before, after });
  const first = compareNoteBundles(before, after);
  const second = compareNoteBundles(
    bundle({ reports: [...before.reports].reverse().map((item) => ({ ...item, findings: [...item.findings].reverse() })) }),
    bundle({ reports: [...after.reports].reverse().map((item) => ({ ...item, findings: [...item.findings].reverse() })) }),
  );
  assert.deepEqual(first.counts, second.counts);
  assert.deepEqual(first.resolved.map((item) => item.fingerprint), second.resolved.map((item) => item.fingerprint));
  assert.equal(JSON.stringify({ before, after }), snapshot);
  first.persistent[0].after.title.en = "mutated output";
  assert.equal(after.reports[1].findings[0].title.en, "missing-title");
});

const BUNDLE_KINDS = new Set(["html-note-check-bundle", "html-note-browser-check"]);
const FINDING_LEVELS = new Set(["error", "warning", "advice"]);
const RULE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const LEVEL_RANK = Object.freeze({ advice: 0, warning: 1, error: 2 });
const LEGACY_PACKAGE_RULE_IDS = new Set([
  "broken-cross-document-fragment",
  "css-insecure-remote-dependency",
  "css-missing-local-file",
  "css-path-case-mismatch",
  "css-remote-dependency",
  "external-css-wide-fixed-layout",
  "package-content-not-verified",
  "unsafe-package-path",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertRecord(value, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
}

function assertNonEmptyString(value, label, maximum = 1000) {
  if (typeof value !== "string" || !value.length || value !== value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${label} must be a non-empty, trimmed string of at most ${maximum} characters`);
  }
}

function validateRuleId(ruleId, label = "ruleId") {
  if (typeof ruleId !== "string" || !RULE_ID_PATTERN.test(ruleId)) {
    throw new TypeError(`${label} must use lowercase letters, numbers, and hyphens`);
  }
  return ruleId;
}

function validateHtmlPath(path, label = "HTML path") {
  assertNonEmptyString(path, label);
  if (path.includes("\\") || path.startsWith("/") || /^[a-z]:/i.test(path) || /^(?:file|https?):/i.test(path)) {
    throw new TypeError(`${label} must be a portable relative path`);
  }
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..") || !/\.html?$/i.test(path)) {
    throw new TypeError(`${label} must identify a relative .html or .htm file without traversal`);
  }
  return path;
}

function cloneJson(value, label, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must contain only finite JSON numbers`);
    return value;
  }
  if (typeof value !== "object") throw new TypeError(`${label} must contain only JSON values`);
  if (seen.has(value)) throw new TypeError(`${label} must not contain circular references`);
  seen.add(value);
  let output;
  if (Array.isArray(value)) {
    output = value.map((item, index) => cloneJson(item, `${label}[${index}]`, seen));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must contain only plain JSON objects`);
    output = {};
    for (const [key, item] of Object.entries(value)) output[key] = cloneJson(item, `${label}.${key}`, seen);
  }
  seen.delete(value);
  return output;
}

function normalizeScope(scope) {
  if (scope === "package") return { kind: "package" };
  if (typeof scope === "string") return { kind: "html", path: validateHtmlPath(scope, "scope") };
  assertRecord(scope, "scope");
  if (scope.kind === "package") {
    if (Object.hasOwn(scope, "path")) throw new TypeError("package scope must not contain a path");
    return { kind: "package" };
  }
  if (scope.kind === "html") return { kind: "html", path: validateHtmlPath(scope.path, "scope.path") };
  throw new TypeError("scope.kind must be html or package");
}

function scopeKey(scope) {
  return scope.kind === "package" ? "package" : `html:${scope.path}`;
}

/** Build the stable note-finding identity: exact HTML path (or package) plus rule ID. */
export function noteFindingFingerprint(scope, ruleId) {
  const normalized = normalizeScope(scope);
  return `${scopeKey(normalized)}::${validateRuleId(ruleId)}`;
}

function normalizeFinding(finding, label) {
  assertRecord(finding, label);
  assertNonEmptyString(finding.id, `${label}.id`, 200);
  validateRuleId(finding.ruleId, `${label}.ruleId`);
  if (!FINDING_LEVELS.has(finding.level)) throw new TypeError(`${label}.level must be error, warning, or advice`);
  if (!Number.isSafeInteger(finding.affectedCount) || finding.affectedCount < 1) {
    throw new TypeError(`${label}.affectedCount must be a positive safe integer`);
  }
  return cloneJson(finding, label);
}

function normalizeReport(report, label) {
  assertRecord(report, label);
  if (report.schemaVersion !== "1" || report.kind !== "html-note-check") {
    throw new TypeError(`${label} must be a schemaVersion 1 HTML note report`);
  }
  const path = validateHtmlPath(report.path, `${label}.path`);
  if (!Array.isArray(report.findings)) throw new TypeError(`${label}.findings must be an array`);
  const findings = report.findings.map((finding, index) => normalizeFinding(finding, `${label}.findings[${index}]`));
  const rules = new Set();
  for (const finding of findings) {
    if (rules.has(finding.ruleId)) throw new TypeError(`${label} contains duplicate ruleId ${finding.ruleId}`);
    rules.add(finding.ruleId);
  }
  findings.sort((left, right) => left.ruleId.localeCompare(right.ruleId));
  return { path, findings };
}

function normalizeDiscovery(discovery, reports, label) {
  assertRecord(discovery, label);
  if (!Number.isSafeInteger(discovery.htmlFiles) || discovery.htmlFiles < 0) throw new TypeError(`${label}.htmlFiles must be a non-negative safe integer`);
  if (discovery.htmlFiles !== reports.length) throw new TypeError(`${label}.htmlFiles must equal reports.length`);
  if (typeof discovery.truncated !== "boolean") throw new TypeError(`${label}.truncated must be a boolean`);
  if (discovery.knownFiles !== null && (!Number.isSafeInteger(discovery.knownFiles) || discovery.knownFiles < reports.length)) {
    throw new TypeError(`${label}.knownFiles must be null or a safe integer at least as large as htmlFiles`);
  }
  if (discovery.truncated && discovery.knownFiles !== null) throw new TypeError(`${label}.knownFiles must be null when discovery is truncated`);
  return { htmlFiles: discovery.htmlFiles, knownFiles: discovery.knownFiles, truncated: discovery.truncated };
}

/**
 * Validate and normalize the small, source-free subset required for a comparison.
 * The returned value is detached from the input and sorted for deterministic output.
 */
export function validateNoteBundleForComparison(bundle, label = "bundle") {
  assertRecord(bundle, label);
  if (bundle.schemaVersion !== "1" || !BUNDLE_KINDS.has(bundle.kind)) {
    throw new TypeError(`${label} must be a schemaVersion 1 RealityCheck HTML note bundle`);
  }
  if (!Array.isArray(bundle.reports)) throw new TypeError(`${label}.reports must be an array`);
  if (!bundle.reports.length) throw new TypeError(`${label}.reports must contain at least one HTML note report`);
  if (!Array.isArray(bundle.packageFindings)) throw new TypeError(`${label}.packageFindings must be an array`);
  const reports = bundle.reports.map((report, index) => normalizeReport(report, `${label}.reports[${index}]`));
  reports.sort((left, right) => left.path.localeCompare(right.path));
  const paths = new Set();
  for (const report of reports) {
    if (paths.has(report.path)) throw new TypeError(`${label} contains duplicate HTML path ${report.path}`);
    paths.add(report.path);
  }
  const discovery = normalizeDiscovery(bundle.discovery, reports, `${label}.discovery`);
  const packageFindings = bundle.packageFindings.map((finding, index) => normalizeFinding(finding, `${label}.packageFindings[${index}]`));
  const packageRules = new Set();
  for (const finding of packageFindings) {
    if (packageRules.has(finding.ruleId)) throw new TypeError(`${label}.packageFindings contains duplicate ruleId ${finding.ruleId}`);
    packageRules.add(finding.ruleId);
  }
  packageFindings.sort((left, right) => left.ruleId.localeCompare(right.ruleId));
  if ((discovery.truncated || discovery.knownFiles === null) && packageFindings.length) {
    throw new TypeError(`${label}.packageFindings must be empty when the complete package scope was not discovered`);
  }
  if (bundle.id !== undefined && bundle.id !== null) assertNonEmptyString(bundle.id, `${label}.id`, 300);
  if (bundle.generatedAt !== undefined && bundle.generatedAt !== null) {
    assertNonEmptyString(bundle.generatedAt, `${label}.generatedAt`, 100);
    if (Number.isNaN(Date.parse(bundle.generatedAt))) throw new TypeError(`${label}.generatedAt must be a valid date-time`);
  }
  return {
    schemaVersion: "1",
    kind: bundle.kind,
    id: bundle.id ?? null,
    generatedAt: bundle.generatedAt ?? null,
    discovery,
    reports,
    packageFindings,
  };
}

/**
 * Adapt only the one documented legacy note-bundle shape: releases that did
 * not yet expose `packageFindings` and attached package rules to the first
 * HTML report. Everything else still passes through the strict comparison
 * validator. The caller must keep package-scope outcomes unverified because
 * the historical ownership cannot be reconstructed with certainty.
 */
export function prepareNoteBaselineForComparison(bundle) {
  assertRecord(bundle, "baseline");
  const normalized = cloneJson(bundle, "baseline");
  const warnings = [];
  let packageScopeUnverified = false;

  if (!Object.hasOwn(normalized, "packageFindings")) {
    packageScopeUnverified = true;
    normalized.packageFindings = [];
    const extracted = new Map();
    if (Array.isArray(normalized.reports)) {
      for (const report of normalized.reports) {
        if (!Array.isArray(report?.findings)) continue;
        const htmlFindings = [];
        for (const finding of report.findings) {
          if (!LEGACY_PACKAGE_RULE_IDS.has(finding?.ruleId)) {
            htmlFindings.push(finding);
            continue;
          }
          const existing = extracted.get(finding.ruleId);
          if (!existing) {
            extracted.set(finding.ruleId, finding);
            continue;
          }
          existing.affectedCount += finding.affectedCount;
          const evidence = [...(existing.evidence || []), ...(finding.evidence || [])];
          existing.evidence = evidence.slice(0, 20);
          existing.evidenceTruncated = Boolean(existing.evidenceTruncated || finding.evidenceTruncated || evidence.length > 20);
        }
        report.findings = htmlFindings;
      }
    }
    normalized.packageFindings = [...extracted.values()];
    warnings.push({
      code: "legacy-baseline-package-scope",
      message: {
        en: extracted.size
          ? `The baseline predates independent package findings; ${extracted.size} historical package rule(s) were recovered but remain unverified.`
          : "The baseline predates independent package findings; package-scope changes remain unverified.",
        zhCN: extracted.size
          ? `基线早于独立文件包问题字段；已识别 ${extracted.size} 项历史文件包规则，但其差异仍标为未核验。`
          : "基线早于独立文件包问题字段；文件包范围的差异仍标为未核验。",
      },
    });
  }

  // Validate here for an early, baseline-specific diagnostic. Return the
  // schema-bearing clone because compareNoteBundles validates and normalizes
  // both inputs again.
  validateNoteBundleForComparison(normalized, "baseline");
  return {
    bundle: normalized,
    warnings,
    packageScopeUnverified,
  };
}

function indexFindings(bundle) {
  const findings = new Map();
  for (const report of bundle.reports) {
    const scope = { kind: "html", path: report.path };
    for (const finding of report.findings) {
      const fingerprint = noteFindingFingerprint(scope, finding.ruleId);
      findings.set(fingerprint, { fingerprint, scope, ruleId: finding.ruleId, finding });
    }
  }
  const scope = { kind: "package" };
  for (const finding of bundle.packageFindings) {
    const fingerprint = noteFindingFingerprint(scope, finding.ruleId);
    findings.set(fingerprint, { fingerprint, scope, ruleId: finding.ruleId, finding });
  }
  return findings;
}

function itemFor(state, beforeEntry, afterEntry, reason, details = {}) {
  const identity = afterEntry || beforeEntry;
  const beforeAffectedCount = beforeEntry ? beforeEntry.finding.affectedCount : state === "new" ? 0 : null;
  const afterAffectedCount = afterEntry ? afterEntry.finding.affectedCount : state === "resolved" ? 0 : null;
  return {
    fingerprint: identity.fingerprint,
    state,
    scope: { ...identity.scope },
    ruleId: identity.ruleId,
    beforeAffectedCount,
    afterAffectedCount,
    affectedCountDelta: beforeAffectedCount !== null && afterAffectedCount !== null ? afterAffectedCount - beforeAffectedCount : null,
    reason,
    details: cloneJson(details, "comparison details"),
    before: beforeEntry ? cloneJson(beforeEntry.finding, "before finding") : null,
    after: afterEntry ? cloneJson(afterEntry.finding, "after finding") : null,
  };
}

function classifyMissingBeforeFinding(entry, before, after, afterHtmlPaths) {
  if (after.discovery.truncated) {
    return { state: "unverified", reason: "after-discovery-truncated", details: {} };
  }
  if (entry.scope.kind === "html") {
    if (!afterHtmlPaths.has(entry.scope.path)) {
      return { state: "unverified", reason: "html-scope-missing", details: { missingHtmlPaths: [entry.scope.path] } };
    }
    return { state: "resolved", reason: "not-detected-in-complete-scope", details: {} };
  }

  if (after.discovery.knownFiles === null) {
    return { state: "unverified", reason: "package-scope-not-verified", details: {} };
  }
  const missingHtmlPaths = before.reports.map((report) => report.path).filter((path) => !afterHtmlPaths.has(path));
  if (missingHtmlPaths.length) {
    return { state: "unverified", reason: "package-html-scope-missing", details: { missingHtmlPaths } };
  }
  if (before.discovery.knownFiles !== null && after.discovery.knownFiles < before.discovery.knownFiles) {
    return {
      state: "unverified",
      reason: "package-scope-contracted",
      details: { beforeKnownFiles: before.discovery.knownFiles, afterKnownFiles: after.discovery.knownFiles },
    };
  }
  return { state: "resolved", reason: "not-detected-in-complete-scope", details: {} };
}

function bundleReference(bundle) {
  return {
    id: bundle.id,
    kind: bundle.kind,
    generatedAt: bundle.generatedAt,
    discovery: { ...bundle.discovery },
    htmlPaths: bundle.reports.map((report) => report.path),
  };
}

function coverageFinding(scope) {
  const html = scope.kind === "html";
  return {
    id: "NOTE-COVERAGE-SCOPE",
    ruleId: "coverage-scope",
    level: "error",
    category: "integrity",
    title: {
      en: html ? "A baseline HTML scope was not verified" : "The baseline package scope was not verified",
      zhCN: html ? "基线中的 HTML 范围未得到核验" : "基线文件包范围未得到核验",
    },
    summary: {
      en: html
        ? "A baseline HTML file is absent from the current complete comparison scope, so its clean state cannot be assumed."
        : "The current package inventory is incomplete or smaller than the baseline, so missing findings cannot be treated as resolved.",
      zhCN: html
        ? "本次完整比较范围缺少基线中的 HTML 文件，因此不能假定该文件仍保持干净。"
        : "本次文件包清单不完整或小于基线，因此不能把消失的问题视为已解决。",
    },
    remediation: {
      en: "Restore and check the same HTML/package scope, or intentionally approve a new complete baseline after review.",
      zhCN: "恢复并检查相同的 HTML/文件包范围，或在复核后有意批准一份新的完整基线。",
    },
    affectedCount: 1,
    evidence: html ? [{ path: scope.path, line: 1, excerpt: "Baseline HTML scope unavailable in the current comparison" }] : [],
    evidenceTruncated: false,
    safeFix: false,
  };
}

function coverageEntry(scope) {
  const ruleId = "coverage-scope";
  return {
    fingerprint: noteFindingFingerprint(scope, ruleId),
    scope,
    ruleId,
    finding: coverageFinding(scope),
  };
}

/**
 * Findings alone cannot prove coverage: deleting a clean HTML file or an
 * unreferenced package asset yields no finding fingerprint to compare. Add one
 * error-level synthetic item only when a real unverified item does not already
 * explain the same missing scope.
 */
function addCoverageScopeUnverified(output, before, after, afterHtmlPaths) {
  const missingHtmlPaths = before.reports.map((report) => report.path).filter((path) => !afterHtmlPaths.has(path));
  for (const path of missingHtmlPaths) {
    const alreadyExplained = output.unverified.some((item) => item.scope?.kind === "html" && item.scope.path === path);
    if (alreadyExplained) continue;
    const scope = { kind: "html", path };
    output.unverified.push(itemFor("unverified", coverageEntry(scope), null, "html-scope-missing", { syntheticCoverage: true, missingHtmlPaths: [path] }));
  }

  // A missing HTML scope already explains why the package inventory changed;
  // do not add a second synthetic package item for the same contraction.
  if (missingHtmlPaths.length
    || output.unverified.some((item) => item.scope?.kind === "package")
    || (after.discovery.truncated && output.unverified.some((item) => item.reason === "after-discovery-truncated"))) return;

  let reason = null;
  let details = {};
  if (after.discovery.truncated) {
    reason = "after-discovery-truncated";
  } else if (after.discovery.knownFiles === null) {
    reason = "package-scope-not-verified";
  } else if (before.discovery.knownFiles !== null && after.discovery.knownFiles < before.discovery.knownFiles) {
    reason = "package-scope-contracted";
    details = { beforeKnownFiles: before.discovery.knownFiles, afterKnownFiles: after.discovery.knownFiles };
  }
  if (!reason) return;
  const scope = { kind: "package" };
  output.unverified.push(itemFor("unverified", null, coverageEntry(scope), reason, { syntheticCoverage: true, ...details }));
}

function comparisonCounts(output) {
  const items = [...output.new, ...output.resolved, ...output.worsened, ...output.persistent, ...output.unverified];
  return {
    new: output.new.length,
    resolved: output.resolved.length,
    worsened: output.worsened.length,
    persistent: output.persistent.length,
    unverified: output.unverified.length,
    regressions: output.new.length + output.worsened.length + output.unverified.length,
    active: items.filter((item) => item.after !== null).length,
    compared: items.length,
  };
}

function effectiveComparisonLevel(item) {
  const levels = [item?.before?.level, item?.after?.level].filter((level) => FINDING_LEVELS.has(level));
  return levels.sort((left, right) => LEVEL_RANK[right] - LEVEL_RANK[left])[0] || "advice";
}

/** Return regression-only counts used by baseline CI gates. */
export function noteComparisonRegressionCounts(comparison) {
  assertRecord(comparison, "comparison");
  if (comparison.kind !== "html-note-check-comparison") throw new TypeError("comparison must be an HTML note comparison");
  const counts = { error: 0, warning: 0, advice: 0, total: 0 };
  for (const state of ["new", "worsened", "unverified"]) {
    if (!Array.isArray(comparison[state])) throw new TypeError(`comparison.${state} must be an array`);
    for (const item of comparison[state]) {
      counts[effectiveComparisonLevel(item)] += 1;
      counts.total += 1;
    }
  }
  return counts;
}

/** Apply the note fail-on vocabulary to regressions, never to persistent debt. */
export function noteComparisonGateFailed(comparison, failOn) {
  if (!new Set(["error", "warning", "never"]).has(failOn)) throw new TypeError("failOn must be error, warning, or never");
  if (failOn === "never") return false;
  const counts = noteComparisonRegressionCounts(comparison);
  return failOn === "error" ? counts.error > 0 : counts.error + counts.warning > 0;
}

/**
 * Fail closed for package results compared with a legacy bundle that lacked a
 * trustworthy package scope. This rewrites, rather than duplicates, the item
 * so a historical package rule can never be reported as resolved.
 */
export function markLegacyPackageScopeUnverified(comparison) {
  assertRecord(comparison, "comparison");
  if (comparison.kind !== "html-note-check-comparison") throw new TypeError("comparison must be an HTML note comparison");
  const output = { new: [], resolved: [], worsened: [], persistent: [], unverified: [] };
  for (const state of Object.keys(output)) {
    if (!Array.isArray(comparison[state])) throw new TypeError(`comparison.${state} must be an array`);
    for (const item of comparison[state]) {
      if (item?.scope?.kind !== "package") {
        output[state].push(item);
        continue;
      }
      output.unverified.push({
        ...item,
        state: "unverified",
        reason: "legacy-baseline-package-scope",
        details: {
          ...(item.details || {}),
          previousState: state,
          previousReason: item.reason,
        },
      });
    }
  }
  for (const state of Object.keys(output)) output[state].sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  return { ...comparison, counts: comparisonCounts(output), ...output };
}

/**
 * Compare two complete HTML-note evidence bundles without trusting score deltas.
 * Resolution is intentionally fail-closed: removing an HTML scope, shrinking a
 * package scope, or truncating the after discovery produces `unverified`.
 */
export function compareNoteBundles(beforeInput, afterInput) {
  const before = validateNoteBundleForComparison(beforeInput, "before");
  const after = validateNoteBundleForComparison(afterInput, "after");
  const beforeFindings = indexFindings(before);
  const afterFindings = indexFindings(after);
  const afterHtmlPaths = new Set(after.reports.map((report) => report.path));
  const output = { new: [], resolved: [], worsened: [], persistent: [], unverified: [] };
  const fingerprints = [...new Set([...beforeFindings.keys(), ...afterFindings.keys()])].sort((left, right) => left.localeCompare(right));

  for (const fingerprint of fingerprints) {
    const beforeEntry = beforeFindings.get(fingerprint) || null;
    const afterEntry = afterFindings.get(fingerprint) || null;
    if (!beforeEntry) {
      output.new.push(itemFor("new", null, afterEntry, "not-present-in-baseline"));
      continue;
    }
    if (!afterEntry) {
      const classification = classifyMissingBeforeFinding(beforeEntry, before, after, afterHtmlPaths);
      output[classification.state].push(itemFor(classification.state, beforeEntry, null, classification.reason, classification.details));
      continue;
    }
    const affectedCountIncreased = afterEntry.finding.affectedCount > beforeEntry.finding.affectedCount;
    const severityIncreased = LEVEL_RANK[afterEntry.finding.level] > LEVEL_RANK[beforeEntry.finding.level];
    if (affectedCountIncreased || severityIncreased) {
      const reason = affectedCountIncreased && severityIncreased
        ? "severity-and-affected-count-increased"
        : affectedCountIncreased ? "affected-count-increased" : "severity-increased";
      output.worsened.push(itemFor("worsened", beforeEntry, afterEntry, reason));
      continue;
    }
    const reason = afterEntry.finding.affectedCount < beforeEntry.finding.affectedCount
      ? "affected-count-decreased-but-persists"
      : "still-detected";
    output.persistent.push(itemFor("persistent", beforeEntry, afterEntry, reason));
  }

  addCoverageScopeUnverified(output, before, after, afterHtmlPaths);
  output.unverified.sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));

  const counts = comparisonCounts(output);
  return {
    schemaVersion: "1",
    kind: "html-note-check-comparison",
    before: bundleReference(before),
    after: bundleReference(after),
    counts,
    ...output,
  };
}

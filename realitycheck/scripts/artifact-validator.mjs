import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { verifyEvidenceManifest } from "./evidence-manifest.mjs";
import { verifyEvidenceAttestation } from "./evidence-attestation.mjs";
import { computeAuditPlanId } from "./audit-plan.mjs";
import { buildNotePublishManifest } from "./note-publish-report.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ASSET_DIR = resolve(SCRIPT_DIR, "../assets");
const ARTIFACT_FILES = new Set([
  "report.json",
  "verification.json",
  "site-report.json",
  "site-verification.json",
  "trend.json",
  "catalog.json",
  "repair-plan.json",
  "latest.json",
  "evidence-manifest.json",
  "evidence-attestation.json",
  "evidence-trust.json",
  "evidence-trust-report.json",
  "risk-register.json",
  "policy-review.json",
  "github-issue-drafts.json",
  "release-decision.json",
  "audit-plan.json",
  "realitycheck.config.json",
  "comparison.json",
  "technical-report.json",
  "browser-proof.json",
]);
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "__pycache__"]);

const SCHEMA_BY_ARTIFACT = {
  report: "report.schema.json",
  verification: "verification.schema.json",
  "site-audit": "site-report.schema.json",
  "site-verification": "site-verification.schema.json",
  "quality-trend": "trend.schema.json",
  "artifact-catalog": "catalog.schema.json",
  "repair-plan": "repair-plan.schema.json",
  "latest-run": "latest-run.schema.json",
  "evidence-manifest": "evidence-manifest.schema.json",
  "evidence-attestation": "evidence-attestation.schema.json",
  "evidence-trust-policy": "evidence-trust.schema.json",
  "evidence-trust-report": "evidence-trust-report.schema.json",
  "risk-register": "risk-register.schema.json",
  "policy-review": "policy-review.schema.json",
  "github-issue-drafts": "issue-drafts.schema.json",
  "release-decision": "release-decision.schema.json",
  "audit-plan": "audit-plan.schema.json",
  "html-note-check-bundle": "html-note-check-bundle.schema.json",
  "html-note-check-comparison": "html-note-check-comparison.schema.json",
  "html-note-publish-proof": "html-note-publish-proof.schema.json",
  "html-note-publish-receipt": "html-note-publish-receipt.schema.json",
  "html-note-publish-browser-proof": "html-note-publish-browser-proof.schema.json",
  "html-note-publish-technical-report": "html-note-publish-technical-report.schema.json",
  config: "config.schema.json",
};

const PUBLISH_SUFFIX_ARTIFACT = /\.realitycheck-(?:publish|working-copy)\.(?:receipt|manifest)\.json$/;

function isDiscoveredArtifact(path) {
  const name = basename(path);
  if (ARTIFACT_FILES.has(name)) return true;
  if (PUBLISH_SUFFIX_ARTIFACT.test(name)) return true;
  return name === "manifest.json" && basename(dirname(path)) === "realitycheck-proof";
}

function artifactKind(value, path) {
  if (basename(path) === "realitycheck.config.json" || String(value?.$schema || "").endsWith("config.schema.json")) return "config";
  if (value?.kind && SCHEMA_BY_ARTIFACT[value.kind]) return value.kind;
  if (value?.run && value?.target && Array.isArray(value?.scenarios) && Array.isArray(value?.findings)) return "report";
  if (value?.before && value?.after && value?.threshold && Array.isArray(value?.resolved)) return "verification";
  throw new Error(`${path}: unrecognized RealityCheck artifact`);
}

function collectPaths(inputPaths) {
  const found = [];
  const visit = (candidate) => {
    const path = resolve(candidate);
    if (!existsSync(path)) throw new Error(`${path}: path does not exist`);
    const stats = statSync(path);
    if (stats.isFile()) {
      found.push(path);
      return;
    }
    if (!stats.isDirectory()) throw new Error(`${path}: expected a JSON file or directory`);
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) visit(child);
      else if (entry.isFile() && isDiscoveredArtifact(child)) found.push(child);
    }
  };
  for (const inputPath of inputPaths) visit(inputPath);
  return [...new Set(found)].sort();
}

function loadJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path}: invalid JSON (${error.message})`);
  }
}

function createValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const schemas = {};
  for (const [kind, filename] of Object.entries(SCHEMA_BY_ARTIFACT)) {
    schemas[kind] = loadJson(join(ASSET_DIR, filename));
    ajv.addSchema(schemas[kind]);
  }
  const validators = {};
  for (const [kind, schema] of Object.entries(schemas)) validators[kind] = ajv.getSchema(schema.$id);
  return validators;
}

function displayError(error) {
  const location = error.instancePath || "/";
  return `${location} ${error.message || "is invalid"}`;
}

function verifyEvidenceTrustReport(report) {
  const errors = [];
  const allChecksPassed = Object.values(report.checks || {}).every(Boolean);
  if ((report.state === "trusted") !== allChecksPassed) errors.push("/state does not match the three trust checks");
  if (Boolean(report.checks?.authorization) !== (report.signer?.status === "trusted")) errors.push("/checks/authorization does not match signer registry status");
  if (report.checks?.authorization && !report.signer?.keyId) errors.push("/signer/keyId is required for an authorized signer");
  if (report.state === "trusted" && report.policy?.activeKeys < 1) errors.push("/policy/activeKeys must be positive for trusted evidence");
  if (report.state === "trusted" && (report.errors || []).length) errors.push("/errors must be empty for trusted evidence");
  if (report.state === "rejected" && !(report.errors || []).length) errors.push("/errors must explain rejected evidence");
  return errors;
}

function verifyRiskRegister(register) {
  const errors = [];
  const entries = register.entries || [];
  const expected = {
    risks: entries.length,
    open: entries.filter((item) => item.state === "open").length,
    recurring: entries.filter((item) => item.occurrences > 1).length,
    overdue: entries.filter((item) => item.overdue).length,
    waived: entries.filter((item) => item.state === "waived").length,
    resolved: entries.filter((item) => item.state === "resolved").length,
    unverified: entries.filter((item) => item.state === "unverified").length,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (register.summary?.[key] !== value) errors.push(`/summary/${key} does not match the risk entries`);
  }
  const violations = register.policy?.violations || [];
  if (Boolean(register.policy?.gateFailed) !== (violations.length > 0)) errors.push("/policy/gateFailed does not match policy violations");
  const limits = {
    "open-risk-age": register.policy?.maxOpenAgeDays,
    "open-risk-count": register.policy?.maxOpenRisks,
    "recurring-risk-count": register.policy?.maxRecurringRisks,
  };
  const actuals = {
    "open-risk-age": Math.max(0, ...entries.filter((item) => item.state === "open").map((item) => item.ageDays)),
    "open-risk-count": expected.open,
    "recurring-risk-count": expected.recurring,
  };
  for (const violation of violations) {
    if (limits[violation.code] === null || limits[violation.code] === undefined) errors.push(`/policy/violations ${violation.code} has no configured limit`);
    else if (violation.expected !== limits[violation.code]) errors.push(`/policy/violations ${violation.code} expected value does not match its configured limit`);
    if (violation.actual !== actuals[violation.code]) errors.push(`/policy/violations ${violation.code} actual value does not match the risk entries`);
    if (violation.actual <= violation.expected) errors.push(`/policy/violations ${violation.code} does not exceed its configured limit`);
  }
  for (const entry of entries) {
    const overdue = entry.state === "open" && register.policy?.maxOpenAgeDays !== null && entry.ageDays > register.policy.maxOpenAgeDays;
    if (entry.overdue !== overdue) errors.push(`/entries/${entry.id}/overdue does not match open-risk age policy`);
  }
  return errors;
}

function verifyPolicyReview(review) {
  const errors = [];
  const changes = review.changes || [];
  const expected = {
    changes: changes.length,
    weakened: changes.filter((item) => item.classification === "weakened").length,
    strengthened: changes.filter((item) => item.classification === "strengthened").length,
    review: changes.filter((item) => item.classification === "review").length,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (review.summary?.[key] !== value) errors.push(`/summary/${key} does not match the policy changes`);
  }
  if (Boolean(review.summary?.gateFailed) !== (expected.weakened > 0)) errors.push("/summary/gateFailed must match the presence of weakened changes");
  const ids = new Set();
  for (const change of changes) {
    if (ids.has(change.id)) errors.push(`/changes contains duplicate id ${change.id}`);
    ids.add(change.id);
  }
  if (review.sources?.before?.fingerprint === review.sources?.after?.fingerprint && changes.length) errors.push("/sources equivalent fingerprints cannot contain policy changes");
  return errors;
}

function verifyIssueDrafts(bundle) {
  const errors = [];
  const drafts = bundle.drafts || [];
  const occurrences = drafts.reduce((sum, draft) => sum + (draft.occurrences?.length || 0), 0);
  const expected = {
    drafts: drafts.length,
    occurrences,
    duplicates: occurrences - drafts.length,
    actionable: drafts.filter((draft) => draft.disposition === "actionable").length,
    review: drafts.filter((draft) => draft.disposition === "review").length,
    waived: drafts.filter((draft) => draft.disposition === "waived").length,
    critical: drafts.filter((draft) => draft.severity === "critical").length,
    major: drafts.filter((draft) => draft.severity === "major").length,
    minor: drafts.filter((draft) => draft.severity === "minor").length,
    info: drafts.filter((draft) => draft.severity === "info").length,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (bundle.summary?.[key] !== value) errors.push(`/summary/${key} does not match the issue drafts`);
  }
  const ids = new Set();
  const fingerprints = new Set();
  for (const draft of drafts) {
    if (ids.has(draft.id)) errors.push(`/drafts contains duplicate id ${draft.id}`);
    if (fingerprints.has(draft.fingerprint)) errors.push(`/drafts contains duplicate fingerprint ${draft.fingerprint}`);
    ids.add(draft.id);
    fingerprints.add(draft.fingerprint);
  }
  return errors;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function verifyReleaseDecision(bundle) {
  const errors = [];
  const controls = bundle.controls || [];
  const expected = {
    controls: controls.length,
    required: controls.filter((item) => item.required).length,
    passed: controls.filter((item) => item.state === "pass").length,
    review: controls.filter((item) => item.state === "review").length,
    failed: controls.filter((item) => item.state === "fail").length,
    missing: controls.filter((item) => item.state === "missing").length,
    stale: controls.filter((item) => item.state === "stale").length,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (bundle.summary?.[key] !== value) errors.push(`/summary/${key} does not match the release controls`);
  }
  const keys = new Set();
  for (const control of controls) {
    if (keys.has(control.key)) errors.push(`/controls contains duplicate key ${control.key}`);
    keys.add(control.key);
    const reasonOutcomes = new Set((control.reasons || []).map((item) => item.outcome));
    const reasonCodes = new Set((control.reasons || []).map((item) => item.code));
    if (control.state === "missing") {
      if (!control.required) errors.push(`/controls/${control.key} missing controls must be required`);
      if (control.candidates !== 0 || control.observedAt !== null || control.ageHours !== null || control.artifact) errors.push(`/controls/${control.key} missing state contains selected evidence`);
      if (!reasonCodes.has("required-control-missing")) errors.push(`/controls/${control.key} missing state needs required-control-missing reason`);
    } else {
      if (!control.artifact || control.candidates < 1 || control.observedAt === null || control.ageHours === null) errors.push(`/controls/${control.key} selected evidence metadata is incomplete`);
    }
    if (control.state === "fail" && !reasonOutcomes.has("fail")) errors.push(`/controls/${control.key} failed state needs a fail reason`);
    if (control.state === "review" && !reasonOutcomes.has("review")) errors.push(`/controls/${control.key} review state needs a review reason`);
    if (control.state === "stale" && !reasonCodes.has("evidence-stale")) errors.push(`/controls/${control.key} stale state needs an evidence-stale reason`);
    if (control.state === "pass" && reasonOutcomes.size) errors.push(`/controls/${control.key} passed state cannot contain review or fail reasons`);
  }
  const required = [...(bundle.policy?.requiredControls || [])];
  for (const key of required) {
    const control = controls.find((item) => item.key === key);
    if (!control?.required) errors.push(`/policy/requiredControls ${key} is not represented as required`);
  }
  for (const control of controls.filter((item) => item.required)) {
    if (!required.includes(control.key)) errors.push(`/controls/${control.key} is required but absent from policy.requiredControls`);
  }
  const expectedDecision = controls.some((item) => item.state === "fail" || (item.required && ["missing", "stale"].includes(item.state)))
    ? "no-go"
    : controls.some((item) => item.state === "review" || item.state === "stale") ? "review" : "go";
  if (bundle.decision !== expectedDecision) errors.push("/decision does not match control outcomes");
  if (bundle.summary?.decision !== expectedDecision) errors.push("/summary/decision does not match control outcomes");
  const identity = {
    policy: { maxAgeHours: bundle.policy?.maxAgeHours, requiredControls: required },
    controls: controls.map((item) => ({ key: item.key, required: item.required, state: item.state, sha256: item.artifact?.sha256 || null })),
  };
  const expectedId = `RELEASE-${createHash("sha256").update(JSON.stringify(canonical(identity))).digest("hex").slice(0, 12).toUpperCase()}`;
  if (bundle.id !== expectedId) errors.push("/id does not bind the release policy and selected control evidence");
  return errors;
}

function verifyAuditPlan(plan) {
  const errors = [];
  let target;
  try {
    target = new URL(plan.target?.url);
    if (target.search || target.hash || target.username || target.password) errors.push("/target/url must not retain credentials, query values, or fragments");
  } catch (_) {
    errors.push("/target/url is not a valid URL");
  }
  const execution = plan.execution || {};
  const detectors = plan.detectors || [];
  const detectorKeys = new Set();
  for (const detector of detectors) {
    if (detectorKeys.has(detector.key)) errors.push(`/detectors contains duplicate key ${detector.key}`);
    detectorKeys.add(detector.key);
  }
  const viewportIds = new Set((execution.viewports || []).map((item) => item.id));
  const scenarioIds = new Set(execution.builtInScenarios || []);
  for (const id of viewportIds) if (!scenarioIds.has(id)) errors.push(`/execution/builtInScenarios is missing viewport ${id}`);
  if (!scenarioIds.has("baseline")) errors.push("/execution/builtInScenarios is missing baseline");
  if (scenarioIds.size !== (execution.builtInScenarios || []).length) errors.push("/execution/builtInScenarios contains duplicates");
  if (execution.scenariosPerPage !== (execution.builtInScenarios || []).length) errors.push("/execution/scenariosPerPage does not match builtInScenarios");
  const expectedExecutions = execution.pagesMax * execution.scenariosPerPage + execution.journeyScenarios;
  if (execution.scenarioExecutionsMax !== expectedExecutions) errors.push("/execution/scenarioExecutionsMax does not match page and journey bounds");
  const expectedSummary = {
    pagesMax: execution.pagesMax,
    scenariosPerPage: execution.scenariosPerPage,
    journeyScenarios: execution.journeyScenarios,
    scenarioExecutionsMax: expectedExecutions,
    enabledDetectors: detectors.filter((item) => item.enabled).length,
    policySettings: detectors.reduce((total, item) => total + item.policySettings, 0),
  };
  for (const [key, value] of Object.entries(expectedSummary)) {
    if (plan.summary?.[key] !== value) errors.push(`/summary/${key} does not match the plan details`);
  }
  if (plan.governance?.baselineMode !== execution.baselineMode) errors.push("/governance/baselineMode does not match execution.baselineMode");
  if (plan.id !== computeAuditPlanId(plan)) errors.push("/id does not bind the effective target, policy, execution, and governance plan");
  return errors;
}

const NOTE_LEVEL_WEIGHT = Object.freeze({ error: 7, warning: 2, advice: 1 });
const NOTE_LEVEL_RANK = Object.freeze({ advice: 0, warning: 1, error: 2 });
const PUBLISH_READY_STATUSES = new Set(["ready", "warnings"]);
const REQUIRED_PUBLISH_SCENARIOS = new Set([
  "desktop-root",
  "mobile-375-root",
  "desktop-project-mount",
  "mobile-375-project-mount",
  "offline-exact-replay",
  "local-pages-and-fragments",
]);

function findingCounts(findings) {
  const counts = { error: 0, warning: 0, advice: 0, autoFixable: 0 };
  for (const finding of findings || []) {
    if (Object.hasOwn(counts, finding.level)) counts[finding.level] += finding.affectedCount;
    if (finding.safeFix) counts.autoFixable += 1;
  }
  return counts;
}

function noteStatus(counts) {
  return counts.error ? "needs-fix" : counts.warning ? "review" : "ready";
}

function compareCounts(actual, expected, path, errors) {
  for (const [key, value] of Object.entries(expected)) {
    if (actual?.[key] !== value) errors.push(`${path}/${key} does not match the emitted findings`);
  }
}

function verifyNoteAnalysis(analysis, prefix = "") {
  const errors = [];
  const paths = new Set();
  for (const [index, report] of (analysis.reports || []).entries()) {
    const path = `${prefix}/reports/${index}`;
    if (paths.has(report.path)) errors.push(`${prefix}/reports contains duplicate HTML path ${report.path}`);
    paths.add(report.path);
    const rules = new Set();
    for (const finding of report.findings || []) {
      if (rules.has(finding.ruleId)) errors.push(`${path}/findings contains duplicate ruleId ${finding.ruleId}`);
      rules.add(finding.ruleId);
      if (finding.id !== `NOTE-${finding.ruleId.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`) errors.push(`${path}/findings/${finding.ruleId}/id does not match ruleId`);
      if (!finding.evidenceTruncated && finding.evidence?.length !== finding.affectedCount) {
        errors.push(`${path}/findings/${finding.ruleId}/evidence count must match affectedCount when evidence is not truncated`);
      }
    }
    const counts = findingCounts(report.findings);
    compareCounts(report.counts, counts, `${path}/counts`, errors);
    const deduction = (report.findings || []).reduce((sum, finding) => sum + NOTE_LEVEL_WEIGHT[finding.level] * Math.min(finding.affectedCount, 3), 0);
    if (report.score !== Math.max(0, 100 - deduction)) errors.push(`${path}/score does not match weighted findings`);
    if (report.status !== noteStatus(counts)) errors.push(`${path}/status does not match finding counts`);
  }

  const packageRules = new Set();
  for (const finding of analysis.packageFindings || []) {
    if (packageRules.has(finding.ruleId)) errors.push(`${prefix}/packageFindings contains duplicate ruleId ${finding.ruleId}`);
    packageRules.add(finding.ruleId);
  }
  const packageCounts = findingCounts(analysis.packageFindings);
  const packageDeduction = (analysis.packageFindings || []).reduce((sum, finding) => sum + NOTE_LEVEL_WEIGHT[finding.level] * Math.min(finding.affectedCount, 3), 0);
  compareCounts(analysis.packageSummary?.counts, packageCounts, `${prefix}/packageSummary/counts`, errors);
  if (analysis.packageSummary?.findings !== (analysis.packageFindings || []).length) errors.push(`${prefix}/packageSummary/findings does not match packageFindings`);
  if (analysis.packageSummary?.affected !== packageCounts.error + packageCounts.warning + packageCounts.advice) errors.push(`${prefix}/packageSummary/affected does not match package findings`);
  if (analysis.packageSummary?.scoreDeduction !== packageDeduction) errors.push(`${prefix}/packageSummary/scoreDeduction does not match package findings`);
  if (analysis.packageSummary?.status !== noteStatus(packageCounts)) errors.push(`${prefix}/packageSummary/status does not match package findings`);

  const aggregate = { error: packageCounts.error, warning: packageCounts.warning, advice: packageCounts.advice, autoFixable: packageCounts.autoFixable };
  for (const report of analysis.reports || []) for (const key of Object.keys(aggregate)) aggregate[key] += report.counts?.[key] || 0;
  const lowest = Math.min(...(analysis.reports || []).map((report) => report.score));
  const score = Math.max(0, Math.min(100, Math.round(lowest - packageDeduction)));
  compareCounts(analysis.summary?.counts, aggregate, `${prefix}/summary/counts`, errors);
  if (analysis.summary?.files !== (analysis.reports || []).length) errors.push(`${prefix}/summary/files does not match reports`);
  if (analysis.summary?.lowestFileScore !== lowest) errors.push(`${prefix}/summary/lowestFileScore does not match reports`);
  if (analysis.summary?.packageDeduction !== packageDeduction) errors.push(`${prefix}/summary/packageDeduction does not match packageSummary`);
  if (analysis.summary?.score !== score) errors.push(`${prefix}/summary/score does not match the lowest file and package deduction`);
  if (analysis.summary?.status !== noteStatus(aggregate)) errors.push(`${prefix}/summary/status does not match aggregate counts`);
  return errors;
}

function verifyNoteBundle(bundle) {
  const errors = verifyNoteAnalysis(bundle, "");
  const reportPaths = (bundle.reports || []).map((report) => report.path);
  if (bundle.discovery?.htmlFiles !== reportPaths.length) errors.push("/discovery/htmlFiles does not match reports");
  if (bundle.discovery?.knownFilePaths !== null) {
    if (bundle.discovery.knownFiles !== bundle.discovery.knownFilePaths.length) errors.push("/discovery/knownFiles does not match knownFilePaths");
    const known = new Set(bundle.discovery.knownFilePaths);
    if (reportPaths.some((path) => !known.has(path))) errors.push("/discovery/knownFilePaths must include every checked HTML path");
  }
  if (bundle.discovery?.truncated && (bundle.discovery.knownFiles !== null || bundle.discovery.knownFilePaths !== null)) errors.push("/discovery truncated scope cannot claim a complete known-file inventory");
  if (bundle.selection?.html?.excludedCount !== bundle.selection?.html?.excludedFiles?.length) errors.push("/selection/html/excludedCount does not match excludedFiles");
  if (bundle.selection?.html?.excludedFiles?.some((path) => reportPaths.includes(path))) errors.push("/selection/html/excludedFiles overlaps checked reports");
  if (bundle.comparison) {
    errors.push(...verifyNoteComparison(bundle.comparison).map((error) => `/comparison${error}`));
    if (bundle.comparison.after?.id !== bundle.id) errors.push("/comparison/after/id does not match bundle id");
  }
  return errors;
}

function comparisonLevel(item) {
  const levels = [item?.before?.level, item?.after?.level].filter((level) => Object.hasOwn(NOTE_LEVEL_RANK, level));
  return levels.sort((left, right) => NOTE_LEVEL_RANK[right] - NOTE_LEVEL_RANK[left])[0] || "advice";
}

function verifyNoteComparison(comparison) {
  const errors = [];
  const states = ["new", "resolved", "worsened", "persistent", "unverified"];
  const all = [];
  for (const state of states) {
    for (const [index, item] of (comparison[state] || []).entries()) {
      const path = `/${state}/${index}`;
      all.push(item);
      if (item.state !== state) errors.push(`${path}/state does not match its comparison collection`);
      const expectedFingerprint = `${item.scope?.kind === "package" ? "package" : `html:${item.scope?.path}`}::${item.ruleId}`;
      if (item.fingerprint !== expectedFingerprint) errors.push(`${path}/fingerprint does not match scope and ruleId`);
      if (item.before && item.before.ruleId !== item.ruleId) errors.push(`${path}/before/ruleId does not match item ruleId`);
      if (item.after && item.after.ruleId !== item.ruleId) errors.push(`${path}/after/ruleId does not match item ruleId`);
      const beforeCount = item.before ? item.before.affectedCount : state === "new" ? 0 : null;
      const afterCount = item.after ? item.after.affectedCount : state === "resolved" ? 0 : null;
      if (item.beforeAffectedCount !== beforeCount) errors.push(`${path}/beforeAffectedCount does not match before finding`);
      if (item.afterAffectedCount !== afterCount) errors.push(`${path}/afterAffectedCount does not match after finding`);
      const delta = beforeCount !== null && afterCount !== null ? afterCount - beforeCount : null;
      if (item.affectedCountDelta !== delta) errors.push(`${path}/affectedCountDelta does not match before/after counts`);
      if (state === "new" && (item.before !== null || item.after === null)) errors.push(`${path} new items require only an after finding`);
      if (state === "resolved" && (item.before === null || item.after !== null)) errors.push(`${path} resolved items require only a before finding`);
      if (["worsened", "persistent"].includes(state) && (!item.before || !item.after)) errors.push(`${path} ${state} items require before and after findings`);
    }
  }
  const fingerprints = all.map((item) => item.fingerprint);
  if (new Set(fingerprints).size !== fingerprints.length) errors.push("/comparison contains duplicate finding fingerprints");
  const expected = {
    new: comparison.new?.length || 0,
    resolved: comparison.resolved?.length || 0,
    worsened: comparison.worsened?.length || 0,
    persistent: comparison.persistent?.length || 0,
    unverified: comparison.unverified?.length || 0,
  };
  expected.regressions = expected.new + expected.worsened + expected.unverified;
  expected.active = all.filter((item) => item.after !== null).length;
  expected.compared = all.length;
  for (const [key, value] of Object.entries(expected)) if (comparison.counts?.[key] !== value) errors.push(`/counts/${key} does not match comparison items`);
  const regressionCounts = { error: 0, warning: 0, advice: 0, total: 0 };
  for (const state of ["new", "worsened", "unverified"]) for (const item of comparison[state] || []) {
    regressionCounts[comparisonLevel(item)] += 1;
    regressionCounts.total += 1;
  }
  for (const [key, value] of Object.entries(regressionCounts)) if (comparison.regressionsByLevel?.[key] !== value) errors.push(`/regressionsByLevel/${key} does not match regression items`);
  const gateFailed = comparison.gate?.failOn === "error"
    ? regressionCounts.error > 0
    : comparison.gate?.failOn === "warning" ? regressionCounts.error + regressionCounts.warning > 0 : false;
  if (comparison.gate?.failed !== gateFailed) errors.push("/gate/failed does not match regression severity counts");
  for (const side of ["before", "after"]) {
    const reference = comparison[side];
    if (reference?.discovery?.htmlFiles !== reference?.htmlPaths?.length) errors.push(`/${side}/discovery/htmlFiles does not match htmlPaths`);
    if (reference?.selection?.html?.excludedCount !== reference?.selection?.html?.excludedFiles?.length) errors.push(`/${side}/selection/html/excludedCount does not match excludedFiles`);
  }
  const exclusions = comparison.scopeExclusions?.html;
  if (exclusions?.count !== exclusions?.files?.length) errors.push("/scopeExclusions/html/count does not match files");
  if (exclusions?.newlyExcludedScopes !== exclusions?.baselineScopesExcluded) errors.push("/scopeExclusions/html/newlyExcludedScopes does not match baselineScopesExcluded");
  return errors;
}

function verifyPlatformDecisions(platforms, prefix = "/platformDecisions") {
  const errors = [];
  for (const [key, decision] of Object.entries(platforms || {})) {
    if (decision.status === "pass" && decision.reasons.length) errors.push(`${prefix}/${key}/reasons must be empty for pass`);
    if (decision.status !== "pass" && !decision.reasons.length) errors.push(`${prefix}/${key}/reasons must explain review or block`);
  }
  return errors;
}

function samePlatformDecisions(left, right) {
  const keys = ["netlifyDrop", "cloudflarePagesDirectUpload", "githubPages"];
  return keys.every((key) => left?.[key]?.status === right?.[key]?.status
    && isDeepStrictEqual([...(left?.[key]?.reasons || [])].sort(), [...(right?.[key]?.reasons || [])].sort()));
}

function verifyPublishProof(proof) {
  const errors = verifyPlatformDecisions(proof.platformDecisions);
  let rebuilt;
  try {
    rebuilt = buildNotePublishManifest({
      generatedAt: proof.generatedAt,
      deployContentId: proof.deployContentId,
      browserProofId: proof.browserProofId,
      status: proof.status,
      platformDecisions: proof.platformDecisions,
      findingsSummary: proof.findingsSummary,
    });
  } catch (error) {
    errors.push(`/status and evidence are incoherent (${error.message})`);
    return errors;
  }
  if (!isDeepStrictEqual(rebuilt, proof)) errors.push("/manifestId or normalized public proof fields do not match the manifest content");
  if (proof.boundaries?.browserProofPresent !== Boolean(proof.browserProofId)) errors.push("/boundaries/browserProofPresent does not match browserProofId");
  if (Boolean(proof.artifacts?.browserProof) !== Boolean(proof.browserProofId)) errors.push("/artifacts/browserProof does not match browserProofId");
  return errors;
}

function observerIsClean(scenario) {
  return ["consoleErrors", "pageErrors", "requestFailures", "httpErrors", "unexpectedRequests", "responseVerificationErrors"]
    .every((key) => scenario[key]?.length === 0)
    && scenario.popups + scenario.dialogs + scenario.downloads + scenario.workers + scenario.websockets === 0;
}

function expectedScenarioPass(scenario, entrypoint) {
  const common = observerIsClean(scenario)
    && !scenario.coverageTruncated
    && scenario.responseProof?.some((entry) => entry.path === entrypoint);
  if (scenario.id === "local-pages-and-fragments") return common && scenario.failures.length === 0;
  return common
    && scenario.navigationError === null
    && scenario.measurement?.textLength >= 20
    && scenario.overflow === false
    && (scenario.id !== "offline-exact-replay" || scenario.serverRequestCount === 0);
}

function verifyPublishBrowserProof(proof, prefix = "") {
  const errors = [];
  const byId = new Map();
  for (const [index, scenario] of (proof.scenarios || []).entries()) {
    const path = `${prefix}/scenarios/${index}`;
    if (byId.has(scenario.id)) errors.push(`${prefix}/scenarios contains duplicate id ${scenario.id}`);
    byId.set(scenario.id, scenario);
    const expectedStatus = expectedScenarioPass(scenario, proof.deploy?.entrypoint) ? "passed" : "failed";
    if (scenario.status !== expectedStatus) errors.push(`${path}/status does not match captured browser evidence`);
    const consoleTotal = Object.values(scenario.consoleByType || {}).reduce((sum, count) => sum + count, 0);
    if (scenario.consoleTotal !== consoleTotal) errors.push(`${path}/consoleTotal does not match consoleByType`);
    if (!scenario.coverageTruncated && scenario.serverRequestCount !== scenario.serverRequests?.length) errors.push(`${path}/serverRequestCount does not match serverRequests`);
    const responsePaths = (scenario.responseProof || []).map((entry) => entry.path);
    if (new Set(responsePaths).size !== responsePaths.length) errors.push(`${path}/responseProof contains duplicate paths`);
  }
  for (const id of REQUIRED_PUBLISH_SCENARIOS) if (!byId.has(id)) errors.push(`${prefix}/scenarios is missing ${id}`);
  const expectedShape = {
    "desktop-root": ["/", "loopback-exact-bytes"],
    "mobile-375-root": ["/", "loopback-exact-bytes"],
    "desktop-project-mount": ["/project/", "loopback-exact-bytes"],
    "mobile-375-project-mount": ["/project/", "loopback-exact-bytes"],
    "offline-exact-replay": ["/offline/", "offline-exact-replay"],
    "local-pages-and-fragments": ["/project/", "loopback-exact-bytes"],
  };
  for (const [id, [mount, source]] of Object.entries(expectedShape)) {
    const scenario = byId.get(id);
    if (scenario && (scenario.mount !== mount || scenario.source !== source)) errors.push(`${prefix}/scenarios/${id} has the wrong mount or byte source`);
  }
  const roles = (proof.screenshots || []).map((entry) => entry.role);
  if (new Set(roles).size !== roles.length) errors.push(`${prefix}/screenshots contains duplicate roles`);
  for (const screenshot of proof.screenshots || []) if (screenshot.path !== `${screenshot.role}.png`) errors.push(`${prefix}/screenshots/${screenshot.role}/path does not match role`);
  if (proof.archive?.manifestFiles < proof.deploy?.files) errors.push(`${prefix}/archive/manifestFiles cannot be smaller than deploy/files`);
  const expectedTruncated = (proof.scenarios || []).some((scenario) => scenario.coverageTruncated);
  if (proof.evidenceTruncated !== expectedTruncated) errors.push(`${prefix}/evidenceTruncated does not match scenario coverage`);
  const passed = (proof.scenarios || []).length === 6
    && (proof.scenarios || []).every((scenario) => scenario.status === "passed")
    && new Set(roles).size === 2 && roles.includes("desktop") && roles.includes("mobile")
    && !proof.evidenceTruncated;
  if (proof.passed !== passed) errors.push(`${prefix}/passed does not match scenario and screenshot evidence`);
  return errors;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    table[value] = crc >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function readPublishStoreZip(bytes) {
  if (bytes.byteLength < 22 || bytes.byteLength > 64 * 1024 * 1024) throw new Error("archive size is outside the supported publish readback boundary");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset) => view.getUint16(offset, true);
  const u32 = (offset) => view.getUint32(offset, true);
  let eocd = -1;
  for (let offset = bytes.byteLength - 22, minimum = Math.max(0, bytes.byteLength - 65_557); offset >= minimum; offset -= 1) {
    if (u32(offset) === 0x06054b50 && offset + 22 + u16(offset + 20) === bytes.byteLength) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error("ZIP end record was not found");
  if (u16(eocd + 4) !== 0 || u16(eocd + 6) !== 0 || u16(eocd + 8) !== u16(eocd + 10)) throw new Error("multi-disk ZIPs are not supported");
  const fileCount = u16(eocd + 10);
  const centralBytes = u32(eocd + 12);
  const centralOffset = u32(eocd + 16);
  if (centralOffset + centralBytes !== eocd) throw new Error("ZIP central directory bounds do not match the end record");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries = new Map();
  let offset = centralOffset;
  for (let index = 0; index < fileCount; index += 1) {
    if (offset + 46 > eocd || u32(offset) !== 0x02014b50) throw new Error("invalid ZIP central directory record");
    const flags = u16(offset + 8);
    const method = u16(offset + 10);
    const checksum = u32(offset + 16);
    const compressed = u32(offset + 20);
    const size = u32(offset + 24);
    const nameBytes = u16(offset + 28);
    const extraBytes = u16(offset + 30);
    const commentBytes = u16(offset + 32);
    const localOffset = u32(offset + 42);
    const end = offset + 46 + nameBytes + extraBytes + commentBytes;
    if (end > eocd || flags !== 0x0800 || method !== 0 || compressed !== size) throw new Error("ZIP entry is not a deterministic UTF-8 STORE record");
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameBytes));
    if (!name || name.includes("\\") || name.startsWith("/") || name.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("ZIP entry path is not portable");
    if (entries.has(name)) throw new Error("ZIP contains a duplicate entry path");
    if (localOffset + 30 > centralOffset || u32(localOffset) !== 0x04034b50) throw new Error("ZIP local record is invalid");
    const localNameBytes = u16(localOffset + 26);
    const localExtraBytes = u16(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameBytes + localExtraBytes;
    if (u16(localOffset + 6) !== flags || u16(localOffset + 8) !== method || u32(localOffset + 14) !== checksum
      || u32(localOffset + 18) !== compressed || u32(localOffset + 22) !== size || dataOffset + size > centralOffset) {
      throw new Error("ZIP local and central records disagree");
    }
    const localName = decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameBytes));
    if (localName !== name) throw new Error("ZIP local and central entry paths disagree");
    const content = bytes.subarray(dataOffset, dataOffset + size);
    if (crc32(content) !== checksum) throw new Error(`ZIP CRC readback failed for ${name}`);
    entries.set(name, content);
    offset = end;
  }
  if (offset !== eocd || entries.size !== fileCount) throw new Error("ZIP central directory file count is inconsistent");
  return entries;
}

function jsonBytes(bytes, label) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8 JSON (${error.message})`);
  }
}

function jsonDigestId(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function verifyPublishReceipt(receipt, path) {
  const errors = verifyPlatformDecisions(receipt.platformDecisions);
  const shouldBeReady = PUBLISH_READY_STATUSES.has(receipt.status) && receipt.finalArchiveBrowserProofPassed;
  if (receipt.publishReady !== shouldBeReady) errors.push("/publishReady does not match status and final browser proof");
  const expectedSuffix = receipt.publishReady ? ".realitycheck-publish.zip" : ".realitycheck-working-copy.zip";
  if (!receipt.archive.filename.endsWith(expectedSuffix)) errors.push("/archive/filename does not match publishReady");
  if (basename(path) !== `${receipt.archive.filename.slice(0, -4)}.receipt.json`) errors.push("/archive/filename does not match the receipt filename");
  if (receipt.finalArchiveBrowserProofPassed !== Boolean(receipt.finalArchiveBrowserProofId)) errors.push("/finalArchiveBrowserProofPassed does not match finalArchiveBrowserProofId");
  if (receipt.publishReady && receipt.browserProofError !== null) errors.push("/browserProofError must be null for a publish-ready receipt");

  const archivePath = join(dirname(path), receipt.archive.filename);
  if (!existsSync(archivePath) || !statSync(archivePath).isFile()) {
    errors.push(`/archive sibling file is missing: ${receipt.archive.filename}`);
    return errors;
  }
  let bytes;
  let entries;
  try {
    bytes = readFileSync(archivePath);
    if (bytes.byteLength !== receipt.archive.bytes) errors.push("/archive/bytes does not match the sibling archive");
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== receipt.archive.sha256) errors.push("/archive/sha256 does not match the sibling archive");
    entries = readPublishStoreZip(bytes);
    if (!entries.has("index.html")) errors.push("/archive readback is missing root index.html");
  } catch (error) {
    errors.push(`/archive readback failed (${error.message})`);
    return errors;
  }
  const sidecarPath = `${archivePath}.sha256`;
  if (!existsSync(sidecarPath)) errors.push("/archive SHA-256 sidecar is missing");
  else {
    const expected = `${receipt.archive.sha256}  ${receipt.archive.filename}\n`;
    if (readFileSync(sidecarPath, "utf8") !== expected) errors.push("/archive SHA-256 sidecar does not exactly bind the archive filename and digest");
  }

  const manifestBytes = entries.get("realitycheck-proof/manifest.json");
  if (!manifestBytes) errors.push("/archive readback is missing realitycheck-proof/manifest.json");
  else {
    try {
      const manifest = jsonBytes(manifestBytes, "embedded publish manifest");
      if (manifest.kind !== "html-note-publish-proof") errors.push("/archive embedded manifest has the wrong kind");
      else {
        errors.push(...verifyPublishProof(manifest).map((error) => `/archive/manifest${error}`));
        if (manifest.status !== receipt.status) errors.push("/status differs from the embedded publish manifest");
        if (manifest.deployContentId !== receipt.deployContentId) errors.push("/deployContentId differs from the embedded publish manifest");
        if (manifest.browserProofId !== receipt.embeddedBrowserProofId) errors.push("/embeddedBrowserProofId differs from the embedded publish manifest");
        if (!samePlatformDecisions(manifest.platformDecisions, receipt.platformDecisions)) errors.push("/platformDecisions differ from the embedded publish manifest");
        const proofBytes = entries.get("realitycheck-proof/browser-proof.json");
        if (manifest.browserProofId && !proofBytes) errors.push("/archive embedded browser proof is missing");
        if (!manifest.browserProofId && proofBytes) errors.push("/archive contains a browser proof that is not bound by its manifest");
        if (proofBytes) {
          const embeddedProof = jsonBytes(proofBytes, "embedded browser proof");
          if (jsonDigestId(embeddedProof) !== receipt.embeddedBrowserProofId) errors.push("/embeddedBrowserProofId does not bind the embedded browser proof");
          if (embeddedProof.deploy?.contentId !== receipt.deployContentId) errors.push("/embedded browser proof deploy content differs from the receipt");
        }
        const siblingManifest = join(dirname(path), basename(path).replace(/\.receipt\.json$/, ".manifest.json"));
        if (existsSync(siblingManifest)) {
          const value = loadJson(siblingManifest);
          if (!isDeepStrictEqual(value, manifest)) errors.push("/sibling publish manifest differs from the archive-embedded manifest");
        }
      }
    } catch (error) {
      errors.push(`/archive embedded proof readback failed (${error.message})`);
    }
  }

  const finalProofPath = join(dirname(path), "browser-final-archive", "browser-proof.json");
  if (receipt.finalArchiveBrowserProofId && !existsSync(finalProofPath)) errors.push("/final archive browser proof sibling is missing");
  if (existsSync(finalProofPath)) {
    const proof = loadJson(finalProofPath);
    if (proof.kind !== "html-note-publish-browser-proof") errors.push("/final archive browser proof sibling has the wrong kind");
    else {
      if (jsonDigestId(proof) !== receipt.finalArchiveBrowserProofId) errors.push("/finalArchiveBrowserProofId does not bind the sibling proof");
      if (proof.passed !== receipt.finalArchiveBrowserProofPassed) errors.push("/finalArchiveBrowserProofPassed differs from the sibling proof");
      if (proof.archive?.sha256 !== receipt.archive.sha256 || proof.archive?.bytes !== receipt.archive.bytes) errors.push("/final archive browser proof does not bind the delivered archive bytes");
      if (proof.deploy?.contentId !== receipt.deployContentId) errors.push("/final archive browser proof deploy content differs from the receipt");
    }
  }
  return errors;
}

function verifyPublishTechnicalReport(report) {
  const errors = [
    ...verifyNoteAnalysis(report.analysis?.before || {}, "/analysis/before"),
    ...verifyNoteAnalysis(report.analysis?.after || {}, "/analysis/after"),
    ...verifyPlatformDecisions(report.platforms, "/platforms"),
  ];
  for (const [name, proof] of [["provisional", report.browser?.provisional], ["finalArchive", report.browser?.finalArchive]]) {
    if (!proof) continue;
    errors.push(...verifyPublishBrowserProof(proof, `/browser/${name}`));
    if (proof.deploy?.contentId !== report.deploy?.contentId) errors.push(`/browser/${name}/deploy/contentId does not match deploy/contentId`);
  }
  if (report.deploy?.gatewayGenerated === (report.deploy?.entry === "index.html")) errors.push("/deploy/gatewayGenerated contradicts the selected entry path");
  const blocked = (report.blockers || []).length > 0 || Object.values(report.platforms || {}).some((decision) => decision.status === "block");
  if (PUBLISH_READY_STATUSES.has(report.status)) {
    if (blocked) errors.push("/status cannot be publish-ready while blockers remain");
    if (!report.browser?.provisional?.passed || !report.browser?.finalArchive?.passed) errors.push("/status requires passed provisional and final-archive browser proofs");
    if (report.browser?.error !== null) errors.push("/browser/error must be null for a publish-ready technical report");
  }
  if (report.status === "browser-proof-required" && report.browser?.finalArchive !== null) errors.push("/browser/finalArchive must be null when browser proof is required");
  if (report.status === "working-copy" && !blocked && !report.browser?.error && report.browser?.provisional?.passed !== false && report.browser?.finalArchive?.passed !== false) {
    errors.push("/status working-copy requires a blocker or failed browser evidence");
  }
  if ((report.blockers || []).some((item) => item.code === "repair-regression")) {
    const blocker = report.blockers.find((item) => item.code === "repair-regression");
    if (blocker.before?.error >= blocker.after?.error && blocker.before?.warning >= blocker.after?.warning) errors.push("/blockers repair-regression does not describe worsened counts");
  }
  return errors;
}

function verifyBrowserProofSiblings(proof, path) {
  const errors = [];
  for (const screenshot of proof.screenshots || []) {
    const screenshotPath = join(dirname(path), screenshot.path);
    if (!existsSync(screenshotPath) || !statSync(screenshotPath).isFile()) {
      errors.push(`/screenshots/${screenshot.role} sibling file is missing`);
      continue;
    }
    const bytes = readFileSync(screenshotPath);
    if (bytes.byteLength !== screenshot.bytes) errors.push(`/screenshots/${screenshot.role}/bytes does not match the sibling image`);
    if (createHash("sha256").update(bytes).digest("hex") !== screenshot.sha256) errors.push(`/screenshots/${screenshot.role}/sha256 does not match the sibling image`);
  }
  return errors;
}

function verifyPublishProofSiblings(proof, path) {
  const errors = [];
  const name = basename(path);
  if (name === "manifest.json" && basename(dirname(path)) === "realitycheck-proof") {
    const browserPath = join(dirname(path), "browser-proof.json");
    if (proof.browserProofId && !existsSync(browserPath)) errors.push("/artifacts/browserProof sibling is missing");
    if (existsSync(browserPath)) {
      const browserProof = loadJson(browserPath);
      if (jsonDigestId(browserProof) !== proof.browserProofId) errors.push("/browserProofId does not bind the sibling browser proof");
      if (browserProof.deploy?.contentId !== proof.deployContentId) errors.push("/deployContentId differs from the sibling browser proof");
    }
  }
  if (PUBLISH_SUFFIX_ARTIFACT.test(name) && name.endsWith(".manifest.json")) {
    const receiptPath = join(dirname(path), name.replace(/\.manifest\.json$/, ".receipt.json"));
    if (existsSync(receiptPath)) {
      const receipt = loadJson(receiptPath);
      if (receipt.status !== proof.status) errors.push("/status differs from the sibling receipt");
      if (receipt.deployContentId !== proof.deployContentId) errors.push("/deployContentId differs from the sibling receipt");
      if (receipt.embeddedBrowserProofId !== proof.browserProofId) errors.push("/browserProofId differs from the sibling receipt");
      if (!samePlatformDecisions(receipt.platformDecisions, proof.platformDecisions)) errors.push("/platformDecisions differ from the sibling receipt");
    }
  }
  return errors;
}

export function validateArtifactFiles(inputPaths, { trustedKeyIds = [], requireAttestation = false } = {}) {
  if (!inputPaths.length) throw new Error("validate requires at least one JSON file or directory");
  const trustedKeys = new Set(trustedKeyIds);
  for (const keyId of trustedKeys) {
    if (!/^sha256:[a-f0-9]{64}$/.test(keyId)) throw new Error(`invalid trusted Ed25519 key ID: ${keyId}`);
  }
  const paths = collectPaths(inputPaths);
  if (!paths.length) throw new Error("no RealityCheck JSON artifacts were found");
  if (requireAttestation) {
    const discovered = new Set(paths);
    for (const path of paths.filter((item) => basename(item) === "evidence-manifest.json")) {
      const attestationPath = join(dirname(path), "evidence-attestation.json");
      if (existsSync(attestationPath) && statSync(attestationPath).isFile()) discovered.add(attestationPath);
    }
    paths.splice(0, paths.length, ...[...discovered].sort());
  }
  const validators = createValidator();
  const results = [];
  for (const path of paths) {
    const value = loadJson(path);
    let kind;
    try {
      kind = artifactKind(value, path);
    } catch (error) {
      results.push({ path, kind: "unknown", valid: false, errors: [error.message] });
      continue;
    }
    const validate = validators[kind];
    const schemaValid = validate(value);
    const errors = schemaValid ? [] : (validate.errors || []).map(displayError);
    if (schemaValid && kind === "evidence-manifest") errors.push(...verifyEvidenceManifest(path, value));
    if (schemaValid && kind === "evidence-attestation") errors.push(...verifyEvidenceAttestation(path, value));
    if (schemaValid && kind === "evidence-trust-report") errors.push(...verifyEvidenceTrustReport(value));
    if (schemaValid && kind === "risk-register") errors.push(...verifyRiskRegister(value));
    if (schemaValid && kind === "policy-review") errors.push(...verifyPolicyReview(value));
    if (schemaValid && kind === "github-issue-drafts") errors.push(...verifyIssueDrafts(value));
    if (schemaValid && kind === "release-decision") errors.push(...verifyReleaseDecision(value));
    if (schemaValid && kind === "audit-plan") errors.push(...verifyAuditPlan(value));
    if (schemaValid && kind === "html-note-check-bundle") errors.push(...verifyNoteBundle(value));
    if (schemaValid && kind === "html-note-check-comparison") errors.push(...verifyNoteComparison(value));
    if (schemaValid && kind === "html-note-publish-proof") errors.push(...verifyPublishProof(value), ...verifyPublishProofSiblings(value, path));
    if (schemaValid && kind === "html-note-publish-receipt") errors.push(...verifyPublishReceipt(value, path));
    if (schemaValid && kind === "html-note-publish-browser-proof") errors.push(...verifyPublishBrowserProof(value), ...verifyBrowserProofSiblings(value, path));
    if (schemaValid && kind === "html-note-publish-technical-report") errors.push(...verifyPublishTechnicalReport(value));
    if (schemaValid && kind === "evidence-attestation" && trustedKeys.size && !trustedKeys.has(value.signer.keyId)) {
      errors.push(`/signer/keyId is not in the trusted key allowlist: ${value.signer.keyId}`);
    }
    results.push({
      path,
      kind,
      valid: errors.length === 0,
      errors,
    });
  }
  if (requireAttestation) {
    for (const result of results.filter((item) => item.kind === "evidence-manifest")) {
      const attestationPath = join(dirname(result.path), "evidence-attestation.json");
      if (!existsSync(attestationPath)) {
        result.errors.push("/attestation required sibling evidence-attestation.json is missing");
        result.valid = false;
      }
    }
  }
  return results;
}

export function printValidationResults(results) {
  for (const result of results) {
    const label = result.valid ? "PASS" : "FAIL";
    const displayPath = relative(process.cwd(), result.path) || basename(result.path);
    console.log(`${label}  ${displayPath}  (${result.kind})`);
    for (const error of result.errors) console.log(`      ${error}`);
  }
  const failed = results.filter((result) => !result.valid).length;
  console.log(`\nValidated ${results.length} artifact(s): ${results.length - failed} passed, ${failed} failed.`);
  return failed ? 1 : 0;
}

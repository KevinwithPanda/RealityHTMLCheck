import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { verifyEvidenceManifest } from "./evidence-manifest.mjs";
import { verifyEvidenceAttestation } from "./evidence-attestation.mjs";

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
  "realitycheck.config.json",
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
  config: "config.schema.json",
};

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
      else if (entry.isFile() && ARTIFACT_FILES.has(entry.name)) found.push(child);
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
  const validators = {};
  for (const [kind, filename] of Object.entries(SCHEMA_BY_ARTIFACT)) {
    const schema = loadJson(join(ASSET_DIR, filename));
    validators[kind] = ajv.compile(schema);
  }
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

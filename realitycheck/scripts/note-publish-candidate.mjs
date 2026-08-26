import { createHash } from "node:crypto";

import { analyzeHtmlNote, applySafeNoteFixes } from "./note-analyzer.mjs";
import { analyzeNotePackage } from "./note-package.mjs";
import { buildPublishLayout, choosePublishEntry, inspectPassiveStaticEntries, PUBLISH_PROFILE } from "./note-publish-policy.mjs";
import { applySafeReferenceRepairs } from "./note-reference-graph.mjs";
import { summarizeNoteReports, summarizePackageFindings } from "./note-summary.mjs";

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();
const HTML = /\.html?$/i;
const CSS = /\.css$/i;
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const BLOCKING_WARNING_RULES = new Set([
  "missing-viewport",
  "remote-dependency",
  "css-remote-dependency",
  "package-content-not-verified",
]);
const PATH_REPAIR_UNSAFE_CODES = new Set([
  "active-script",
  "inline-event-handler",
  "active-url-scheme",
  "embedded-active-content",
  "form-submission",
  "base-url-rewrite",
]);

function normalizedMap(input) {
  const values = input instanceof Map ? [...input] : [...input].map((entry) => [entry.path, entry.bytes]);
  const output = new Map();
  for (const [path, bytes] of values.sort(([left], [right]) => compareText(left, right))) {
    if (typeof path !== "string" || !path || !(bytes instanceof Uint8Array)) throw new TypeError("publish candidate requires path/Uint8Array entries");
    if (output.has(path)) throw new Error(`Duplicate publish path: ${path}`);
    output.set(path, bytes);
  }
  return output;
}

function decodeText(path, bytes) {
  try {
    return decoder.decode(bytes);
  } catch (error) {
    throw new Error(`Publishable HTML/CSS must be valid UTF-8: ${path} (${error.message})`);
  }
}

function applyMetadataFixes(input) {
  const entries = new Map(input);
  const changes = [];
  for (const [path, bytes] of entries) {
    if (!HTML.test(path)) continue;
    const fixed = applySafeNoteFixes(decodeText(path, bytes));
    if (!fixed.changes.length) continue;
    entries.set(path, encoder.encode(fixed.html));
    for (const ruleId of fixed.changes) changes.push({ path, ruleId });
  }
  return { entries, changes };
}

function analyzeEntries(entries) {
  const knownFiles = [...entries.keys()].sort();
  const textEntries = [];
  for (const [path, bytes] of entries) {
    if (HTML.test(path)) textEntries.push({ path, kind: "html", text: decodeText(path, bytes) });
    else if (CSS.test(path)) textEntries.push({ path, kind: "css", text: decodeText(path, bytes) });
  }
  const reports = textEntries.filter((entry) => entry.kind === "html").map((entry) => analyzeHtmlNote({ path: entry.path, html: entry.text, knownFiles }));
  const packageFindings = analyzeNotePackage({ entries: textEntries, knownFiles });
  const packageSummary = summarizePackageFindings(packageFindings);
  const summary = summarizeNoteReports(reports, packageSummary);
  return { reports, packageFindings, packageSummary, summary };
}

function findingBlockers(analysis) {
  const blockers = [];
  for (const report of analysis.reports) {
    for (const finding of report.findings) {
      if (finding.level === "error" || BLOCKING_WARNING_RULES.has(finding.ruleId)) blockers.push({ code: `note-${finding.ruleId}`, path: report.path, affected: finding.affectedCount, level: finding.level });
    }
  }
  for (const finding of analysis.packageFindings) {
    if (finding.level === "error" || BLOCKING_WARNING_RULES.has(finding.ruleId)) blockers.push({ code: `note-${finding.ruleId}`, path: finding.evidence?.[0]?.path || null, affected: finding.affectedCount, level: finding.level });
  }
  return blockers;
}

function contentContract(entries) {
  const files = [...entries].sort(([left], [right]) => compareText(left, right)).map(([path, bytes]) => ({
    path,
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }));
  const contract = { contract: "realitycheck-publish-deploy-content-v1", entrypoint: "index.html", entries: files };
  const digest = createHash("sha256").update(JSON.stringify(contract)).digest("hex");
  return { deployContentId: `sha256:${digest}`, contract };
}

/** Prepare and fully re-analyze deterministic static publish bytes. */
export function preparePublishCandidate(input, { entry: requestedEntry = null } = {}) {
  const sourceEntries = normalizedMap(input);
  const initialPolicy = inspectPassiveStaticEntries(sourceEntries);
  const before = analyzeEntries(sourceEntries);
  const metadata = applyMetadataFixes(sourceEntries);
  const pathRepairAllowed = !initialPolicy.blockers.some((blocker) => PATH_REPAIR_UNSAFE_CODES.has(blocker.code));
  const pathRepair = pathRepairAllowed
    ? applySafeReferenceRepairs(metadata.entries)
    : { entries: metadata.entries, changes: [], graph: { references: [] } };
  const repairedEntries = pathRepair.entries;
  const selection = choosePublishEntry(repairedEntries.keys(), requestedEntry);
  const repairedPolicy = inspectPassiveStaticEntries(repairedEntries);
  const after = analyzeEntries(repairedEntries);
  const layout = buildPublishLayout(repairedEntries, selection.entry);
  const finalPolicy = {
    ...inspectPassiveStaticEntries(layout.entries),
    // Generated index.html may contain the one trusted gateway meta refresh;
    // policy blockers always come from the user-controlled repaired inventory.
    blockers: repairedPolicy.blockers,
  };
  const blockers = [
    ...repairedPolicy.blockers,
    ...findingBlockers(after),
  ];
  if (after.summary.counts.error > before.summary.counts.error || after.summary.counts.warning > before.summary.counts.warning) {
    blockers.push({ code: "repair-regression", before: before.summary.counts, after: after.summary.counts });
  }
  const identity = contentContract(layout.entries);
  return {
    schemaVersion: "1",
    kind: "realitycheck-publish-candidate",
    profile: PUBLISH_PROFILE,
    sourceEntries,
    entries: layout.entries,
    entry: selection.entry,
    selection,
    gatewayGenerated: layout.gatewayGenerated,
    launchPath: layout.launchPath,
    deployContentId: identity.deployContentId,
    contentContract: identity.contract,
    policy: finalPolicy,
    before,
    after,
    changes: { metadata: metadata.changes, references: pathRepair.changes, pathRepairSkippedForActiveContent: !pathRepairAllowed },
    blockers,
    warnings: after.summary.counts.warning,
    staticGatePassed: blockers.length === 0,
  };
}

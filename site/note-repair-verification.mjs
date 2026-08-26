const LEVEL_ORDER = Object.freeze({ error: 0, warning: 1, advice: 2 });

function requireFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
}

function dependencies(input) {
  const required = [
    "analyzeHtmlNote",
    "applySafeNoteFixes",
    "analyzeNotePackage",
    "summarizeNoteReports",
    "summarizePackageFindings",
    "normalizeNotePath",
  ];
  for (const name of required) requireFunction(input?.[name], name);
  return input;
}

/** Return exact portable-path collisions without retaining file contents. */
export function duplicateBrowserNotePaths(paths, normalizePath) {
  if (!Array.isArray(paths)) throw new TypeError("paths must be an array");
  requireFunction(normalizePath, "normalizePath");
  const seen = new Set();
  const duplicates = new Set();
  for (const value of paths) {
    const path = normalizePath(value);
    if (!path) throw new TypeError("note paths must be non-empty strings");
    if (seen.has(path)) duplicates.add(path);
    else seen.add(path);
  }
  return [...duplicates].sort((left, right) => left.localeCompare(right));
}

function findingEntries(bundle) {
  const entries = [];
  for (const report of bundle.reports || []) {
    for (const finding of report.findings || []) {
      entries.push({ key: `html:${report.path}:${finding.ruleId}`, scope: "html", path: report.path, finding });
    }
  }
  for (const finding of bundle.packageFindings || []) {
    entries.push({ key: `package:${finding.ruleId}`, scope: "package", path: null, finding });
  }
  return entries;
}

/** Run the exact deterministic browser-note pipeline over in-memory sources. */
export function analyzeBrowserNoteSources({ htmlSources, cssSources = [], knownFiles = null }, helpers) {
  const api = dependencies(helpers);
  if (!Array.isArray(htmlSources) || !htmlSources.length) throw new TypeError("htmlSources must contain at least one HTML source");
  if (!Array.isArray(cssSources)) throw new TypeError("cssSources must be an array");
  if (knownFiles !== null && !Array.isArray(knownFiles)) throw new TypeError("knownFiles must be an array or null");
  const normalizedHtmlSources = htmlSources.map((source) => ({ ...source, path: api.normalizeNotePath(source?.path) }));
  const normalizedCssSources = cssSources.map((source) => ({ ...source, path: api.normalizeNotePath(source?.path) }));
  const normalizedKnownFiles = knownFiles?.map((path) => api.normalizeNotePath(path)) ?? null;
  const sourceCollisions = duplicateBrowserNotePaths([...normalizedHtmlSources, ...normalizedCssSources].map((source) => source?.path), api.normalizeNotePath);
  if (sourceCollisions.length) throw new Error(`Duplicate note path cannot be analyzed safely: ${sourceCollisions[0]}`);
  if (normalizedKnownFiles) {
    const inventoryCollisions = duplicateBrowserNotePaths(normalizedKnownFiles, api.normalizeNotePath);
    if (inventoryCollisions.length) throw new Error(`Duplicate package path cannot be analyzed safely: ${inventoryCollisions[0]}`);
  }

  const reports = normalizedHtmlSources.map((source) => api.analyzeHtmlNote({ path: source.path, html: source.html, knownFiles: normalizedKnownFiles }));
  let packageFindings = [];
  if (normalizedKnownFiles) {
    packageFindings = api.analyzeNotePackage({
      entries: [
        ...normalizedHtmlSources.map((source) => ({ path: source.path, text: source.html, kind: "html" })),
        ...normalizedCssSources.map((source) => ({ path: source.path, text: source.text, kind: "css" })),
      ],
      knownFiles: normalizedKnownFiles,
    }).sort((left, right) => LEVEL_ORDER[left.level] - LEVEL_ORDER[right.level] || left.ruleId.localeCompare(right.ruleId));
  }
  reports.sort((left, right) => left.score - right.score || left.path.localeCompare(right.path));
  const packageSummary = api.summarizePackageFindings(packageFindings);
  return {
    reports,
    packageFindings,
    packageSummary,
    summary: api.summarizeNoteReports(reports, packageSummary),
  };
}

/**
 * Apply only analyzer-declared safe metadata fixes, then rerun the same full
 * in-memory browser pipeline. The original sources and bundle are untouched.
 */
export function verifySafeNoteRepair({ path, beforeBundle, analysis }, helpers) {
  const api = dependencies(helpers);
  if (!path || typeof path !== "string") throw new TypeError("path must be a non-empty string");
  if (!beforeBundle || !Array.isArray(beforeBundle.reports)) throw new TypeError("beforeBundle must be a browser note result");
  if (!analysis || !Array.isArray(analysis.htmlSources)) throw new TypeError("analysis sources are required for recheck");
  const canonicalPath = api.normalizeNotePath(path);
  const analysisPaths = analysis.htmlSources.map((item) => api.normalizeNotePath(item.path));
  const analysisCollisions = duplicateBrowserNotePaths(analysisPaths, api.normalizeNotePath);
  const reportCollisions = duplicateBrowserNotePaths(beforeBundle.reports.map((item) => item.path), api.normalizeNotePath);
  if (analysisCollisions.length || reportCollisions.length) throw new Error(`Cannot verify a repair with duplicate note scope: ${analysisCollisions[0] || reportCollisions[0]}`);
  const source = analysis.htmlSources.find((item) => api.normalizeNotePath(item.path) === canonicalPath);
  const beforeReport = beforeBundle.reports.find((item) => api.normalizeNotePath(item.path) === canonicalPath);
  if (!source || !beforeReport) throw new Error(`Cannot verify safe repair for unknown HTML source: ${canonicalPath}`);

  const repair = api.applySafeNoteFixes(source.html);
  if (!repair.changes.length || repair.html === source.html) throw new Error(`No safe metadata repair is available for ${path}`);
  const repairedSources = analysis.htmlSources.map((item) => api.normalizeNotePath(item.path) === canonicalPath ? { ...item, path: canonicalPath, html: repair.html } : { ...item, path: api.normalizeNotePath(item.path) });
  const afterBundle = analyzeBrowserNoteSources({
    htmlSources: repairedSources,
    cssSources: analysis.cssSources || [],
    knownFiles: analysis.knownFiles ?? null,
  }, api);
  const afterReport = afterBundle.reports.find((item) => item.path === canonicalPath);
  if (!afterReport) throw new Error(`The repaired source was not included in its own recheck: ${canonicalPath}`);
  const downloadReport = api.analyzeHtmlNote({ path: canonicalPath, html: repair.html, knownFiles: null });
  const downloadSummary = api.summarizeNoteReports([downloadReport]);
  const afterFileRules = new Set(afterReport.findings.map((finding) => finding.ruleId));
  const downloadOnlyFindings = downloadReport.findings
    .filter((finding) => !afterFileRules.has(finding.ruleId))
    .map((finding) => ({ key: `download:${canonicalPath}:${finding.ruleId}`, scope: "html", path: canonicalPath, finding }));

  const beforeEntries = new Map(findingEntries(beforeBundle).map((entry) => [entry.key, entry]));
  const afterEntries = new Map(findingEntries(afterBundle).map((entry) => [entry.key, entry]));
  const resolved = [...beforeEntries.values()].filter((entry) => !afterEntries.has(entry.key));
  const remaining = [...afterEntries.values()].filter((entry) => beforeEntries.has(entry.key)).map((entry) => ({
    ...entry,
    beforeAffectedCount: beforeEntries.get(entry.key).finding.affectedCount,
    afterAffectedCount: entry.finding.affectedCount,
  }));
  const introduced = [...afterEntries.values()].filter((entry) => !beforeEntries.has(entry.key));

  return {
    kind: "html-note-safe-repair-verification",
    path: canonicalPath,
    changes: [...repair.changes],
    repairedHtml: repair.html,
    before: { summary: beforeBundle.summary, report: beforeReport },
    after: { ...afterBundle, report: afterReport },
    download: {
      context: "single-html-without-folder-assets",
      packageAssetsIncluded: false,
      report: downloadReport,
      summary: downloadSummary,
      onlyFindings: downloadOnlyFindings,
    },
    findings: { resolved, remaining, introduced },
    originalModified: false,
  };
}

function shortPathHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Build a collision-resistant browser download name while preserving the original relative-path hint. */
export function safeRepairDownloadName(path) {
  const portable = String(path ?? "").replaceAll("\\", "/");
  const segments = portable.split("/").filter((segment) => segment && segment !== "." && segment !== "..");
  if (!segments.length) throw new TypeError("path must identify an HTML file");
  const final = segments.pop().replace(/\.html?$/i, "");
  const clean = [...segments, final].join("--").replace(/[<>:"|?*\u0000-\u001f\u007f]/g, "_");
  if (!segments.length) return `${clean}.repaired.html`;
  return `${clean.slice(-140)}.${shortPathHash(portable)}.repaired.html`;
}

/** Build the only payload used by the repaired-copy download button. */
export function safeRepairDownloadPayload(verification, name) {
  if (verification?.kind !== "html-note-safe-repair-verification" || typeof verification.repairedHtml !== "string") {
    throw new TypeError("a completed safe-repair verification is required");
  }
  if (!name || typeof name !== "string") throw new TypeError("download name must be a non-empty string");
  return { name, content: verification.repairedHtml, type: "text/html;charset=utf-8" };
}

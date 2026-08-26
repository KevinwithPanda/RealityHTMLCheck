import { DEFAULT_ZIP_LIMITS, digestZipSource, preflightStoredZip, verifyStoredZip, writeStoredZipWithManifest } from "./note-zip.mjs?v=0.10.0";
import { isSensitiveNoteArchivePath } from "./note-path-policy.mjs?v=0.10.0";

const encoder = new TextEncoder();
const EVIDENCE_RESERVE_BYTES = 12 * 1024 * 1024;
const ANALYZED_CSS_FILE_BYTES = 5 * 1024 * 1024;
const MAX_SELECTED_PATH_BYTES = 1024;
const MAX_AGGREGATE_PATH_BYTES = 512 * 1024;
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

export const FOLDER_REPAIR_LIMITS = Object.freeze({
  maxSelectedFiles: DEFAULT_ZIP_LIMITS.maxFiles - 2,
  maxFileBytes: DEFAULT_ZIP_LIMITS.maxFileBytes,
  maxSelectedBytes: DEFAULT_ZIP_LIMITS.maxTotalBytes - EVIDENCE_RESERVE_BYTES,
  maxArchiveBytes: DEFAULT_ZIP_LIMITS.maxArchiveBytes,
});

function sourceShape(file) {
  return file && typeof file === "object" && Number.isSafeInteger(file.size) && file.size >= 0 && typeof file.arrayBuffer === "function";
}

function archiveContentPath(inventory, item) {
  return `${inventory.repairedRootName}/${inventory.rootName}/${item.relativePath}`;
}

/** Inspect only path and declared-size metadata; no selected file bytes are read. */
export async function prepareFolderRepairInventory(fileEntries, { normalizeNotePath, sourceArchive = null } = {}) {
  if (!Array.isArray(fileEntries) || !fileEntries.length) throw new TypeError("folder repair requires selected files");
  if (typeof normalizeNotePath !== "function") throw new TypeError("normalizeNotePath helper is required");
  const blockers = [];
  const files = [];
  let rootName = null;
  let totalBytes = 0;
  let aggregatePathBytes = 0;
  for (const entry of fileEntries) {
    const rawPath = String(entry?.path ?? "");
    const path = normalizeNotePath(rawPath);
    if (!path || rawPath.includes("\\") || path !== rawPath) {
      blockers.push({ code: "unsafe-path", path: rawPath || "(empty)" });
      continue;
    }
    const segments = path.split("/");
    if (segments.length < 2) {
      blockers.push({ code: "missing-folder-root", path });
      continue;
    }
    if (rootName === null) rootName = segments[0];
    else if (segments[0] !== rootName) blockers.push({ code: "multiple-folder-roots", path });
    if (!sourceShape(entry.file)) {
      blockers.push({ code: "unreadable-file", path });
      continue;
    }
    if (typeof entry.file.name === "string" && entry.file.name !== segments.at(-1)) blockers.push({ code: "file-name-mismatch", path });
    const pathBytes = encoder.encode(path).byteLength;
    if (pathBytes > MAX_SELECTED_PATH_BYTES) blockers.push({ code: "path-too-long", path, actual: pathBytes, limit: MAX_SELECTED_PATH_BYTES });
    aggregatePathBytes += pathBytes;
    if (isSensitiveNoteArchivePath(path)) blockers.push({ code: "sensitive-path", path });
    if (entry.file.size > FOLDER_REPAIR_LIMITS.maxFileBytes) blockers.push({ code: "file-too-large", path, actual: entry.file.size, limit: FOLDER_REPAIR_LIMITS.maxFileBytes });
    totalBytes += entry.file.size;
    files.push({ sourcePath: path, relativePath: segments.slice(1).join("/"), file: entry.file, size: entry.file.size });
  }
  if (files.length > FOLDER_REPAIR_LIMITS.maxSelectedFiles) blockers.push({ code: "too-many-files", actual: files.length, limit: FOLDER_REPAIR_LIMITS.maxSelectedFiles });
  if (totalBytes > FOLDER_REPAIR_LIMITS.maxSelectedBytes) blockers.push({ code: "folder-too-large", actual: totalBytes, limit: FOLDER_REPAIR_LIMITS.maxSelectedBytes });
  if (aggregatePathBytes > MAX_AGGREGATE_PATH_BYTES) blockers.push({ code: "paths-too-large", actual: aggregatePathBytes, limit: MAX_AGGREGATE_PATH_BYTES });
  const repairedRootName = rootName ? `${rootName}.realitycheck-safe-metadata` : null;
  files.sort((left, right) => compareText(left.sourcePath, right.sourcePath));
  let preparedSourceArchive = null;
  if (sourceArchive !== null) {
    const manifest = sourceArchive?.manifest;
    const source = sourceArchive?.source;
    const declaredEntries = Array.isArray(manifest?.entries) ? manifest.entries : [];
    const declaredPaths = declaredEntries.map((entry) => entry.path).sort(compareText);
    const selectedPaths = files.map((entry) => entry.sourcePath);
    const sizes = new Map(files.map((entry) => [entry.sourcePath, entry.size]));
    const valid = sourceArchive?.kind === "html-note-zip-import"
      && sourceArchive?.schemaVersion === "1"
      && sourceShape(source)
      && typeof manifest?.archiveName === "string"
      && manifest.archiveBytes === source.size
      && /^[a-f0-9]{64}$/.test(manifest.archiveSha256 || "")
      && /^sha256:[a-f0-9]{64}$/.test(manifest.importContentId || "")
      && manifest.centralDirectoryEntriesOnly === true
      && Number.isSafeInteger(manifest.ignoredDirectories) && manifest.ignoredDirectories >= 0
      && typeof manifest.rootWrapped === "boolean"
      && Array.isArray(manifest.methods) && manifest.methods.length > 0 && manifest.methods.every((method) => ["store", "deflate"].includes(method))
      && manifest.importedFiles === files.length
      && manifest.totalUncompressedBytes === totalBytes
      && manifest.rootName === rootName
      && JSON.stringify(declaredPaths) === JSON.stringify(selectedPaths)
      && declaredEntries.every((entry) => sizes.get(entry.path) === entry.bytes && /^[a-f0-9]{64}$/.test(entry.sha256 || "") && /^[a-f0-9]{8}$/.test(entry.crc32Hex || ""));
    let contentIdMatches = false;
    if (valid) {
      const contract = {
        contract: "realitycheck-import-content-v1",
        entries: [...declaredEntries].sort((left, right) => compareText(left.path, right.path)).map((entry) => ({ path: entry.path, bytes: entry.bytes, crc32Hex: entry.crc32Hex, sha256: entry.sha256 })),
      };
      const digest = await digestZipSource({ bytes: encoder.encode(JSON.stringify(contract)) });
      contentIdMatches = manifest.importContentId === `sha256:${digest.sha256}`;
    }
    if (!valid || !contentIdMatches) blockers.push({ code: "source-archive-invalid", path: String(manifest?.archiveName || "(ZIP)") });
    else preparedSourceArchive = {
      file: source,
      expectedEntries: declaredEntries.map((entry) => ({ path: entry.path, bytes: entry.bytes, crc32Hex: entry.crc32Hex, sha256: entry.sha256 })),
      evidence: {
        kind: sourceArchive.kind,
        archiveName: manifest.archiveName,
        archiveBytes: manifest.archiveBytes,
        archiveSha256: manifest.archiveSha256,
        importContentId: manifest.importContentId,
        centralDirectoryEntriesOnly: manifest.centralDirectoryEntriesOnly === true,
        importedFiles: manifest.importedFiles,
        ignoredDirectories: manifest.ignoredDirectories,
        totalUncompressedBytes: manifest.totalUncompressedBytes,
        rootName: manifest.rootName,
        rootWrapped: manifest.rootWrapped === true,
        methods: [...manifest.methods],
      },
    };
  }
  if (repairedRootName && !blockers.length) {
    try {
      preflightStoredZip(files.map((item) => ({ path: `${repairedRootName}/${rootName}/${item.relativePath}`, file: item.file })), {
        limits: {
          maxFiles: FOLDER_REPAIR_LIMITS.maxSelectedFiles,
          maxFileBytes: FOLDER_REPAIR_LIMITS.maxFileBytes,
          maxTotalBytes: FOLDER_REPAIR_LIMITS.maxSelectedBytes,
          maxArchiveBytes: FOLDER_REPAIR_LIMITS.maxArchiveBytes,
        },
      });
    } catch (error) {
      blockers.push({ code: "zip-path-or-layout", detail: String(error.message || error) });
    }
  }
  return {
    eligible: blockers.length === 0,
    blockers,
    rootName,
    repairedRootName,
    files,
    selectedFiles: files.length,
    selectedBytes: totalBytes,
    htmlFiles: files.filter((item) => /\.html?$/i.test(item.sourcePath)).length,
    sourceArchive: preparedSourceArchive,
    limits: { ...FOLDER_REPAIR_LIMITS },
  };
}

function findingKeys(items) {
  return items.map((entry) => entry.key).sort(compareText);
}

async function candidateContract(verification, signal) {
  const findingContract = (items) => items.map((entry) => ({
    key: entry.key,
    level: entry.finding.level,
    affectedCount: entry.finding.affectedCount,
    beforeAffectedCount: entry.beforeAffectedCount ?? null,
    afterAffectedCount: entry.afterAffectedCount ?? null,
  })).sort((left, right) => compareText(left.key, right.key));
  if (!(verification.candidateHtmlByPath instanceof Map) || !(verification.candidateCssByPath instanceof Map)) throw new TypeError("The cumulative HTML/CSS candidate is required");
  const candidateHtml = [];
  for (const [path, html] of [...verification.candidateHtmlByPath.entries()].sort((left, right) => compareText(left[0], right[0]))) {
    if (typeof path !== "string" || typeof html !== "string") throw new TypeError("The cumulative HTML candidate contains invalid source data");
    const digest = await digestZipSource({ bytes: encoder.encode(html) }, { signal });
    candidateHtml.push({ path, bytes: digest.size, sha256: digest.sha256 });
  }
  const candidateCss = [];
  for (const [path, text] of [...verification.candidateCssByPath.entries()].sort((left, right) => compareText(left[0], right[0]))) {
    if (typeof path !== "string" || (text !== null && typeof text !== "string")) throw new TypeError("The cumulative CSS candidate contains invalid source data");
    if (text === null) candidateCss.push({ path, analyzed: false });
    else {
      const digest = await digestZipSource({ bytes: encoder.encode(text) }, { signal });
      candidateCss.push({ path, analyzed: true, bytes: digest.size, sha256: digest.sha256 });
    }
  }
  return JSON.stringify({
    contract: "realitycheck-safe-folder-candidate-v2",
    kind: verification.kind,
    scope: {
      htmlPaths: [...(verification.scope?.htmlPaths || [])].sort(compareText),
      knownFiles: [...(verification.scope?.knownFiles || [])].sort(compareText),
    },
    changes: verification.changes,
    totalChanges: verification.totalChanges,
    beforeSummary: verification.before.summary,
    afterSummary: verification.after.summary,
    candidateHtml,
    candidateCss,
    sourceArchive: verification.sourceArchive || null,
    findings: {
      resolved: findingContract(verification.findings.resolved),
      remaining: findingContract(verification.findings.remaining),
      introduced: findingContract(verification.findings.introduced),
      worsened: findingContract(verification.findings.worsened),
    },
  });
}

async function candidateIdFor(verification, signal) {
  const contract = await candidateContract(verification, signal);
  const digest = await digestZipSource({ bytes: encoder.encode(contract) }, { signal });
  return `sha256:${digest.sha256}`;
}

/** Bind one cumulative verification to its exact scope, changes, after summary, and finding evidence. */
export async function bindSafeFolderCandidate(verification, { signal } = {}) {
  if (verification?.kind !== "html-note-safe-package-repair-verification") throw new TypeError("A cumulative package verification is required");
  return { ...verification, candidateId: await candidateIdFor(verification, signal) };
}

function proofFor(inventory, verification, generatedAt, entryEvidence, inventorySha256, sourceArchive) {
  return {
    schemaVersion: "1",
    kind: "html-note-safe-folder-archive-proof",
    candidateId: verification.candidateId,
    generatedAt,
    bundlePolicy: "all-browser-selected-files",
    sourceModified: false,
    privacy: { uploaded: false, sourceHtmlRetainedInProof: false },
    sourceArchive,
    selection: {
      originalRootName: inventory.rootName,
      repairedRootName: inventory.repairedRootName,
      files: inventory.selectedFiles,
      htmlFiles: inventory.htmlFiles,
      bytes: inventory.selectedBytes,
      inventorySha256,
      inventory: entryEvidence,
    },
    repair: {
      changedHtmlFiles: verification.changes.length,
      unchangedHtmlFiles: inventory.htmlFiles - verification.changes.length,
      totalMetadataChanges: verification.totalChanges,
      changes: verification.changes,
      beforeScore: verification.before.summary.score,
      afterScore: verification.after.summary.score,
      resolved: findingKeys(verification.findings.resolved),
      remaining: findingKeys(verification.findings.remaining),
      introduced: findingKeys(verification.findings.introduced),
      worsened: findingKeys(verification.findings.worsened),
    },
    archiveBoundary: {
      selectedInventoryIncluded: true,
      readBackVerifiedBeforeDownload: true,
      evidenceEntriesAdded: 2,
      remoteResourcesBundled: false,
      missingReferencedFilesRestored: false,
      emptyDirectoriesPreserved: false,
      symbolicLinksPreserved: false,
    },
  };
}

/** Build and re-read one complete safe-metadata folder ZIP from the cumulative HTML candidate that was verified. */
export async function buildVerifiedFolderRepairZip({ inventory, verification, reportHtml, generatedAt, signal } = {}) {
  if (!inventory?.eligible || !Array.isArray(inventory.files) || !inventory.repairedRootName) throw new Error("A safe eligible folder inventory is required");
  if (verification?.kind !== "html-note-safe-package-repair-verification" || !(verification.repairedHtmlByPath instanceof Map) || !(verification.candidateHtmlByPath instanceof Map) || !(verification.sourceHtmlByPath instanceof Map) || !(verification.candidateCssByPath instanceof Map)) {
    throw new Error("A completed cumulative package repair verification is required");
  }
  const expectedCandidateId = await candidateIdFor(verification, signal);
  if (verification.candidateId !== expectedCandidateId) throw new Error("The cumulative folder candidate ID is missing or invalid");
  if (verification.findings.introduced.length || verification.findings.worsened.length) throw new Error("A folder ZIP cannot be built after introduced or worsened findings");
  if (typeof reportHtml !== "string" || !reportHtml.startsWith("<!doctype html>")) throw new TypeError("A self-contained after report is required");
  for (const marker of [
    '<meta name="realitycheck-report-context" content="folder-candidate">',
    `<meta name="realitycheck-summary-score" content="${verification.after.summary.score}">`,
    `<meta name="realitycheck-folder-change-count" content="${verification.changes.length}">`,
    `<meta name="realitycheck-folder-candidate-id" content="${verification.candidateId}">`,
    "CUMULATIVE FOLDER PROOF",
  ]) if (!reportHtml.includes(marker)) throw new Error("The after report is not bound to this cumulative folder candidate");
  if (verification.sourceArchive) {
    for (const marker of [
      `<meta name="realitycheck-source-archive-sha256" content="${verification.sourceArchive.archiveSha256}">`,
      `<meta name="realitycheck-import-content-id" content="${verification.sourceArchive.importContentId}">`,
    ]) if (!reportHtml.includes(marker)) throw new Error("The after report is not bound to the imported source ZIP");
  }
  if (typeof generatedAt !== "string" || Number.isNaN(new Date(generatedAt).getTime())) throw new TypeError("A valid generatedAt timestamp is required");
  const selected = new Set(inventory.files.map((item) => item.sourcePath));
  const selectedPaths = [...selected].sort(compareText);
  if (JSON.stringify(selectedPaths) !== JSON.stringify(verification.scope?.knownFiles || [])) {
    throw new Error("The verified package scope differs from the browser-selected file inventory");
  }
  const changedPaths = verification.changes.map((change) => change.path).sort(compareText);
  const repairedPaths = [...verification.repairedHtmlByPath.keys()].sort(compareText);
  if (JSON.stringify(changedPaths) !== JSON.stringify(repairedPaths)) throw new Error("The repaired HTML set differs from the declared folder changes");
  for (const path of repairedPaths) if (!selected.has(path)) throw new Error(`Repaired HTML is outside the selected inventory: ${path}`);
  if (JSON.stringify([...verification.candidateHtmlByPath.keys()].sort(compareText)) !== JSON.stringify(verification.scope.htmlPaths)) {
    throw new Error("The cumulative HTML candidate differs from its verified HTML scope");
  }
  if (JSON.stringify([...verification.sourceHtmlByPath.keys()].sort(compareText)) !== JSON.stringify(verification.scope.htmlPaths)) {
    throw new Error("The original HTML analysis differs from its verified HTML scope");
  }
  const selectedCssPaths = inventory.files.filter((item) => /\.css$/i.test(item.sourcePath)).map((item) => item.sourcePath).sort(compareText);
  if (JSON.stringify([...verification.candidateCssByPath.keys()].sort(compareText)) !== JSON.stringify(selectedCssPaths)) {
    throw new Error("The cumulative CSS candidate differs from the browser-selected CSS scope");
  }
  for (const change of verification.changes) {
    if (verification.candidateHtmlByPath.get(change.path) !== verification.repairedHtmlByPath.get(change.path)) {
      throw new Error(`The repaired HTML differs from the cumulative candidate: ${change.path}`);
    }
  }
  for (const item of inventory.files) {
    if (/\.html?$/i.test(item.sourcePath)) {
      if (typeof item.file.text !== "function") throw new Error(`Selected HTML cannot be re-read before archive build: ${item.sourcePath}`);
      const selectedText = await item.file.text();
      if (signal?.aborted) throw new DOMException("Folder archive build was aborted", "AbortError");
      const originalText = verification.sourceHtmlByPath.get(item.sourcePath);
      if (selectedText !== originalText) throw new Error(`Selected HTML changed after the original analysis: ${item.sourcePath}`);
      const expectedCandidate = verification.repairedHtmlByPath.get(item.sourcePath) ?? originalText;
      if (verification.candidateHtmlByPath.get(item.sourcePath) !== expectedCandidate) {
        throw new Error(`The cumulative HTML candidate differs from the selected source and declared repair: ${item.sourcePath}`);
      }
    } else if (/\.css$/i.test(item.sourcePath)) {
      const analyzedText = verification.candidateCssByPath.get(item.sourcePath);
      if (analyzedText === null) {
        if (item.size <= ANALYZED_CSS_FILE_BYTES) throw new Error(`Selected CSS was unexpectedly omitted from analysis: ${item.sourcePath}`);
      } else {
        if (item.size > ANALYZED_CSS_FILE_BYTES || typeof item.file.text !== "function") throw new Error(`Selected CSS analysis boundary is invalid: ${item.sourcePath}`);
        const selectedText = await item.file.text();
        if (signal?.aborted) throw new DOMException("Folder archive build was aborted", "AbortError");
        if (selectedText !== analyzedText) throw new Error(`Selected CSS changed after the cumulative analysis: ${item.sourcePath}`);
      }
    }
  }

  let sourceArchiveEvidence = null;
  if (inventory.sourceArchive) {
    const digest = await digestZipSource({ file: inventory.sourceArchive.file }, { signal });
    if (digest.size !== inventory.sourceArchive.evidence.archiveBytes || digest.sha256 !== inventory.sourceArchive.evidence.archiveSha256) {
      throw new Error("The imported source ZIP changed after local extraction");
    }
    sourceArchiveEvidence = { ...inventory.sourceArchive.evidence, readBackSha256Verified: true };
  }
  const candidateSourceArchive = sourceArchiveEvidence ? {
    archiveSha256: sourceArchiveEvidence.archiveSha256,
    importContentId: sourceArchiveEvidence.importContentId,
  } : null;
  if (JSON.stringify(verification.sourceArchive || null) !== JSON.stringify(candidateSourceArchive)) {
    throw new Error("The cumulative candidate is not bound to the imported source ZIP");
  }

  const proofPath = `${inventory.repairedRootName}/.realitycheck/repair-proof.json`;
  const reportPath = `${inventory.repairedRootName}/.realitycheck/after-report.html`;
  const entries = [];
  const entryEvidence = [];
  const changesByPath = new Map(verification.changes.map((item) => [item.path, item.rules]));
  const importedExpectedByPath = inventory.sourceArchive ? new Map(inventory.sourceArchive.expectedEntries.map((entry) => [entry.path, entry])) : null;
  for (const item of inventory.files) {
    const path = archiveContentPath(inventory, item);
    const repaired = verification.repairedHtmlByPath.get(item.sourcePath);
    const packedEntry = repaired === undefined ? { path, file: item.file } : { path, bytes: encoder.encode(repaired) };
    const sourceDigest = await digestZipSource({ file: item.file }, { signal });
    const importedExpected = importedExpectedByPath?.get(item.sourcePath) || null;
    if (inventory.sourceArchive && (!importedExpected || importedExpected.bytes !== sourceDigest.size || importedExpected.crc32Hex !== sourceDigest.crc32Hex || importedExpected.sha256 !== sourceDigest.sha256)) {
      throw new Error(`Imported file bytes differ from the source ZIP content proof: ${item.sourcePath}`);
    }
    const packedDigest = repaired === undefined ? sourceDigest : await digestZipSource({ bytes: packedEntry.bytes }, { signal });
    entryEvidence.push({
      sourcePath: item.sourcePath,
      archivePath: path,
      sourceBytes: sourceDigest.size,
      sourceSha256: sourceDigest.sha256,
      sourceCrc32: sourceDigest.crc32,
      sourceCrc32Hex: sourceDigest.crc32Hex,
      packedBytes: packedDigest.size,
      packedSha256: packedDigest.sha256,
      packedCrc32: packedDigest.crc32Hex,
      transformation: repaired === undefined ? "byte-for-byte" : "safe-metadata-utf8",
      rules: changesByPath.get(item.sourcePath) || [],
    });
    entries.push(packedEntry);
  }
  if (inventory.sourceArchive) {
    const importContract = {
      contract: "realitycheck-import-content-v1",
      entries: entryEvidence.map((entry) => ({ path: entry.sourcePath, bytes: entry.sourceBytes, crc32Hex: entry.sourceCrc32Hex, sha256: entry.sourceSha256 })),
    };
    const digest = await digestZipSource({ bytes: encoder.encode(JSON.stringify(importContract)) }, { signal });
    if (`sha256:${digest.sha256}` !== inventory.sourceArchive.evidence.importContentId) throw new Error("Imported content ID differs from the files being packed");
  }
  const inventoryDigest = await digestZipSource({ bytes: encoder.encode(JSON.stringify(entryEvidence)) }, { signal });
  const proof = proofFor(inventory, verification, generatedAt, entryEvidence, inventoryDigest.sha256, sourceArchiveEvidence);
  entries.push(
    { path: proofPath, bytes: encoder.encode(`${JSON.stringify(proof, null, 2)}\n`) },
    { path: reportPath, bytes: encoder.encode(reportHtml) },
  );
  const result = await writeStoredZipWithManifest(entries, {
    output: "uint8array",
    signal,
    limits: {
      maxFiles: DEFAULT_ZIP_LIMITS.maxFiles,
      maxFileBytes: DEFAULT_ZIP_LIMITS.maxFileBytes,
      maxTotalBytes: DEFAULT_ZIP_LIMITS.maxTotalBytes,
      maxArchiveBytes: DEFAULT_ZIP_LIMITS.maxArchiveBytes,
    },
  });
  const verifiedManifest = await verifyStoredZip(result.archive, result.manifest, { signal });
  const selectedArchivePaths = new Set(inventory.files.map((item) => archiveContentPath(inventory, item)));
  const contentEntries = verifiedManifest.entries.filter((entry) => entry.path !== proofPath && entry.path !== reportPath);
  if (contentEntries.length !== selectedArchivePaths.size || contentEntries.some((entry) => !selectedArchivePaths.has(entry.path))) {
    throw new Error("Verified ZIP inventory differs from the browser-selected files");
  }
  const expectedEvidence = new Map(entryEvidence.map((entry) => [entry.archivePath, entry]));
  for (const entry of contentEntries) {
    const expectedEntry = expectedEvidence.get(entry.path);
    if (!expectedEntry || entry.size !== expectedEntry.packedBytes || entry.sha256 !== expectedEntry.packedSha256 || entry.crc32Hex !== expectedEntry.packedCrc32) {
      throw new Error(`Verified ZIP bytes differ from the repair proof: ${entry.path}`);
    }
  }
  return {
    kind: "html-note-safe-folder-zip",
    filename: `${inventory.repairedRootName}.zip`,
    blob: new Blob([result.archive], { type: "application/zip" }),
    manifest: verifiedManifest,
    proof,
    proofPath,
    reportPath,
    selectedInventoryIncluded: true,
    remoteResourcesBundled: false,
    missingReferencedFilesRestored: false,
    sourceArchiveVerified: Boolean(sourceArchiveEvidence),
  };
}

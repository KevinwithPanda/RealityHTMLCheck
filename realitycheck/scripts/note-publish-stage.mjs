import { createHash, randomBytes } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { validateArtifactFiles } from "./artifact-validator.mjs";
import { readStoredZipEntries } from "./note-zip.mjs";

const READY_STATUSES = new Set(["ready", "warnings"]);
const CONTROL = /[\u0000-\u001f\u007f]/u;
const MAX_RUN_ENTRIES = 5_000;
const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;

function portable(value) {
  return value.split(sep).join("/");
}

function samePath(left, right) {
  const normalized = (value) => process.platform === "win32" ? resolve(value).toLowerCase() : resolve(value);
  return normalized(left) === normalized(right);
}

function contained(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function lstatIfPresent(path) {
  try { return lstatSync(path); }
  catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function existingNoLinks(label, value, kind) {
  if (typeof value !== "string" || !value || CONTROL.test(value)) throw new Error(`${label} must be a non-empty path without control characters`);
  const absolute = resolve(value);
  const stats = lstatIfPresent(absolute);
  if (!stats) throw new Error(`${label} does not exist: ${absolute}`);
  if (stats.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${absolute}`);
  if (kind === "file" && !stats.isFile()) throw new Error(`${label} must be a regular file: ${absolute}`);
  if (kind === "directory" && !stats.isDirectory()) throw new Error(`${label} must be a directory: ${absolute}`);
  const canonical = realpathSync(absolute);
  if (!samePath(absolute, canonical)) throw new Error(`${label} must not traverse a symbolic-link ancestor: ${absolute}`);
  return { absolute, canonical, stats };
}

function assertRegularTree(root, label) {
  let count = 0;
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      count += 1;
      if (count > MAX_RUN_ENTRIES) throw new Error(`${label} exceeds the ${MAX_RUN_ENTRIES}-entry boundary`);
      if (!entry.name || CONTROL.test(entry.name)) throw new Error(`${label} contains a control character in an entry name`);
      const path = join(directory, entry.name);
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) throw new Error(`${label} contains a symbolic link: ${path}`);
      if (stats.isDirectory()) visit(path);
      else if (!stats.isFile()) throw new Error(`${label} contains a non-regular entry: ${path}`);
    }
  };
  visit(root);
}

function readJsonFile(label, path, limit = MAX_RECEIPT_BYTES) {
  const file = existingNoLinks(label, path, "file");
  if (file.stats.size < 2 || file.stats.size > limit) throw new Error(`${label} is outside the ${limit}-byte boundary`);
  try { return JSON.parse(readFileSync(file.canonical, "utf8")); }
  catch (error) { throw new Error(`${label} is not valid JSON (${error.message})`); }
}

function requireValidArtifact(results, path, kind) {
  const result = results.find((item) => samePath(item.path, path));
  if (!result) throw new Error(`${kind} was not discovered in the publish evidence: ${path}`);
  if (result.kind !== kind) throw new Error(`${path} has kind ${result.kind}; expected ${kind}`);
  if (!result.valid) throw new Error(`${path} failed validation: ${result.errors.join("; ")}`);
  return result;
}

function resolveSource(input) {
  if (typeof input === "string") return { runDirectory: input, receiptPath: null, archivePath: null };
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("publish source must be a run directory or { receiptPath, archivePath }");
  const keys = Object.keys(input).sort();
  if (keys.length === 1 && keys[0] === "runDirectory") return { runDirectory: input.runDirectory, receiptPath: null, archivePath: null };
  if (keys.length === 2 && keys[0] === "archivePath" && keys[1] === "receiptPath") {
    return { runDirectory: dirname(resolve(input.receiptPath)), receiptPath: input.receiptPath, archivePath: input.archivePath };
  }
  throw new TypeError("publish source must contain only runDirectory or the receiptPath/archivePath pair");
}

function sourceEvidence(input) {
  const source = resolveSource(input);
  const run = existingNoLinks("publish run directory", source.runDirectory, "directory");
  assertRegularTree(run.canonical, "publish run directory");
  const results = validateArtifactFiles([run.canonical]);
  if (!results.length) throw new Error("publish run directory contains no recognized RealityCheck evidence");
  const invalid = results.filter((item) => !item.valid);
  if (invalid.length) throw new Error(`publish evidence failed validation: ${invalid.map((item) => `${item.path}: ${item.errors.join("; ")}`).join(" | ")}`);

  const receiptResults = results.filter((item) => item.kind === "html-note-publish-receipt");
  if (receiptResults.length !== 1) throw new Error(`publish run must contain exactly one receipt; found ${receiptResults.length}`);
  const manifestResults = results.filter((item) => item.kind === "html-note-publish-proof");
  if (manifestResults.length !== 1) throw new Error(`publish run must contain exactly one public manifest; found ${manifestResults.length}`);
  const receiptPath = existingNoLinks("publish receipt", source.receiptPath || receiptResults[0].path, "file");
  if (!samePath(receiptPath.canonical, receiptResults[0].path)) throw new Error("explicit receiptPath differs from the validated publish receipt");
  const receipt = readJsonFile("publish receipt", receiptPath.canonical);
  if (!READY_STATUSES.has(receipt.status) || receipt.publishReady !== true) throw new Error("publish run is a working copy, not a publish-ready capsule");
  if (!receipt.finalArchiveBrowserProofPassed || !receipt.finalArchiveBrowserProofId) throw new Error("publish-ready capsule is missing its passed final-archive browser proof");

  const archiveCandidate = source.archivePath || join(run.canonical, receipt.archive.filename);
  const archive = existingNoLinks("publish archive", archiveCandidate, "file");
  if (!samePath(dirname(archive.canonical), run.canonical)) throw new Error("publish archive must stay directly inside the validated run directory");
  if (basename(archive.canonical) !== receipt.archive.filename) throw new Error("publish archive filename differs from the validated receipt");
  const finalProofPath = join(run.canonical, "browser-final-archive", "browser-proof.json");
  const finalProof = existingNoLinks("final-archive browser proof", finalProofPath, "file");
  requireValidArtifact(results, receiptPath.canonical, "html-note-publish-receipt");
  requireValidArtifact(results, manifestResults[0].path, "html-note-publish-proof");
  requireValidArtifact(results, finalProof.canonical, "html-note-publish-browser-proof");
  const publicManifestPath = existingNoLinks("public publish manifest", manifestResults[0].path, "file");
  const publicManifest = readJsonFile("public publish manifest", publicManifestPath.canonical);
  const finalBrowserProof = readJsonFile("final-archive browser proof", finalProof.canonical);
  return { run, results, receiptPath, receipt, archive, finalProof, finalBrowserProof, publicManifestPath, publicManifest };
}

function prepareDestination(value, runDirectory) {
  if (typeof value !== "string" || !value || CONTROL.test(value)) throw new Error("stage destination must be a non-empty path without control characters");
  const absolute = resolve(value);
  if (lstatIfPresent(absolute)) throw new Error(`stage destination already exists: ${absolute}`);
  const parent = existingNoLinks("stage destination parent", dirname(absolute), "directory");
  const prospective = join(parent.canonical, basename(absolute));
  if (contained(runDirectory, prospective) || contained(prospective, runDirectory)) {
    throw new Error("stage destination must be separate from the publish evidence run");
  }
  return { absolute, canonical: prospective, parent: parent.canonical };
}

function normalizeZipEntries(readBack) {
  const entries = [];
  const exact = new Set();
  const normalized = new Map();
  const folded = new Map();
  for (const manifestEntry of readBack.manifest.entries) {
    const path = manifestEntry.path;
    if (!path || path.startsWith("/") || path.includes("\\") || CONTROL.test(path)) throw new Error(`verified ZIP contains an unsafe path: ${path}`);
    const parts = path.split("/");
    if (parts.some((part) => !part || part === "." || part === "..")) throw new Error(`verified ZIP contains an unsafe path segment: ${path}`);
    if (exact.has(path)) throw new Error(`verified ZIP contains a duplicate path: ${path}`);
    exact.add(path);
    const nfc = path.normalize("NFC");
    if (normalized.has(nfc)) throw new Error(`verified ZIP contains a Unicode-normalized path collision: ${path}`);
    normalized.set(nfc, path);
    const key = nfc.toLowerCase();
    if (folded.has(key)) throw new Error(`verified ZIP contains a case-folded path collision: ${path}`);
    folded.set(key, path);
    const bytes = readBack.entries.get(path);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== manifestEntry.size) throw new Error(`verified ZIP entry bytes differ from its manifest: ${path}`);
    entries.push({ path, parts, bytes, size: manifestEntry.size, sha256: manifestEntry.sha256 });
  }
  if (entries.length !== readBack.entries.size || entries.length !== readBack.manifest.files) throw new Error("verified ZIP entry coverage is incomplete");
  return entries;
}

function writeStageTree(root, entries, writeFile) {
  const directories = new Set();
  for (const entry of entries) {
    for (let length = 1; length < entry.parts.length; length += 1) directories.add(entry.parts.slice(0, length).join("/"));
  }
  for (const path of [...directories].sort((left, right) => {
    const depth = left.split("/").length - right.split("/").length;
    return depth || (left < right ? -1 : left > right ? 1 : 0);
  })) mkdirSync(join(root, ...path.split("/")), { mode: 0o755 });
  for (const entry of entries) {
    writeFile(join(root, ...entry.parts), Buffer.from(entry.bytes.buffer, entry.bytes.byteOffset, entry.bytes.byteLength), {
      flag: "wx",
      mode: 0o644,
    });
  }
}

function readStageTree(root, expected) {
  const found = new Map();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const fullPath = join(directory, entry.name);
      const stats = lstatSync(fullPath);
      if (stats.isSymbolicLink()) throw new Error(`staged tree contains a symbolic link: ${fullPath}`);
      if (stats.isDirectory()) visit(fullPath);
      else if (stats.isFile()) {
        const path = portable(relative(root, fullPath));
        const before = stats;
        const bytes = readFileSync(fullPath);
        const after = lstatSync(fullPath);
        if (!after.isFile() || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino || before.dev !== after.dev) {
          throw new Error(`staged file changed during read-back: ${path}`);
        }
        found.set(path, { path, size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") });
      } else throw new Error(`staged tree contains a non-regular entry: ${fullPath}`);
    }
  };
  visit(root);
  if (found.size !== expected.length) throw new Error(`staged entry count differs from the verified ZIP: expected ${expected.length}, found ${found.size}`);
  const rows = [];
  for (const entry of expected) {
    const actual = found.get(entry.path);
    if (!actual) throw new Error(`staged tree is missing verified ZIP entry: ${entry.path}`);
    if (actual.size !== entry.size || actual.sha256 !== entry.sha256) throw new Error(`staged bytes differ from the verified ZIP: ${entry.path}`);
    rows.push(actual);
  }
  return rows;
}

function stageContentId(entries) {
  const contract = JSON.stringify({ contract: "realitycheck-publish-stage-v1", entries });
  return `sha256:${createHash("sha256").update(contract, "utf8").digest("hex")}`;
}

/**
 * Load and independently revalidate the exact final bytes of one publish-ready
 * run. Local paths are returned for same-process handoff only; report builders
 * must persist the normalized identities instead of these machine paths.
 */
export async function loadVerifiedPublishCapsule(source) {
  const evidence = sourceEvidence(source);
  const archiveBytes = readFileSync(evidence.archive.canonical);
  const archiveSha256 = createHash("sha256").update(archiveBytes).digest("hex");
  if (archiveBytes.byteLength !== evidence.receipt.archive.bytes || archiveSha256 !== evidence.receipt.archive.sha256) {
    throw new Error("publish archive bytes differ from the independently validated receipt");
  }
  const readBack = await readStoredZipEntries(new Uint8Array(archiveBytes.buffer, archiveBytes.byteOffset, archiveBytes.byteLength));
  const entries = normalizeZipEntries(readBack);
  if (evidence.publicManifest.deployContentId !== evidence.receipt.deployContentId) throw new Error("public manifest deploy content ID differs from the receipt");
  if (evidence.finalBrowserProof.passed !== true || evidence.finalBrowserProof.deploy?.contentId !== evidence.receipt.deployContentId) {
    throw new Error("final-archive browser proof does not bind the receipt deploy content ID");
  }
  return {
    runDirectory: evidence.run.canonical,
    receiptPath: evidence.receiptPath.canonical,
    archivePath: evidence.archive.canonical,
    publicManifestPath: evidence.publicManifestPath.canonical,
    finalBrowserProofPath: evidence.finalProof.canonical,
    receipt: evidence.receipt,
    publicManifest: evidence.publicManifest,
    finalBrowserProof: evidence.finalBrowserProof,
    archiveBytes,
    archiveSha256,
    archiveManifest: readBack.manifest,
    entries,
  };
}

/**
 * Materialize one publish-ready capsule into a new regular-file-only tree.
 *
 * `source` is either a run-directory string, `{ runDirectory }`, or the exact
 * `{ receiptPath, archivePath }` pair. The returned receipt is deliberately
 * not written into the staged site; callers may persist it as separate
 * deployment evidence.
 */
export async function stageVerifiedPublishCapsule(source, destination, options = {}) {
  const evidence = await loadVerifiedPublishCapsule(source);
  const target = prepareDestination(destination, evidence.runDirectory);
  const archiveSha256 = evidence.archiveSha256;
  const entries = evidence.entries;
  const writeFile = options.operations?.writeFileSync || writeFileSync;
  const expose = options.operations?.renameSync || renameSync;
  const now = options.now || (() => new Date());
  const nonce = randomBytes(12).toString("hex");
  const temporary = join(target.parent, `.realitycheck-stage-${nonce}.tmp`);
  const lock = join(target.parent, `.realitycheck-stage-${createHash("sha256").update(target.canonical).digest("hex").slice(0, 20)}.lock`);
  let ownTemporary = false;
  let ownLock = false;
  try {
    mkdirSync(lock, { mode: 0o700 });
    ownLock = true;
    if (lstatIfPresent(target.absolute)) throw new Error(`stage destination already exists: ${target.absolute}`);
    mkdirSync(temporary, { mode: 0o700 });
    ownTemporary = true;
    writeStageTree(temporary, entries, writeFile);
    const stagedEntries = readStageTree(temporary, entries);
    const receipt = {
      schemaVersion: "1",
      kind: "html-note-publish-stage-receipt",
      generatedAt: now().toISOString(),
      status: "ready-for-static-host-artifact",
      source: {
        publishStatus: evidence.receipt.status,
        receiptFilename: basename(evidence.receiptPath),
        archiveFilename: evidence.receipt.archive.filename,
        archiveBytes: evidence.receipt.archive.bytes,
        archiveSha256,
        deployContentId: evidence.receipt.deployContentId,
        finalArchiveBrowserProofId: evidence.receipt.finalArchiveBrowserProofId,
      },
      stage: {
        contract: "realitycheck-publish-stage-v1",
        contentId: stageContentId(stagedEntries),
        files: stagedEntries.length,
        bytes: stagedEntries.reduce((sum, entry) => sum + entry.size, 0),
        entrypoint: "index.html",
        entries: stagedEntries,
      },
      checks: {
        evidenceValidated: true,
        archiveReadBackVerified: true,
        destinationWasAbsent: true,
        regularFilesOnly: true,
        entryCoverageComplete: true,
        byteForByte: true,
      },
      boundaries: {
        sourceModified: false,
        receiptWrittenIntoSite: false,
        uploaded: false,
        deployed: false,
      },
    };
    if (!stagedEntries.some((entry) => entry.path === "index.html")) throw new Error("verified publish capsule is missing root index.html");
    if (lstatIfPresent(target.absolute)) throw new Error(`stage destination appeared before atomic exposure: ${target.absolute}`);
    expose(temporary, target.absolute);
    ownTemporary = false;
    return receipt;
  } finally {
    if (ownTemporary) rmSync(temporary, { recursive: true, force: true });
    if (ownLock) rmSync(lock, { recursive: true, force: true });
  }
}

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";

import { PUBLISH_LIMITS } from "./note-publish-policy.mjs";
import { isSensitiveNoteArchivePath } from "./note-path-policy.mjs";

const HTML = /\.html?$/i;
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function portable(value) {
  return value.split(sep).join("/");
}

function assertPortablePath(path) {
  if (!path || path.startsWith("/") || path.includes("\\") || /^[a-z]:/i.test(path)) throw new Error(`Unsafe publish path: ${path}`);
  const parts = path.split("/");
  for (const part of parts) {
    if (!part || part === "." || part === "..") throw new Error(`Unsafe publish path segment in: ${path}`);
    if (/[<>:"|?*\p{Cc}\p{Cf}]/u.test(part) || /[. ]$/.test(part)) throw new Error(`Cross-platform-invalid publish path: ${path}`);
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) throw new Error(`Windows-reserved publish path: ${path}`);
  }
  return path;
}

function assertNotSensitive(path) {
  if (isSensitiveNoteArchivePath(path)) throw new Error(`Potentially sensitive or generated path is blocked from the publish package: ${path}`);
}

function registerPath(path, exact, nfc, folded) {
  assertPortablePath(path);
  assertNotSensitive(path);
  if (exact.has(path)) throw new Error(`Duplicate publish path: ${path}`);
  exact.add(path);
  const normalized = path.normalize("NFC");
  if (nfc.has(normalized)) throw new Error(`Unicode-normalized publish path collision: ${nfc.get(normalized)} and ${path}`);
  nfc.set(normalized, path);
  const key = normalized.toLowerCase();
  if (folded.has(key)) throw new Error(`Case-folded publish path collision: ${folded.get(key)} and ${path}`);
  folded.set(key, path);
}

function verifyNoFileAncestor(paths) {
  const folded = new Map(paths.map((path) => [path.normalize("NFC").toLowerCase(), path]));
  for (const [key, path] of folded) {
    const segments = key.split("/");
    for (let length = 1; length < segments.length; length += 1) {
      const ancestor = segments.slice(0, length).join("/");
      if (folded.has(ancestor)) throw new Error(`A publish file is also a directory prefix: ${folded.get(ancestor)} and ${path}`);
    }
  }
}

function snapshotUnchanged(before, after, path) {
  if (!after.isFile() || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino || before.dev !== after.dev) {
    throw new Error(`Source file changed while its publish bytes were being frozen: ${path}`);
  }
}

function readDirectoryOrHtml(input) {
  const stat = lstatSync(input);
  if (stat.isSymbolicLink()) throw new Error("Publish input must not be a symbolic link");
  if (!stat.isFile() && !stat.isDirectory()) throw new Error("Publish input must be a regular HTML file, directory, or ZIP archive");
  if (stat.isFile() && !HTML.test(input)) throw new Error("A non-ZIP publish input file must end in .html or .htm");
  const root = stat.isDirectory() ? input : resolve(input, "..");
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name))) {
      const fullPath = join(directory, entry.name);
      const item = lstatSync(fullPath);
      const path = portable(relative(root, fullPath)) || basename(fullPath);
      if (item.isSymbolicLink()) throw new Error(`Symbolic links are blocked from publish packages: ${path}`);
      if (item.isDirectory()) {
        assertNotSensitive(path);
        walk(fullPath);
      } else if (item.isFile()) files.push({ fullPath, path, stat: item });
      else throw new Error(`Special filesystem entries are blocked from publish packages: ${path}`);
    }
  };
  if (stat.isDirectory()) walk(input);
  else files.push({ fullPath: input, path: basename(input), stat });
  if (!files.length) throw new Error("Publish input contains no files");
  if (files.length > PUBLISH_LIMITS.maxSourceFiles) throw new Error(`Publish input exceeds the ${PUBLISH_LIMITS.maxSourceFiles}-file source limit`);
  const exact = new Set();
  const nfc = new Map();
  const folded = new Map();
  let total = 0;
  for (const file of files) {
    registerPath(file.path, exact, nfc, folded);
    if (file.stat.size > PUBLISH_LIMITS.maxFileBytes) throw new Error(`Publish file exceeds the ${PUBLISH_LIMITS.maxFileBytes}-byte limit: ${file.path}`);
    total += file.stat.size;
    if (total > PUBLISH_LIMITS.maxSourceTotalBytes) throw new Error(`Publish input exceeds the ${PUBLISH_LIMITS.maxSourceTotalBytes}-byte source limit`);
  }
  verifyNoFileAncestor([...exact]);
  const entries = new Map();
  for (const file of files.sort((left, right) => compareText(left.path, right.path))) {
    const bytes = new Uint8Array(readFileSync(file.fullPath));
    snapshotUnchanged(file.stat, lstatSync(file.fullPath), file.path);
    if (bytes.byteLength !== file.stat.size) throw new Error(`Source file size changed while reading: ${file.path}`);
    entries.set(file.path, bytes);
  }
  return { entries, sourceKind: stat.isDirectory() ? "directory" : "html-file", rootStripped: false };
}

function sourceContentId(entries) {
  const contract = [...entries].map(([path, bytes]) => ({ path, bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") }));
  return `sha256:${createHash("sha256").update(JSON.stringify({ contract: "realitycheck-publish-source-v1", entries: contract })).digest("hex")}`;
}

function safeSlug(value) {
  const normalized = String(value || "html-site").normalize("NFKC").toLowerCase().replace(/\.(?:zip|html?)$/i, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return normalized || "html-site";
}

function preparedRepairName(input, stat) {
  if (!stat.isDirectory() || basename(input).toLowerCase() !== "repaired") return null;
  const reportPath = join(dirname(input), "report.json");
  if (!existsSync(reportPath)) return null;
  try {
    const reportStat = lstatSync(reportPath);
    if (reportStat.isSymbolicLink() || !reportStat.isFile() || reportStat.size > 1024 * 1024) return null;
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    return report?.kind === "html-note-check-bundle" && typeof report?.input?.name === "string" && report.input.name ? report.input.name : null;
  } catch {
    return null;
  }
}

function publishZipEntries(extracted) {
  if (!(extracted?.entries instanceof Map) || !Array.isArray(extracted?.manifest?.entries)) throw new Error("ZIP extraction did not return a bound entry manifest");
  const originals = extracted.manifest.entries.map((entry) => {
    const bytes = extracted.entries.get(entry.path);
    if (!(bytes instanceof Uint8Array) || typeof entry.originalPath !== "string") throw new Error("ZIP entry bytes differ from their import manifest");
    return { originalPath: entry.originalPath, bytes };
  });
  const firstSegment = originals[0]?.originalPath.split("/")[0] || null;
  const stripRoot = Boolean(firstSegment) && originals.every((entry) => entry.originalPath.startsWith(`${firstSegment}/`));
  const exact = new Set();
  const nfc = new Map();
  const folded = new Map();
  const entries = new Map();
  for (const item of originals) {
    const path = stripRoot ? item.originalPath.slice(firstSegment.length + 1) : item.originalPath;
    registerPath(path, exact, nfc, folded);
    entries.set(path, item.bytes);
  }
  verifyNoFileAncestor([...exact]);
  return { entries: new Map([...entries].sort(([left], [right]) => compareText(left, right))), rootStripped: stripRoot };
}

/** Freeze a local folder/HTML/ZIP into an immutable, bounded byte map. */
export async function loadPublishInput(inputPath, { name = null } = {}) {
  if (typeof inputPath !== "string" || !inputPath) throw new TypeError("publish input path is required");
  const input = resolve(inputPath);
  if (!existsSync(input)) throw new Error(`Publish input does not exist: ${inputPath}`);
  const stat = lstatSync(input);
  let loaded;
  if (stat.isFile() && extname(input).toLowerCase() === ".zip") {
    if (stat.size > PUBLISH_LIMITS.maxArchiveBytes) throw new Error(`Publish ZIP exceeds the ${PUBLISH_LIMITS.maxArchiveBytes}-byte archive limit`);
    const archive = new Uint8Array(readFileSync(input));
    snapshotUnchanged(stat, lstatSync(input), basename(input));
    const { readPortableZipArchive } = await import("./note-zip-import-node.mjs");
    const extracted = await readPortableZipArchive(archive, { limits: { ...PUBLISH_LIMITS, maxFiles: PUBLISH_LIMITS.maxSourceFiles, maxTotalBytes: PUBLISH_LIMITS.maxSourceTotalBytes }, name: basename(input) });
    const normalized = publishZipEntries(extracted);
    loaded = { ...normalized, sourceKind: "zip", archiveManifest: extracted.manifest };
  } else loaded = readDirectoryOrHtml(input);
  if (![...loaded.entries.keys()].some((path) => HTML.test(path))) throw new Error("Publish input contains no .html or .htm page");
  const slug = safeSlug(name || preparedRepairName(input, stat) || basename(input));
  return {
    ...loaded,
    sourceContentId: sourceContentId(loaded.entries),
    slug,
    inputName: basename(input),
    files: loaded.entries.size,
    bytes: [...loaded.entries.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0),
  };
}

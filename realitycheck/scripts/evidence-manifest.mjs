import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { TOOL_VERSION } from "./version.mjs";

const MANIFEST_FILENAME = "evidence-manifest.json";
const MANIFEST_COMPANIONS = new Set([MANIFEST_FILENAME, "evidence-attestation.json", "evidence-attestation.html", "evidence-trust-report.json", "evidence-trust-report.html"]);

function portable(path) {
  return path.replaceAll("\\", "/");
}

function mediaType(path) {
  const extension = path.toLowerCase().split(".").at(-1);
  return ({
    html: "text/html",
    json: "application/json",
    md: "text/markdown",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    sarif: "application/sarif+json",
    xml: "application/xml",
  })[extension] || "application/octet-stream";
}

function fileDigest(path) {
  const contents = readFileSync(path);
  return { bytes: contents.byteLength, sha256: createHash("sha256").update(contents).digest("hex") };
}

function collectFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && !MANIFEST_COMPANIONS.has(entry.name)) files.push(absolute);
    }
  };
  visit(root);
  return files.sort((left, right) => portable(relative(root, left)).localeCompare(portable(relative(root, right))));
}

export function buildEvidenceManifest(runDirectory, source, { generatedAt = new Date() } = {}) {
  const root = resolve(runDirectory);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`Evidence directory does not exist: ${root}`);
  if (!["page-audit", "site-audit"].includes(source?.artifactKind)) throw new Error("Evidence manifest requires a page-audit or site-audit source");
  if (!source.runId || !source.target) throw new Error("Evidence manifest requires a run ID and target");
  new URL(source.target);
  const files = collectFiles(root).map((absolute) => {
    const path = portable(relative(root, absolute));
    const digest = fileDigest(absolute);
    return { path, ...digest, mediaType: mediaType(path) };
  });
  if (!files.length) throw new Error(`No evidence files were found in ${root}`);
  return {
    schemaVersion: "1",
    toolVersion: TOOL_VERSION,
    kind: "evidence-manifest",
    generatedAt: generatedAt.toISOString(),
    source: {
      artifactKind: source.artifactKind,
      runId: source.runId,
      target: source.target,
    },
    algorithm: "sha256",
    summary: {
      files: files.length,
      bytes: files.reduce((total, file) => total + file.bytes, 0),
    },
    files,
  };
}

export function writeEvidenceManifest(runDirectory, source, options = {}) {
  mkdirSync(runDirectory, { recursive: true });
  const manifest = buildEvidenceManifest(runDirectory, source, options);
  const path = join(runDirectory, MANIFEST_FILENAME);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { path, manifest };
}

export function verifyEvidenceManifest(manifestPath, manifest) {
  const root = resolve(manifestPath, "..");
  const errors = [];
  let totalBytes = 0;
  const declared = new Set();
  for (const item of manifest.files || []) {
    if (declared.has(item.path)) {
      errors.push(`/files duplicate evidence path: ${item.path}`);
      continue;
    }
    declared.add(item.path);
    const absolute = resolve(root, item.path);
    const rel = portable(relative(root, absolute));
    if (isAbsolute(item.path) || rel === ".." || rel.startsWith("../")) {
      errors.push(`/files path escapes the evidence directory: ${item.path}`);
      continue;
    }
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      errors.push(`/files missing evidence file: ${item.path}`);
      continue;
    }
    const actual = fileDigest(absolute);
    totalBytes += actual.bytes;
    if (actual.bytes !== item.bytes) errors.push(`/files byte count mismatch: ${item.path}`);
    if (actual.sha256 !== item.sha256) errors.push(`/files SHA-256 mismatch: ${item.path}`);
  }
  for (const absolute of collectFiles(root)) {
    const path = portable(relative(root, absolute));
    if (!declared.has(path)) errors.push(`/files unlisted evidence file: ${path}`);
  }
  if ((manifest.summary?.files ?? -1) !== (manifest.files || []).length) errors.push("/summary/files does not match the manifest list");
  if (!errors.some((error) => error.includes("missing evidence file")) && (manifest.summary?.bytes ?? -1) !== totalBytes) {
    errors.push("/summary/bytes does not match the verified file total");
  }
  return errors;
}

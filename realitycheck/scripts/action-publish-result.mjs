#!/usr/bin/env node

import { createHash } from "node:crypto";
import { appendFileSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { validateArtifactFiles } from "./artifact-validator.mjs";

const MAX_RESULT_BYTES = 128 * 1024;
const MAX_JSON_ARTIFACT_BYTES = 64 * 1024 * 1024;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const READY_STATUSES = new Set(["ready", "warnings"]);

function portable(value) {
  return value.split(sep).join("/");
}

function samePath(left, right) {
  const normalize = (value) => process.platform === "win32" ? resolve(value).toLowerCase() : resolve(value);
  return normalize(left) === normalize(right);
}

function contained(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function existingWithoutSymlinks(label, value, expectedKind) {
  if (typeof value !== "string" || !value || CONTROL.test(value)) throw new Error(`${label} must be a non-empty path without control characters`);
  const absolute = resolve(value);
  let stats;
  try { stats = lstatSync(absolute); }
  catch (error) { throw new Error(`${label} does not exist: ${absolute} (${error.message})`); }
  if (stats.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${absolute}`);
  if (expectedKind === "file" && !stats.isFile()) throw new Error(`${label} must be a regular file: ${absolute}`);
  if (expectedKind === "directory" && !stats.isDirectory()) throw new Error(`${label} must be a directory: ${absolute}`);
  const canonical = realpathSync(absolute);
  if (!samePath(absolute, canonical)) throw new Error(`${label} must not traverse a symbolic link: ${absolute}`);
  return { absolute, canonical, stats };
}

function readBoundedJson(label, value, maximum = MAX_JSON_ARTIFACT_BYTES) {
  const file = existingWithoutSymlinks(label, value, "file");
  if (file.stats.size < 2 || file.stats.size > maximum) throw new Error(`${label} is outside the ${maximum}-byte boundary`);
  try { return { ...file, value: JSON.parse(readFileSync(file.canonical, "utf8")) }; }
  catch (error) { throw new Error(`${label} is not valid JSON (${error.message})`); }
}

function parseArguments(argv) {
  const options = {};
  const args = [...argv];
  while (args.length) {
    const name = args.shift();
    if (!["--result", "--output-root", "--workspace", "--github-output"].includes(name)) throw new Error(`Unknown option: ${name}`);
    if (Object.hasOwn(options, name)) throw new Error(`Duplicate option: ${name}`);
    const value = args.shift();
    if (!value) throw new Error(`${name} requires a value`);
    options[name] = value;
  }
  for (const name of ["--result", "--output-root", "--workspace"]) if (!options[name]) throw new Error(`${name} is required`);
  return options;
}

function requireValidatedArtifact(results, path, expectedKind) {
  const found = results.find((item) => samePath(item.path, path));
  if (!found) throw new Error(`${expectedKind} was not discovered during run-directory validation: ${path}`);
  if (found.kind !== expectedKind) throw new Error(`${path} has kind ${found.kind}; expected ${expectedKind}`);
  if (!found.valid) throw new Error(`${path} failed validation: ${found.errors.join("; ")}`);
}

function workspacePath(workspace, path) {
  if (!contained(workspace, path)) throw new Error(`Validated artifact escaped the workspace: ${path}`);
  return portable(relative(workspace, path)) || ".";
}

function pathOutputs(outputs, name, workspace, path) {
  outputs[`${name}-path`] = workspacePath(workspace, path);
  outputs[`${name}-path-absolute`] = path;
}

function assertSafeRunTree(root) {
  let entries = 0;
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      entries += 1;
      if (entries > 5_000) throw new Error("publish run directory exceeds the 5000-entry Action handoff boundary");
      if (!entry.name || CONTROL.test(entry.name)) throw new Error("publish run directory contains a control character in an entry name");
      const path = resolve(directory, entry.name);
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) throw new Error(`publish run directory contains a symbolic link: ${path}`);
      if (stats.isDirectory()) visit(path);
      else if (!stats.isFile()) throw new Error(`publish run directory contains a non-regular entry: ${path}`);
    }
  };
  visit(root);
}

/**
 * Validate and normalize one finalized CLI publish result without scanning for
 * a newest run. This is the sole bridge from publish bytes to Action outputs.
 */
export function validateActionPublishResult({ resultPath, outputRoot, workspace }) {
  const resultFile = readBoundedJson("publish result", resultPath, MAX_RESULT_BYTES);
  const [resultValidation] = validateArtifactFiles([resultFile.canonical]);
  if (!resultValidation?.valid || resultValidation.kind !== "html-note-publish-command-result") {
    throw new Error(`Publish result contract failed validation: ${resultValidation?.errors?.join("; ") || "wrong artifact kind"}`);
  }
  const result = resultFile.value;
  const workspaceDirectory = existingWithoutSymlinks("workspace", workspace, "directory");
  const outputDirectory = existingWithoutSymlinks("output root", outputRoot, "directory");
  if (!contained(workspaceDirectory.canonical, outputDirectory.canonical)) throw new Error("output root must stay inside the workspace");
  if (contained(outputDirectory.canonical, resultFile.canonical)) throw new Error("publish result JSON must stay outside the uploaded output root");

  if (!isAbsolute(result.runDirectory)) throw new Error("runDirectory must be an absolute path");
  const runDirectory = existingWithoutSymlinks("publish run directory", result.runDirectory, "directory");
  if (!samePath(dirname(runDirectory.absolute), outputDirectory.absolute)
    || !samePath(dirname(runDirectory.canonical), outputDirectory.canonical)) {
    throw new Error("publish run directory must be one direct child of output root");
  }
  assertSafeRunTree(runDirectory.canonical);

  const artifacts = {};
  for (const [name, value] of Object.entries(result.artifacts)) {
    if (value === null) { artifacts[name] = null; continue; }
    if (!isAbsolute(value)) throw new Error(`artifacts.${name} must be an absolute path`);
    const artifact = existingWithoutSymlinks(`artifacts.${name}`, value, "file");
    if (!contained(runDirectory.absolute, artifact.absolute) || !contained(runDirectory.canonical, artifact.canonical)) {
      throw new Error(`artifacts.${name} escaped the publish run directory`);
    }
    artifacts[name] = artifact.canonical;
  }

  const stem = basename(artifacts.archive, ".zip");
  const ready = READY_STATUSES.has(result.status);
  const expectedSuffix = ready ? ".realitycheck-publish" : ".realitycheck-working-copy";
  if (!stem.endsWith(expectedSuffix)) throw new Error("archive filename does not match publish status");
  if (result.publishReady !== ready || result.exitCode !== (ready ? 0 : 1)) throw new Error("publish status, publishReady, and exitCode disagree");
  if (!samePath(artifacts.checksum, `${artifacts.archive}.sha256`)) throw new Error("checksum path does not name the archive sidecar");
  for (const [name, expected] of [
    ["receipt", `${stem}.receipt.json`],
    ["manifest", `${stem}.manifest.json`],
    ["report", `${stem}.report.html`],
    ["technicalReport", "technical-report.json"],
  ]) if (basename(artifacts[name]) !== expected) throw new Error(`artifacts.${name} filename does not match the archive stem`);
  if (!new Set(["repair-plan.md", "repair-plan.zh-CN.md"]).has(basename(artifacts.repairPlan))) throw new Error("repair plan has an unsupported filename");
  if (ready) {
    const expectedBrowserProof = resolve(runDirectory.canonical, "browser-final-archive", "browser-proof.json");
    if (!artifacts.browserProof || !samePath(artifacts.browserProof, expectedBrowserProof)) throw new Error("publish-ready result requires the final-archive browser proof");
  } else if (artifacts.browserProof) {
    const expectedFailedProof = resolve(runDirectory.canonical, "browser-failed-final-attempt", "browser-proof.json");
    if (!samePath(artifacts.browserProof, expectedFailedProof)) throw new Error("working-copy result may expose only the failed-final-attempt browser proof");
  }

  const runValidations = validateArtifactFiles([runDirectory.canonical]);
  if (!runValidations.length) throw new Error("publish run directory contains no recognized JSON artifacts");
  const invalid = runValidations.filter((item) => !item.valid);
  if (invalid.length) throw new Error(`Publish run artifact validation failed: ${invalid.map((item) => `${item.path}: ${item.errors.join("; ")}`).join(" | ")}`);
  requireValidatedArtifact(runValidations, artifacts.receipt, "html-note-publish-receipt");
  requireValidatedArtifact(runValidations, artifacts.manifest, "html-note-publish-proof");
  requireValidatedArtifact(runValidations, artifacts.technicalReport, "html-note-publish-technical-report");
  if (artifacts.browserProof) requireValidatedArtifact(runValidations, artifacts.browserProof, "html-note-publish-browser-proof");

  const receipt = readBoundedJson("publish receipt", artifacts.receipt).value;
  const manifest = readBoundedJson("publish manifest", artifacts.manifest).value;
  const technicalReport = readBoundedJson("publish technical report", artifacts.technicalReport).value;
  const archiveSha256 = createHash("sha256").update(readFileSync(artifacts.archive)).digest("hex");
  for (const [label, actual] of [
    ["receipt status", receipt.status], ["manifest status", manifest.status], ["technical report status", technicalReport.status],
  ]) if (actual !== result.status) throw new Error(`${label} differs from the command result`);
  for (const [label, actual] of [
    ["receipt deployContentId", receipt.deployContentId], ["manifest deployContentId", manifest.deployContentId], ["technical report deploy contentId", technicalReport.deploy?.contentId],
  ]) if (actual !== result.deployContentId) throw new Error(`${label} differs from the command result`);
  if (receipt.publishReady !== result.publishReady) throw new Error("receipt publishReady differs from the command result");
  if (receipt.archive?.sha256 !== result.archiveSha256 || archiveSha256 !== result.archiveSha256) throw new Error("archive SHA-256 differs from the command result or receipt");
  if (receipt.archive?.filename !== basename(artifacts.archive)) throw new Error("receipt archive filename differs from the command result");
  if (result.generatedAt !== receipt.generatedAt) throw new Error("command result generatedAt differs from the receipt");

  const outputs = {
    "result-valid": "true",
    "publish-status": result.status,
    "exit-code": String(result.exitCode),
    "publish-ready": String(result.publishReady),
    "report-root": workspacePath(workspaceDirectory.canonical, runDirectory.canonical),
    "run-directory": workspacePath(workspaceDirectory.canonical, runDirectory.canonical),
    "run-directory-absolute": runDirectory.canonical,
    "artifact-path": runDirectory.canonical,
    "archive-filename": basename(artifacts.archive),
    "deploy-content-id": result.deployContentId,
    "archive-sha256": result.archiveSha256,
  };
  for (const name of ["checksum", "receipt", "manifest", "report", "technical-report", "repair-plan"]) {
    const artifactKey = name.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
    pathOutputs(outputs, name, workspaceDirectory.canonical, artifacts[artifactKey]);
  }
  outputs["report-json-path"] = outputs["receipt-path"];
  outputs["report-json-path-absolute"] = outputs["receipt-path-absolute"];
  if (artifacts.browserProof) pathOutputs(outputs, "browser-proof", workspaceDirectory.canonical, artifacts.browserProof);
  pathOutputs(outputs, ready ? "archive" : "working-copy", workspaceDirectory.canonical, artifacts.archive);
  return { result, outputs, validations: runValidations };
}

function outputLines(outputs) {
  return Object.entries(outputs).map(([name, value]) => {
    if (typeof value !== "string" || CONTROL.test(value)) throw new Error(`Unsafe GitHub output value for ${name}`);
    return `${name}=${value}`;
  });
}

export function run(argv) {
  const options = parseArguments(argv);
  const validated = validateActionPublishResult({
    resultPath: options["--result"],
    outputRoot: options["--output-root"],
    workspace: options["--workspace"],
  });
  const lines = outputLines(validated.outputs);
  if (options["--github-output"]) {
    const target = existingWithoutSymlinks("GitHub output", options["--github-output"], "file");
    appendFileSync(target.canonical, `${lines.join("\n")}\n`, "utf8");
  } else console.log(lines.join("\n"));
  // A structurally valid working copy is still a successful parser result.
  // Its quality gate remains available only through the emitted exit-code=1.
  return 0;
}

const direct = (() => {
  if (!process.argv[1]) return false;
  try { return samePath(realpathSync(process.argv[1]), realpathSync(fileURLToPath(import.meta.url))); }
  catch { return samePath(process.argv[1], fileURLToPath(import.meta.url)); }
})();
if (direct) {
  try { process.exitCode = run(process.argv.slice(2)); }
  catch (error) {
    console.error(`RealityCheck Action publish-result error: ${error.message}`);
    process.exitCode = 2;
  }
}

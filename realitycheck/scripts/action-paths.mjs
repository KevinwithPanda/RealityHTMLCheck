#!/usr/bin/env node

import { appendFileSync, existsSync, lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN_ARTIFACT_PATTERN = /[\0\r\n*?\[\]{}!]/;

function portable(value) {
  return value.split(sep).join("/");
}

function relativeInput(name, value, { allowDot = true, required = true } = {}) {
  const original = String(value ?? "");
  if (original !== original.trim()) throw new Error(`${name} cannot start or end with whitespace`);
  if (required && !original) throw new Error(`${name} is required`);
  if (FORBIDDEN_ARTIFACT_PATTERN.test(original)) throw new Error(`${name} cannot contain control characters or artifact glob syntax`);
  const normalized = original.replaceAll("\\", "/").replace(/\/+/g, "/");
  if (isAbsolute(original) || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//")) {
    throw new Error(`${name} must be relative`);
  }
  const segments = normalized.split("/");
  if (segments.includes("..")) throw new Error(`${name} cannot escape with ..`);
  const clean = segments.filter((segment) => segment && segment !== ".").join("/") || ".";
  if (!allowDot && clean === ".") throw new Error(`${name} must name a child directory`);
  return clean;
}

function canonicalAllowMissing(path) {
  let cursor = resolve(path);
  const suffix = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) throw new Error(`Cannot resolve an existing ancestor for ${path}`);
    suffix.unshift(basename(cursor));
    cursor = parent;
  }
  let canonical = realpathSync(cursor);
  for (const segment of suffix) canonical = resolve(canonical, segment);
  return canonical;
}

function canonicalAllowMissingWithoutLinks(path, label) {
  let cursor = resolve(path);
  const suffix = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) throw new Error(`Cannot resolve an existing ancestor for ${path}`);
    suffix.unshift(basename(cursor));
    cursor = parent;
  }
  const stats = lstatSync(cursor);
  if (stats.isSymbolicLink()) throw new Error(`${label} must not traverse a symbolic-link ancestor`);
  if (!stats.isDirectory()) throw new Error(`${label} must have a regular directory ancestor`);
  const canonical = realpathSync(cursor);
  const same = process.platform === "win32" ? resolve(cursor).toLowerCase() === resolve(canonical).toLowerCase() : resolve(cursor) === resolve(canonical);
  if (!same) throw new Error(`${label} must not traverse a symbolic-link ancestor`);
  return suffix.reduce((current, segment) => resolve(current, segment), canonical);
}

function contained(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function workspaceRelative(workspace, target) {
  const path = portable(relative(workspace, target));
  return path || ".";
}

export function resolveActionPaths({ workspace, workingDirectory = ".", kind = "web", notePath = "", baseline = "", output, publishRunKey = "", materializeOutput = "" }) {
  if (!new Set(["web", "note", "publish"]).has(kind)) throw new Error("kind must be web, note, or publish");
  const workspaceRaw = String(workspace ?? "");
  if (!workspaceRaw || FORBIDDEN_ARTIFACT_PATTERN.test(workspaceRaw)) throw new Error("workspace is invalid");
  const workspaceCanonical = realpathSync(resolve(workspaceRaw));
  const workdirInput = relativeInput("working-directory", workingDirectory);
  const workdirCanonical = canonicalAllowMissing(resolve(workspaceCanonical, workdirInput));
  if (!contained(workspaceCanonical, workdirCanonical)) throw new Error("working-directory resolves outside the workspace");
  const outputBaseInput = relativeInput("output", output, { allowDot: false });
  let normalizedPublishRunKey = "";
  if (kind === "publish") {
    normalizedPublishRunKey = relativeInput("publish-run-key", publishRunKey, { allowDot: false });
    if (!/^action-[1-9][0-9]*-[1-9][0-9]*$/.test(normalizedPublishRunKey)) {
      throw new Error("publish-run-key must match action-RUN_ID-RUN_ATTEMPT with positive numeric IDs");
    }
  } else if (publishRunKey) {
    throw new Error("publish-run-key is only valid when kind is publish");
  }
  const outputInput = normalizedPublishRunKey ? `${outputBaseInput}/${normalizedPublishRunKey}` : outputBaseInput;
  const outputCanonical = canonicalAllowMissing(resolve(workdirCanonical, outputInput));
  if (!contained(workdirCanonical, outputCanonical)) throw new Error("output resolves outside working-directory");
  if (outputCanonical === workdirCanonical) throw new Error("output cannot equal working-directory");

  let targetInput = "";
  let targetCanonical = "";
  let baselineInput = "";
  let baselineCanonical = "";
  let sourceRootCanonical = workdirCanonical;
  let materializeOutputInput = "";
  let materializeOutputCanonical = "";
  if (kind !== "publish" && materializeOutput) throw new Error("materialize-output is only valid when kind is publish");
  if (kind === "note" || kind === "publish") {
    targetInput = relativeInput("path", notePath);
    targetCanonical = canonicalAllowMissing(resolve(workdirCanonical, targetInput));
    if (!contained(workdirCanonical, targetCanonical)) throw new Error("path resolves outside working-directory");
    if (targetCanonical === outputCanonical) throw new Error("path and output cannot resolve to the same location");
    if (kind === "publish" && (contained(targetCanonical, outputCanonical) || contained(outputCanonical, targetCanonical))) {
      throw new Error("publish path and output must be separate, non-nested locations");
    }
    if (kind === "publish" && materializeOutput) {
      materializeOutputInput = relativeInput("materialize-output", materializeOutput, { allowDot: false });
      materializeOutputCanonical = canonicalAllowMissingWithoutLinks(resolve(workdirCanonical, materializeOutputInput), "materialize-output");
      if (!contained(workdirCanonical, materializeOutputCanonical)) throw new Error("materialize-output resolves outside working-directory");
      if (existsSync(materializeOutputCanonical)) throw new Error("materialize-output must name an absent directory");
      if (existsSync(`${materializeOutputCanonical}.realitycheck-stage.receipt.json`)) throw new Error("materialize-output stage receipt already exists");
      if (contained(targetCanonical, materializeOutputCanonical) || contained(materializeOutputCanonical, targetCanonical)) {
        throw new Error("publish path and materialize-output must be separate, non-nested locations");
      }
      if (contained(outputCanonical, materializeOutputCanonical) || contained(materializeOutputCanonical, outputCanonical)) {
        throw new Error("publish output and materialize-output must be separate, non-nested locations");
      }
    }
    const targetIsFile = existsSync(targetCanonical) && lstatSync(targetCanonical).isFile();
    sourceRootCanonical = targetIsFile ? dirname(targetCanonical) : targetCanonical;
    if (kind === "publish" && baseline) throw new Error("baseline is not supported when kind is publish");
    if (kind === "note" && baseline) {
      baselineInput = relativeInput("baseline", baseline);
      baselineCanonical = canonicalAllowMissing(resolve(workdirCanonical, baselineInput));
      if (!contained(workdirCanonical, baselineCanonical)) throw new Error("baseline resolves outside working-directory");
      if (!existsSync(baselineCanonical) || !lstatSync(baselineCanonical).isFile()) throw new Error("baseline must resolve to an existing regular file");
      if (!/\.json$/i.test(baselineCanonical)) throw new Error("baseline must be a JSON report");
      if (new Set([resolve(outputCanonical, "latest.json"), resolve(outputCanonical, "report.json"), resolve(outputCanonical, "comparison.json")]).has(baselineCanonical)) {
        throw new Error("baseline cannot use a mutable top-level report inside output; use a timestamped report or a separate baseline path");
      }
    }
  }

  return {
    kind,
    workingDirectory: workspaceRelative(workspaceCanonical, workdirCanonical),
    workingDirectoryAbsolute: workdirCanonical,
    notePath: targetInput,
    notePathAbsolute: targetCanonical,
    baseline: baselineInput,
    baselineAbsolute: baselineCanonical,
    publishRunKey: normalizedPublishRunKey,
    output: portable(relative(workdirCanonical, outputCanonical)),
    artifactPath: outputCanonical,
    reportRoot: workspaceRelative(workspaceCanonical, outputCanonical),
    sourceRoot: workspaceRelative(workspaceCanonical, sourceRootCanonical),
    materializeOutput: materializeOutputInput,
    materializeOutputAbsolute: materializeOutputCanonical,
    materializeReceipt: materializeOutputInput ? `${materializeOutputInput}.realitycheck-stage.receipt.json` : "",
    materializeReceiptAbsolute: materializeOutputCanonical ? `${materializeOutputCanonical}.realitycheck-stage.receipt.json` : "",
    materializeRoot: materializeOutputCanonical ? workspaceRelative(workspaceCanonical, materializeOutputCanonical) : "",
    materializeReceiptRoot: materializeOutputCanonical ? workspaceRelative(workspaceCanonical, `${materializeOutputCanonical}.realitycheck-stage.receipt.json`) : "",
  };
}

function parseArguments(argv) {
  const options = {};
  const args = [...argv];
  while (args.length) {
    const name = args.shift();
    if (!["--workspace", "--working-directory", "--kind", "--path", "--baseline", "--output", "--publish-run-key", "--materialize-output", "--github-output"].includes(name)) {
      throw new Error(`Unknown option: ${name}`);
    }
    const value = args.shift();
    if (value === undefined) throw new Error(`${name} requires a value`);
    options[name.slice(2)] = value;
  }
  return options;
}

export function run(argv) {
  const options = parseArguments(argv);
  const resolved = resolveActionPaths({
    workspace: options.workspace,
    workingDirectory: options["working-directory"] ?? ".",
    kind: options.kind ?? "web",
    notePath: options.path ?? "",
    baseline: options.baseline ?? "",
    output: options.output,
    publishRunKey: options["publish-run-key"] ?? "",
    materializeOutput: options["materialize-output"] ?? "",
  });
  const lines = [
    `kind=${resolved.kind}`,
    `working-directory=${resolved.workingDirectory}`,
    `working-directory-absolute=${resolved.workingDirectoryAbsolute}`,
    `path=${resolved.notePath}`,
    `path-absolute=${resolved.notePathAbsolute}`,
    `baseline=${resolved.baseline}`,
    `baseline-absolute=${resolved.baselineAbsolute}`,
    `publish-run-key=${resolved.publishRunKey}`,
    `output=${resolved.output}`,
    `artifact-path=${resolved.artifactPath}`,
    `report-root=${resolved.reportRoot}`,
    `source-root=${resolved.sourceRoot}`,
    `materialize-output=${resolved.materializeOutput}`,
    `materialize-output-absolute=${resolved.materializeOutputAbsolute}`,
    `materialize-receipt=${resolved.materializeReceipt}`,
    `materialize-receipt-absolute=${resolved.materializeReceiptAbsolute}`,
    `materialize-root=${resolved.materializeRoot}`,
    `materialize-receipt-root=${resolved.materializeReceiptRoot}`,
  ];
  if (options["github-output"]) appendFileSync(options["github-output"], `${lines.join("\n")}\n`, "utf8");
  else console.log(lines.join("\n"));
  return 0;
}

const direct = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (direct) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (error) {
    console.error(`RealityCheck Action path error: ${error.message}`);
    process.exitCode = 2;
  }
}

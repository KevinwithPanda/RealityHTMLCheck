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

function contained(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function workspaceRelative(workspace, target) {
  const path = portable(relative(workspace, target));
  return path || ".";
}

export function resolveActionPaths({ workspace, workingDirectory = ".", kind = "web", notePath = "", output }) {
  if (!new Set(["web", "note"]).has(kind)) throw new Error("kind must be web or note");
  const workspaceRaw = String(workspace ?? "");
  if (!workspaceRaw || FORBIDDEN_ARTIFACT_PATTERN.test(workspaceRaw)) throw new Error("workspace is invalid");
  const workspaceCanonical = realpathSync(resolve(workspaceRaw));
  const workdirInput = relativeInput("working-directory", workingDirectory);
  const workdirCanonical = canonicalAllowMissing(resolve(workspaceCanonical, workdirInput));
  if (!contained(workspaceCanonical, workdirCanonical)) throw new Error("working-directory resolves outside the workspace");
  const outputInput = relativeInput("output", output, { allowDot: false });
  const outputCanonical = canonicalAllowMissing(resolve(workdirCanonical, outputInput));
  if (!contained(workdirCanonical, outputCanonical)) throw new Error("output resolves outside working-directory");
  if (outputCanonical === workdirCanonical) throw new Error("output cannot equal working-directory");

  let targetInput = "";
  let targetCanonical = "";
  let sourceRootCanonical = workdirCanonical;
  if (kind === "note") {
    targetInput = relativeInput("path", notePath);
    targetCanonical = canonicalAllowMissing(resolve(workdirCanonical, targetInput));
    if (!contained(workdirCanonical, targetCanonical)) throw new Error("path resolves outside working-directory");
    if (targetCanonical === outputCanonical) throw new Error("path and output cannot resolve to the same location");
    const targetIsFile = existsSync(targetCanonical) && lstatSync(targetCanonical).isFile();
    sourceRootCanonical = targetIsFile ? dirname(targetCanonical) : targetCanonical;
  }

  return {
    kind,
    workingDirectory: workspaceRelative(workspaceCanonical, workdirCanonical),
    workingDirectoryAbsolute: workdirCanonical,
    notePath: targetInput,
    notePathAbsolute: targetCanonical,
    output: portable(relative(workdirCanonical, outputCanonical)),
    artifactPath: outputCanonical,
    reportRoot: workspaceRelative(workspaceCanonical, outputCanonical),
    sourceRoot: workspaceRelative(workspaceCanonical, sourceRootCanonical),
  };
}

function parseArguments(argv) {
  const options = {};
  const args = [...argv];
  while (args.length) {
    const name = args.shift();
    if (!["--workspace", "--working-directory", "--kind", "--path", "--output", "--github-output"].includes(name)) {
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
    output: options.output,
  });
  const lines = [
    `kind=${resolved.kind}`,
    `working-directory=${resolved.workingDirectory}`,
    `working-directory-absolute=${resolved.workingDirectoryAbsolute}`,
    `path=${resolved.notePath}`,
    `path-absolute=${resolved.notePathAbsolute}`,
    `output=${resolved.output}`,
    `artifact-path=${resolved.artifactPath}`,
    `report-root=${resolved.reportRoot}`,
    `source-root=${resolved.sourceRoot}`,
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

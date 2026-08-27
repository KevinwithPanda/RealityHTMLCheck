import { lstatSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import { validateArtifactFiles } from "./artifact-validator.mjs";
import { stageVerifiedPublishCapsule } from "./note-publish-stage.mjs";

function usage() {
  return `RealityCheck verified publish materializer

Usage:
  realityhtmlcheck materialize <PUBLISH_RUN> --output <NEW_DIRECTORY> [--receipt <NEW_JSON>]

The command validates one complete publish-ready evidence run, re-reads its
exact ZIP, and atomically creates a regular-file-only static-host directory.
It never uploads, deploys, or changes the source run.`;
}

function parseArguments(argv) {
  const args = [...argv];
  if (args[0] === "--") args.shift();
  const options = { source: null, output: null, receipt: null };
  while (args.length) {
    const item = args.shift();
    if (item === "-h" || item === "--help") return { help: true };
    if (item === "--output" || item === "--receipt") {
      const value = args.shift();
      if (!value) throw new Error(`${item} requires a value`);
      if (item === "--output") options.output = value;
      else options.receipt = value;
      continue;
    }
    if (item.startsWith("--")) throw new Error(`Unknown materialize option: ${item}`);
    if (options.source) throw new Error(`Unexpected materialize argument: ${item}`);
    options.source = item;
  }
  if (!options.source) throw new Error("materialize requires a publish run directory");
  if (!options.output) throw new Error("materialize requires --output NEW_DIRECTORY");
  return options;
}

function exists(path) {
  try { lstatSync(path); return true; }
  catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function contained(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith("/"));
}

function receiptPath(options) {
  const output = resolve(options.output);
  const receipt = resolve(options.receipt || `${output}.realitycheck-stage.receipt.json`);
  if (contained(output, receipt)) throw new Error("stage receipt must stay outside the deployable directory");
  if (exists(receipt)) throw new Error(`stage receipt already exists: ${receipt}`);
  const parent = lstatSync(dirname(receipt));
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error("stage receipt parent must be a real directory");
  return receipt;
}

export async function runPublishStageCommand(argv, dependencies = {}) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  const output = resolve(options.output);
  const receipt = receiptPath(options);
  let staged = false;
  let receiptWritten = false;
  try {
    const value = await (dependencies.stageVerifiedPublishCapsule || stageVerifiedPublishCapsule)(options.source, output);
    staged = true;
    writeFileSync(receipt, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o644 });
    receiptWritten = true;
    const [validation] = (dependencies.validateArtifactFiles || validateArtifactFiles)([receipt]);
    if (!validation?.valid || validation.kind !== "html-note-publish-stage-receipt") {
      throw new Error(`generated stage receipt failed validation: ${validation?.errors?.join("; ") || "unsupported artifact"}`);
    }
    console.log(`Staged verified site: ${output}`);
    console.log(`Stage receipt:       ${receipt}`);
    console.log(`Files:               ${value.stage.files}`);
    console.log(`Bytes:               ${value.stage.bytes}`);
    console.log(`Deploy content ID:   ${value.source.deployContentId}`);
    console.log("RealityCheck did not upload or deploy this directory.");
    return 0;
  } catch (error) {
    if (receiptWritten) rmSync(receipt, { force: true });
    if (staged) rmSync(output, { recursive: true, force: true });
    throw error;
  }
}

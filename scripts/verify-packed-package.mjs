#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const npmExecPath = process.env.npm_execpath;

if (!npmExecPath || !existsSync(npmExecPath)) {
  throw new Error("Run this smoke test through `npm run package:smoke` so the exact npm CLI can be isolated and reused.");
}

function npm(args, { cwd, env }) {
  const result = spawnSync(process.execPath, [npmExecPath, ...args], {
    cwd,
    env,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, [
    `npm ${args.join(" ")} failed with exit code ${result.status}`,
    result.stdout,
    result.stderr,
  ].filter(Boolean).join("\n"));
  return result;
}

const temporary = mkdtempSync(join(tmpdir(), "realityhtmlcheck-packed-"));
const packDirectory = join(temporary, "pack");
const consumerDirectory = join(temporary, "consumer");
const zeroInstallDirectory = join(temporary, "zero-install");
const cacheDirectory = join(temporary, "npm-cache");

try {
  for (const directory of [packDirectory, consumerDirectory, zeroInstallDirectory, cacheDirectory]) {
    mkdirSync(directory, { recursive: true });
  }
  const isolatedEnv = {
    ...process.env,
    NODE_PATH: "",
    npm_config_audit: "false",
    npm_config_cache: cacheDirectory,
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  };

  npm(["pack", "--silent", "--pack-destination", packDirectory], {
    cwd: PROJECT_ROOT,
    env: isolatedEnv,
  });
  const archives = readdirSync(packDirectory).filter((name) => name.endsWith(".tgz"));
  assert.deepEqual(archives.length, 1, `expected one packed archive, found ${archives.join(", ") || "none"}`);
  const archive = join(packDirectory, archives[0]);

  const fixture = join(zeroInstallDirectory, "note-fixture");
  mkdirSync(join(fixture, "assets"), { recursive: true });
  writeFileSync(join(fixture, "assets", "chart.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><title>Chart</title></svg>\n', "utf8");
  writeFileSync(join(fixture, "note.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Packed note</title></head>
<body><main><h1>Packed note</h1><p>This portable HTML note contains enough readable content to prove a clean npx-style consumer can inspect a complete folder without a server, repository checkout, global install, or project configuration.</p><img src="assets/chart.svg" alt="Chart"></main></body></html>
`, "utf8");

  // `npm exec --package <tarball>` is npx's zero-install execution path. It
  // creates a disposable dependency environment instead of installing into
  // the fixture or relying on this repository's node_modules tree.
  npm([
    "exec",
    "--yes",
    `--package=${archive}`,
    "--",
    "realityhtmlcheck",
    "note",
    fixture,
    "--output",
    join(zeroInstallDirectory, "evidence"),
    "--fail-on",
    "error",
    "--language",
    "en",
  ], { cwd: zeroInstallDirectory, env: isolatedEnv });

  const reportPath = join(zeroInstallDirectory, "evidence", "latest.json");
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.equal(report.kind, "html-note-check-bundle");
  assert.equal(report.summary.score, 100);
  assert.deepEqual(report.privacy, { uploaded: false, absolutePathsPersisted: false });
  assert.equal(report.sourceModified, false);
  assert.equal(existsSync(join(zeroInstallDirectory, "evidence", "latest.html")), true);
  assert.equal(existsSync(join(fixture, "package.json")), false, "zero-install execution must not initialize or mutate the checked folder");
  assert.equal(existsSync(join(zeroInstallDirectory, "node_modules")), false, "npx-style execution must not leave a local install behind");

  npm(["init", "--yes"], { cwd: consumerDirectory, env: isolatedEnv });
  npm(["install", "--ignore-scripts", archive], { cwd: consumerDirectory, env: isolatedEnv });
  const installedRoot = join(consumerDirectory, "node_modules", "realityhtmlcheck");
  const installedPackage = JSON.parse(readFileSync(join(installedRoot, "package.json"), "utf8"));
  assert.equal(installedPackage.name, "realityhtmlcheck");
  assert.deepEqual(installedPackage.bin, {
    realityhtmlcheck: "realitycheck/scripts/audit.mjs",
    realitycheck: "realitycheck/scripts/audit.mjs",
  });
  assert.equal(existsSync(join(installedRoot, "realitycheck", "assets", "config.schema.json")), true);
  for (const documentationPath of [
    join("docs", "README.zh-CN.md"),
    join("docs", "note-compatibility.zh-CN.md"),
    join("docs", "assets", "hero.svg"),
    join("docs", "assets", "note-checker-preview.png"),
  ]) assert.equal(existsSync(join(installedRoot, documentationPath)), true, `published documentation is missing ${documentationPath}`);
  for (const command of ["realityhtmlcheck", "realitycheck"]) {
    assert.equal(
      existsSync(join(consumerDirectory, "node_modules", ".bin", command))
        || existsSync(join(consumerDirectory, "node_modules", ".bin", `${command}.cmd`)),
      true,
      `${command} bin alias was not installed`,
    );
  }

  npm(["exec", "--offline", "--", "realitycheck", "--help"], {
    cwd: consumerDirectory,
    env: isolatedEnv,
  });
  npm([
    "exec",
    "--offline",
    "--",
    "realityhtmlcheck",
    "init",
    "--profile",
    "starter",
    "--base-url",
    "http://127.0.0.1:4300",
  ], { cwd: consumerDirectory, env: isolatedEnv });
  const config = JSON.parse(readFileSync(join(consumerDirectory, "realitycheck.config.json"), "utf8"));
  assert.equal(config.$schema, "./node_modules/realityhtmlcheck/realitycheck/assets/config.schema.json");
  assert.equal(existsSync(join(consumerDirectory, config.$schema)), true, "generated schema reference must resolve in the consumer project");

  console.log(`Packed zero-install smoke passed: ${archives[0]}`);
  console.log("Verified: npx-style note check, 100/100 evidence, no local install residue, both CLI aliases, and a resolvable generated schema.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CASE_ROOT = join(ROOT, "examples", "skill-repair-case");
const AUDIT = join(ROOT, "realitycheck", "scripts", "audit.mjs");

function files(root, directory = root) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Repair case contains a symbolic link: ${relative(root, path)}`);
    if (entry.isDirectory()) result.push(...files(root, path));
    else if (entry.isFile()) result.push(path);
    else throw new Error(`Repair case contains a non-regular entry: ${relative(root, path)}`);
  }
  return result;
}

function directoryId(root) {
  const hash = createHash("sha256");
  for (const path of files(root)) {
    hash.update(relative(root, path).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function run(args) {
  const result = spawnSync(process.execPath, [AUDIT, ...args], { cwd: ROOT, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result;
}

const contract = JSON.parse(readFileSync(join(CASE_ROOT, "case.json"), "utf8"));
assert.equal(contract.kind, "realitycheck-skill-repair-case");
assert.equal(contract.sourceModified, false);
assert.ok(contract.changes.length >= 7);

const beforeRoot = join(CASE_ROOT, contract.before);
const repairedRoot = join(CASE_ROOT, contract.repaired);
const beforeId = directoryId(beforeRoot);
const temporary = mkdtempSync(join(tmpdir(), "realitycheck-skill-repair-case-"));

try {
  const beforeOutput = join(temporary, "before-evidence");
  const afterOutput = join(temporary, "after-evidence");
  run(["note", beforeRoot, "--prepare-repair", "--output", beforeOutput, "--language", "en"]);
  assert.equal(directoryId(beforeRoot), beforeId, "the before fixture was modified while preparing the repair copy");
  const before = JSON.parse(readFileSync(join(beforeOutput, "latest.json"), "utf8"));
  assert.equal(before.summary.score, contract.expected.beforeScore);
  assert.equal(before.summary.counts.error, contract.expected.beforeErrors);
  assert.equal(before.summary.counts.warning, contract.expected.beforeWarnings);
  assert.equal(before.sourceModified, false);
  const immutableRuns = readdirSync(beforeOutput, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  assert.equal(immutableRuns.length, 1);
  assert.ok(files(join(beforeOutput, immutableRuns[0].name, "repaired")).length >= files(beforeRoot).length);

  run([
    "note", repairedRoot,
    "--baseline", join(beforeOutput, "latest.json"),
    "--fail-on", "error",
    "--output", afterOutput,
    "--language", "en",
  ]);
  const after = JSON.parse(readFileSync(join(afterOutput, "latest.json"), "utf8"));
  assert.equal(after.summary.score, contract.expected.afterScore);
  assert.equal(after.summary.counts.error, contract.expected.afterErrors);
  assert.equal(after.summary.counts.warning, contract.expected.afterWarnings);
  assert.equal(after.sourceModified, false);
  assert.equal(after.comparison.counts.regressions, contract.expected.newRegressions);
  assert.ok(after.comparison.counts.resolved > 0);
  assert.equal(after.comparison.counts.unverified, 0);

  const repairedIndex = readFileSync(join(repairedRoot, "index.html"), "utf8");
  const sourceFact = readFileSync(join(repairedRoot, "sources.txt"), "utf8").match(/^PRIMARY_SOURCE=(.+)$/m)?.[1];
  const svgTitle = readFileSync(join(repairedRoot, "images", "trend.svg"), "utf8").match(/<title>([^<]+)<\/title>/)?.[1];
  const [sourceAuthor, sourceTitle] = sourceFact?.replace(/\.$/, "").split(", ", 2) || [];
  assert.ok(sourceAuthor && sourceTitle && repairedIndex.includes(sourceAuthor) && repairedIndex.includes(`<cite>${sourceTitle}</cite>`));
  assert.ok(svgTitle && repairedIndex.includes(`alt="${svgTitle}"`));
  assert.doesNotMatch(repairedIndex, /<script\b|\son[a-z]+\s*=|\{\{|TODO/i);

  console.log(`Skill repair case verified: ${before.summary.score}/100 → ${after.summary.score}/100, ${after.comparison.counts.resolved} resolved, 0 regressions.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

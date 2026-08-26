#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeHtmlNote } from "../realitycheck/scripts/note-analyzer.mjs";
import { summarizeNoteReports } from "../realitycheck/scripts/note-summary.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const realExportEvidenceRoot = join(repositoryRoot, "examples", "real-export-evidence");
const manifestPath = join(realExportEvidenceRoot, "manifest.json");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonicalLfBytes = (bytes) => Buffer.from(bytes.toString("utf8").replace(/\r\n?/g, "\n"), "utf8");

function pushProblem(problems, condition, message) {
  if (!condition) problems.push(message);
}

function resolveEvidenceFile(relativePath, problems, label) {
  const valid = typeof relativePath === "string"
    && relativePath.length > 0
    && !relativePath.includes("\\")
    && !isAbsolute(relativePath)
    && !relativePath.split("/").includes("..");
  if (!valid) {
    problems.push(`${label} must be a portable child path`);
    return null;
  }
  const absolutePath = resolve(realExportEvidenceRoot, relativePath);
  if (absolutePath === realExportEvidenceRoot || !absolutePath.startsWith(`${realExportEvidenceRoot}${sep}`)) {
    problems.push(`${label} escapes the evidence root`);
    return null;
  }
  if (!existsSync(absolutePath)) {
    problems.push(`${label} does not exist: ${relativePath}`);
    return null;
  }
  let cursor = absolutePath;
  while (cursor !== realExportEvidenceRoot) {
    if (lstatSync(cursor).isSymbolicLink()) {
      problems.push(`${label} cannot traverse a symbolic link: ${relativePath}`);
      return null;
    }
    cursor = dirname(cursor);
  }
  if (!lstatSync(absolutePath).isFile()) {
    problems.push(`${label} is not a file: ${relativePath}`);
    return null;
  }
  return absolutePath;
}

function expectedArguments(sample) {
  const source = sample.source.replace(/^pandoc-3\.8\.2\.1\//, "");
  const output = sample.output.replace(/^pandoc-3\.8\.2\.1\//, "");
  return [source, "--from=gfm", "--to=html5", "--standalone", `--output=${output}`];
}

export function readRealExportManifest() {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

export function probePandoc(executable = "pandoc") {
  const result = spawnSync(executable, ["--version"], { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) {
    return {
      available: false,
      executable,
      version: null,
      reason: result.error?.code || `exit-${result.status}`,
    };
  }
  const firstLine = String(result.stdout || "").split(/\r?\n/, 1)[0];
  const match = /^pandoc\s+([^\s]+)$/i.exec(firstLine.trim());
  let resolvedExecutable = null;
  if (isAbsolute(executable) && existsSync(executable)) resolvedExecutable = resolve(executable);
  else {
    const locator = process.platform === "win32"
      ? spawnSync("where.exe", [executable], { encoding: "utf8", windowsHide: true })
      : spawnSync("which", [executable], { encoding: "utf8" });
    const candidate = String(locator.stdout || "").split(/\r?\n/).map((value) => value.trim()).find(Boolean);
    if (locator.status === 0 && candidate && existsSync(candidate)) resolvedExecutable = resolve(candidate);
  }
  return {
    available: Boolean(match),
    executable,
    resolvedExecutable,
    version: match?.[1] || null,
    reason: match ? (resolvedExecutable ? null : "executable-path-unresolved") : "unrecognized-version-output",
  };
}

function verifyManifestShape(manifest, problems) {
  pushProblem(problems, manifest.kind === "locally-generated-real-html-export-evidence", "manifest kind is invalid");
  pushProblem(problems, manifest.schemaVersion === 1, "manifest schemaVersion must be 1");
  pushProblem(problems, manifest.evidenceBoundary?.sourceType === "locally-generated-real-export", "sourceType must identify a locally generated real export");
  pushProblem(problems, manifest.evidenceBoundary?.syntheticHtmlFixture === false, "the real export cannot be labelled as a synthetic HTML fixture");
  pushProblem(problems, manifest.evidenceBoundary?.generatedByActualTool === true, "generatedByActualTool must remain true");
  pushProblem(problems, manifest.evidenceBoundary?.containsThirdPartyUserContent === false, "third-party user content boundary must remain false");
  pushProblem(problems, manifest.evidenceBoundary?.containsPersonalData === false, "personal-data boundary must remain false");
  pushProblem(problems, manifest.evidenceBoundary?.officialCompatibilityClaim === false, "official compatibility claim boundary must remain false");
  pushProblem(problems, manifest.generator?.name === "Pandoc", "generator must be Pandoc");
  pushProblem(problems, manifest.generator?.version === "3.8.2.1", "generator version must remain the captured 3.8.2.1");
  pushProblem(problems, /^[a-f0-9]{64}$/.test(manifest.generator?.observedExecutableSha256 || ""), "generator executable SHA-256 is invalid");
  pushProblem(problems, manifest.generator?.programLicense === "GPL-2.0-or-later", "Pandoc program license boundary is invalid");
  pushProblem(problems, manifest.generator?.templateLicense === "GPL-2.0-or-later OR BSD-3-Clause", "Pandoc template license boundary is invalid");
  pushProblem(problems, manifest.generator?.binaryRedistributed === false, "manifest must not claim the Pandoc binary is redistributed");
  pushProblem(problems, manifest.generator?.thirdPartyNotice === "THIRD_PARTY_NOTICES.md", "Pandoc template notice path is invalid");
  const noticePath = resolveEvidenceFile(manifest.generator?.thirdPartyNotice, problems, "third-party notice");
  if (noticePath) {
    const notice = readFileSync(noticePath, "utf8");
    pushProblem(problems, /Copyright \(c\) 2014–2024, John MacFarlane/.test(notice), "Pandoc template copyright notice is incomplete");
    pushProblem(problems, /BSD 3-clause license/.test(notice), "Pandoc template license notice is incomplete");
  }
  pushProblem(problems, Array.isArray(manifest.samples) && manifest.samples.length === 1, "manifest must contain the single captured sample");
}

function verifySample(manifest, sample, problems) {
  pushProblem(problems, sample?.source === "pandoc-3.8.2.1/source/note.md", "sample source path is invalid");
  pushProblem(problems, sample?.output === "pandoc-3.8.2.1/generated/note.html", "sample output path is invalid");
  const sourcePath = resolveEvidenceFile(sample?.source, problems, "sample source");
  const outputPath = resolveEvidenceFile(sample?.output, problems, "sample output");
  pushProblem(problems, sample?.id === "pandoc-3.8.2.1-standalone-gfm", "sample id is invalid");
  pushProblem(problems, sample?.command?.program === "pandoc", "recorded command program must be pandoc");
  pushProblem(problems, sample?.command?.cwd === "examples/real-export-evidence/pandoc-3.8.2.1", "recorded command working directory is invalid");
  const safeArguments = sourcePath && outputPath ? expectedArguments(sample) : [];
  pushProblem(problems, JSON.stringify(sample?.command?.arguments) === JSON.stringify(safeArguments), "recorded command arguments differ from the bounded export command");
  pushProblem(problems, sample?.command?.display === `pandoc ${safeArguments.join(" ")}`, "display command differs from the executable arguments");
  if (!sourcePath || !outputPath) return { sourcePath, outputPath, observation: null };

  const sourceBytes = readFileSync(sourcePath);
  const outputBytes = readFileSync(outputPath);
  pushProblem(problems, sha256(sourceBytes) === sample.hashes?.sourceRawSha256, "source raw SHA-256 does not match the manifest");
  pushProblem(problems, sha256(outputBytes) === sample.hashes?.outputRawSha256, "generated output raw SHA-256 does not match the manifest");
  pushProblem(problems, sha256(canonicalLfBytes(outputBytes)) === sample.hashes?.outputCanonicalLfSha256, "generated output canonical-LF SHA-256 does not match the manifest");
  pushProblem(problems, sample.outputProfile?.capturedLineEndings === "CRLF", "captured output line-ending profile is invalid");

  const html = outputBytes.toString("utf8");
  const crlfCount = (html.match(/\r\n/g) || []).length;
  const isolatedLfCount = (html.match(/(?<!\r)\n/g) || []).length;
  pushProblem(problems, crlfCount > 0 && isolatedLfCount === 0, "captured output no longer has its declared CRLF byte profile");
  pushProblem(problems, /<meta\s+name="generator"\s+content="pandoc"\s*\/>/i.test(html), "generated output lacks the Pandoc generator marker");
  pushProblem(problems, /<!DOCTYPE html>/i.test(html), "generated output lacks the Pandoc standalone document shell");
  pushProblem(problems, !/[A-Za-z]:\\Users\\|\/home\/[^/]+\//i.test(html), "generated output appears to contain a local user path");

  const report = analyzeHtmlNote({ path: "note.html", html, knownFiles: ["note.html"] });
  const summary = summarizeNoteReports([report]);
  const observation = { score: summary.score, status: summary.status, counts: summary.counts };
  pushProblem(problems, JSON.stringify(observation) === JSON.stringify(sample.realityCheckExpectation), "fresh RealityCheck observation differs from the bounded manifest expectation");
  pushProblem(problems, report.findings.length === 0, "the captured export now triggers one or more deterministic findings");
  return { sourcePath, outputPath, observation, safeArguments };
}

function reproduceSample(manifest, sample, checked, executable, problems) {
  const probe = probePandoc(executable);
  if (!probe.available) {
    problems.push(`Pandoc reproduction is unavailable: ${probe.reason}`);
    return { ...probe, canonicalOutputMatched: false, rawOutputMatched: false };
  }
  if (probe.version !== manifest.generator.version) {
    problems.push(`Pandoc reproduction requires ${manifest.generator.version}, found ${probe.version}`);
    return { ...probe, canonicalOutputMatched: false, rawOutputMatched: false };
  }
  if (!probe.resolvedExecutable) {
    problems.push("Pandoc reproduction could not resolve the executable for SHA-256 verification");
    return { ...probe, executableSha256Matched: false, canonicalOutputMatched: false, rawOutputMatched: false };
  }
  const executableSha256 = sha256(readFileSync(probe.resolvedExecutable));
  const executableSha256Matched = executableSha256 === manifest.generator.observedExecutableSha256;
  if (!executableSha256Matched) {
    problems.push("Pandoc executable SHA-256 differs from the captured generator");
    return { ...probe, executableSha256, executableSha256Matched, canonicalOutputMatched: false, rawOutputMatched: false };
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), "realitycheck-real-export-"));
  try {
    const temporarySource = join(temporaryRoot, checked.safeArguments[0]);
    const outputArgument = checked.safeArguments.find((argument) => argument.startsWith("--output="));
    const temporaryOutput = join(temporaryRoot, outputArgument.slice("--output=".length));
    mkdirSync(dirname(temporarySource), { recursive: true });
    mkdirSync(dirname(temporaryOutput), { recursive: true });
    copyFileSync(checked.sourcePath, temporarySource);
    const run = spawnSync(executable, checked.safeArguments, {
      cwd: temporaryRoot,
      encoding: "utf8",
      windowsHide: true,
    });
    if (run.error || run.status !== 0 || !existsSync(temporaryOutput)) {
      problems.push(`Pandoc reproduction failed: ${run.error?.code || `exit-${run.status}`}`);
      return { ...probe, canonicalOutputMatched: false, rawOutputMatched: false };
    }
    const reproducedBytes = readFileSync(temporaryOutput);
    const canonicalOutputMatched = sha256(canonicalLfBytes(reproducedBytes)) === sample.hashes.outputCanonicalLfSha256;
    const rawOutputMatched = sha256(reproducedBytes) === sample.hashes.outputRawSha256;
    if (!canonicalOutputMatched) problems.push("Pandoc reproduction differs beyond CRLF/LF normalization");
    return {
      ...probe,
      canonicalOutputMatched,
      rawOutputMatched,
      executableSha256,
      executableSha256Matched,
      reproducedRawSha256: sha256(reproducedBytes),
      reproducedCanonicalLfSha256: sha256(canonicalLfBytes(reproducedBytes)),
    };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

export function verifyRealExportEvidence({ reproduce = false, pandocPath = "pandoc" } = {}) {
  const problems = [];
  const manifest = readRealExportManifest();
  verifyManifestShape(manifest, problems);
  const sample = manifest.samples?.[0];
  const checked = sample ? verifySample(manifest, sample, problems) : { observation: null };
  let reproduction = null;
  if (reproduce && problems.length === 0) {
    reproduction = reproduceSample(manifest, sample, checked, pandocPath, problems);
  }
  return {
    ok: problems.length === 0,
    problems,
    manifest,
    observation: checked.observation,
    reproduction,
  };
}

function cliPandocPath(args) {
  const index = args.indexOf("--pandoc");
  if (index < 0) return "pandoc";
  if (!args[index + 1]) throw new Error("--pandoc requires an executable path");
  return args[index + 1];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reproduce = process.argv.includes("--reproduce");
  try {
    const result = verifyRealExportEvidence({ reproduce, pandocPath: cliPandocPath(process.argv.slice(2)) });
    if (!result.ok) {
      console.error(`Real export evidence verification failed: ${result.problems.join("; ")}`);
      process.exitCode = 1;
    } else if (reproduce) {
      console.log(`Reproduced 1 real Pandoc ${result.reproduction.version} export with the captured executable SHA-256; canonical HTML SHA-256 matched${result.reproduction.rawOutputMatched ? " and raw bytes matched" : " after declared newline normalization"}.`);
    } else {
      console.log(`Verified 1 real Pandoc export: frozen hashes, provenance, license boundary, and RealityCheck ${result.observation.score}/100 expectation matched.`);
    }
  } catch (error) {
    console.error(`Real export evidence verification failed: ${error.message}`);
    process.exitCode = 2;
  }
}

#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeHtmlNote } from "../realitycheck/scripts/note-analyzer.mjs";
import { summarizeNoteReports } from "../realitycheck/scripts/note-summary.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const realExportEvidenceRoot = join(repositoryRoot, "examples", "real-export-evidence");
const manifestPath = join(realExportEvidenceRoot, "manifest.json");

const SAMPLE_SPECS = Object.freeze([
  Object.freeze({
    id: "pandoc-3.8.2.1-standalone-gfm",
    root: "pandoc-3.8.2.1",
    source: "pandoc-3.8.2.1/source/note.md",
    output: "pandoc-3.8.2.1/generated/note.html",
    inputs: Object.freeze([Object.freeze({ path: "pandoc-3.8.2.1/source/note.md", role: "source-markdown" })]),
    arguments: Object.freeze(["source/note.md", "--from=gfm", "--to=html5", "--standalone", "--output=generated/note.html"]),
    profile: "standalone-gfm",
  }),
  Object.freeze({
    id: "pandoc-3.8.2.1-embed-resources",
    root: "pandoc-3.8.2.1-embed-resources",
    source: "pandoc-3.8.2.1-embed-resources/source/note.md",
    output: "pandoc-3.8.2.1-embed-resources/generated/embedded-note.html",
    inputs: Object.freeze([
      Object.freeze({ path: "pandoc-3.8.2.1-embed-resources/source/note.md", role: "source-markdown" }),
      Object.freeze({ path: "pandoc-3.8.2.1-embed-resources/source/theme.css", role: "stylesheet" }),
      Object.freeze({ path: "pandoc-3.8.2.1-embed-resources/source/assets/evidence-flow.svg", role: "image" }),
    ]),
    arguments: Object.freeze([
      "source/note.md", "--from=gfm", "--to=html5", "--standalone", "--embed-resources",
      "--resource-path=source", "--css=source/theme.css",
      "--output=generated/embedded-note.html",
    ]),
    profile: "embedded-local-resources",
  }),
  Object.freeze({
    id: "pandoc-3.8.2.1-structured-note",
    root: "pandoc-3.8.2.1-structured-note",
    source: "pandoc-3.8.2.1-structured-note/source/research-note.md",
    output: "pandoc-3.8.2.1-structured-note/generated/research-note.html",
    inputs: Object.freeze([Object.freeze({ path: "pandoc-3.8.2.1-structured-note/source/research-note.md", role: "source-markdown" })]),
    arguments: Object.freeze([
      "source/research-note.md", "--from=markdown+footnotes+tex_math_dollars", "--to=html5", "--standalone",
      "--toc", "--toc-depth=3", "--number-sections", "--mathml",
      "--output=generated/research-note.html",
    ]),
    profile: "toc-footnotes-mathml",
  }),
  Object.freeze({
    id: "pandoc-3.8.2.1-multi-source",
    root: "pandoc-3.8.2.1-multi-source",
    source: "pandoc-3.8.2.1-multi-source/source/overview.md",
    output: "pandoc-3.8.2.1-multi-source/generated/combined-note.html",
    inputs: Object.freeze([
      Object.freeze({ path: "pandoc-3.8.2.1-multi-source/source/overview.md", role: "source-markdown" }),
      Object.freeze({ path: "pandoc-3.8.2.1-multi-source/source/checklist.md", role: "source-markdown" }),
    ]),
    arguments: Object.freeze([
      "source/overview.md", "source/checklist.md", "--from=gfm", "--to=html5", "--standalone",
      "--output=generated/combined-note.html",
    ]),
    profile: "multi-source-combined",
  }),
]);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonicalLfBytes = (bytes) => Buffer.from(bytes.toString("utf8").replace(/\r\n?/g, "\n"), "utf8");

function pushProblem(problems, condition, message) {
  if (!condition) problems.push(message);
}

function resolveEvidenceFile(relativePath, problems, label) {
  const valid = typeof relativePath === "string" && relativePath.length > 0 && !relativePath.includes("\\")
    && !isAbsolute(relativePath) && !relativePath.split("/").includes("..");
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

function commandDisplay(argumentsList) {
  const display = argumentsList.map((value) => /[\s"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value);
  return `pandoc ${display.join(" ")}`;
}

function detectLineEndings(bytes) {
  const text = bytes.toString("utf8");
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(?<!\r)\n/g) || []).length;
  if (crlf && !lf) return "CRLF";
  if (lf && !crlf) return "LF";
  if (!crlf && !lf) return "none";
  return "mixed";
}

function requiredOutputProfile(profile, html, problems, label) {
  if (profile === "standalone-gfm") {
    pushProblem(problems, /id="export-fidelity-note"/i.test(html), `${label} no longer contains the standalone heading`);
  } else if (profile === "embedded-local-resources") {
    pushProblem(problems, /src="data:image\/svg\+xml;base64,/i.test(html), `${label} no longer embeds the local SVG`);
    pushProblem(problems, /color:\s*#b43f24/i.test(html), `${label} no longer embeds the repository-authored stylesheet`);
    pushProblem(problems, !/(?:href|src)="(?:source\/|assets\/)/i.test(html), `${label} retains an external local resource reference`);
  } else if (profile === "toc-footnotes-mathml") {
    pushProblem(problems, /<nav id="TOC" role="doc-toc">/i.test(html), `${label} no longer contains the generated table of contents`);
    pushProblem(problems, /role="doc-endnotes"/i.test(html), `${label} no longer contains Pandoc footnotes`);
    pushProblem(problems, /<math[^>]+Math\/MathML/i.test(html), `${label} no longer contains MathML output`);
    pushProblem(problems, /data-number=/i.test(html), `${label} no longer contains numbered-section output`);
  } else if (profile === "multi-source-combined") {
    pushProblem(problems, /id="combined-operations-note"/i.test(html), `${label} lacks content from the first Markdown input`);
    pushProblem(problems, /id="release-checklist"/i.test(html), `${label} lacks content from the second Markdown input`);
  }
}

export function readRealExportManifest() {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

export function probePandoc(executable = "pandoc") {
  const result = spawnSync(executable, ["--version"], { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) {
    return { available: false, executable, version: null, reason: result.error?.code || `exit-${result.status}` };
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
    available: Boolean(match), executable, resolvedExecutable, version: match?.[1] || null,
    reason: match ? (resolvedExecutable ? null : "executable-path-unresolved") : "unrecognized-version-output",
  };
}

function verifyManifestShape(manifest, problems) {
  pushProblem(problems, manifest.kind === "locally-generated-real-html-export-evidence", "manifest kind is invalid");
  pushProblem(problems, manifest.schemaVersion === 2, "manifest schemaVersion must be 2");
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
  pushProblem(problems, Array.isArray(manifest.samples) && manifest.samples.length === SAMPLE_SPECS.length, `manifest must contain ${SAMPLE_SPECS.length} captured samples`);
}

function verifySample(sample, spec, problems) {
  const label = spec.id;
  pushProblem(problems, sample?.id === spec.id, `${label} sample id is invalid`);
  pushProblem(problems, sample?.source === spec.source, `${label} source path is invalid`);
  pushProblem(problems, sample?.output === spec.output, `${label} output path is invalid`);
  pushProblem(problems, sample?.scenarioProfile === spec.profile, `${label} scenario profile is invalid`);
  pushProblem(problems, sample?.sourceProvenance?.origin === "repository-authored-test-content", `${label} source origin is invalid`);
  pushProblem(problems, sample?.sourceProvenance?.license === "MIT", `${label} source license is invalid`);
  pushProblem(problems, sample?.sourceProvenance?.containsThirdPartyUserContent === false, `${label} source must exclude third-party user content`);
  pushProblem(problems, sample?.sourceProvenance?.containsPersonalData === false, `${label} source must exclude personal data`);
  pushProblem(problems, sample?.command?.program === "pandoc", `${label} command program must be pandoc`);
  pushProblem(problems, sample?.command?.cwd === `examples/real-export-evidence/${spec.root}`, `${label} command working directory is invalid`);
  pushProblem(problems, JSON.stringify(sample?.command?.arguments) === JSON.stringify(spec.arguments), `${label} command arguments differ from the bounded export command`);
  pushProblem(problems, sample?.command?.display === commandDisplay(spec.arguments), `${label} display command differs from the executable arguments`);

  const declaredInputs = Array.isArray(sample?.inputs) ? sample.inputs : [];
  pushProblem(problems, declaredInputs.length === spec.inputs.length, `${label} input inventory length is invalid`);
  const checkedInputs = [];
  for (let index = 0; index < spec.inputs.length; index += 1) {
    const expected = spec.inputs[index];
    const declared = declaredInputs[index];
    pushProblem(problems, declared?.path === expected.path, `${label} input ${index + 1} path is invalid`);
    pushProblem(problems, declared?.role === expected.role, `${label} input ${index + 1} role is invalid`);
    const absolutePath = resolveEvidenceFile(expected.path, problems, `${label} input ${index + 1}`);
    if (absolutePath) {
      const digest = sha256(readFileSync(absolutePath));
      pushProblem(problems, digest === declared?.rawSha256, `${label} input ${index + 1} SHA-256 does not match the manifest`);
      checkedInputs.push({ ...expected, absolutePath, rawSha256: digest });
    }
  }

  const outputPath = resolveEvidenceFile(spec.output, problems, `${label} output`);
  if (!outputPath) return { spec, inputs: checkedInputs, outputPath, observation: null, safeArguments: [...spec.arguments] };
  const outputBytes = readFileSync(outputPath);
  pushProblem(problems, sha256(outputBytes) === sample?.hashes?.outputRawSha256, `${label} generated output raw SHA-256 does not match the manifest`);
  pushProblem(problems, sha256(canonicalLfBytes(outputBytes)) === sample?.hashes?.outputCanonicalLfSha256, `${label} generated output canonical-LF SHA-256 does not match the manifest`);
  const lineEndings = detectLineEndings(outputBytes);
  pushProblem(problems, sample?.outputProfile?.capturedLineEndings === lineEndings, `${label} captured output line-ending profile is invalid`);
  pushProblem(problems, sample?.outputProfile?.crossPlatformComparison === "Normalize CRLF and CR to LF before hashing; no other transformation is allowed.", `${label} cross-platform comparison boundary is invalid`);

  const html = outputBytes.toString("utf8");
  pushProblem(problems, /<meta\s+name="generator"\s+content="pandoc"\s*\/>/i.test(html), `${label} generated output lacks the Pandoc generator marker`);
  pushProblem(problems, /<!DOCTYPE html>/i.test(html), `${label} generated output lacks the Pandoc standalone document shell`);
  pushProblem(problems, !/[A-Za-z]:\\Users\\|\/home\/[^/]+\//i.test(html), `${label} generated output appears to contain a local user path`);
  requiredOutputProfile(spec.profile, html, problems, label);

  const reportPath = basename(spec.output);
  const report = analyzeHtmlNote({ path: reportPath, html, knownFiles: [reportPath] });
  const summary = summarizeNoteReports([report]);
  const observation = { score: summary.score, status: summary.status, counts: summary.counts };
  pushProblem(problems, JSON.stringify(observation) === JSON.stringify(sample?.realityCheckExpectation), `${label} fresh RealityCheck observation differs from the bounded manifest expectation`);
  return { spec, inputs: checkedInputs, outputPath, observation, safeArguments: [...spec.arguments] };
}

function reproduceSamples(manifest, checkedSamples, executable, problems) {
  const probe = probePandoc(executable);
  if (!probe.available) {
    problems.push(`Pandoc reproduction is unavailable: ${probe.reason}`);
    return { ...probe, executableSha256Matched: false, samples: [] };
  }
  if (probe.version !== manifest.generator.version) {
    problems.push(`Pandoc reproduction requires ${manifest.generator.version}, found ${probe.version}`);
    return { ...probe, executableSha256Matched: false, samples: [] };
  }
  if (!probe.resolvedExecutable) {
    problems.push("Pandoc reproduction could not resolve the executable for SHA-256 verification");
    return { ...probe, executableSha256Matched: false, samples: [] };
  }
  const executableSha256 = sha256(readFileSync(probe.resolvedExecutable));
  const executableSha256Matched = executableSha256 === manifest.generator.observedExecutableSha256;
  if (!executableSha256Matched) {
    problems.push("Pandoc executable SHA-256 differs from the captured generator");
    return { ...probe, executableSha256, executableSha256Matched, samples: [] };
  }

  const reproduced = [];
  for (let index = 0; index < checkedSamples.length; index += 1) {
    const checked = checkedSamples[index];
    const sample = manifest.samples.find((entry) => entry.id === checked.spec.id);
    const temporaryRoot = mkdtempSync(join(tmpdir(), "realitycheck-real-export-"));
    try {
      for (const input of checked.inputs) {
        const scenarioRelative = input.path.slice(`${checked.spec.root}/`.length);
        const temporaryInput = join(temporaryRoot, scenarioRelative);
        mkdirSync(dirname(temporaryInput), { recursive: true });
        copyFileSync(input.absolutePath, temporaryInput);
      }
      const outputArgument = checked.safeArguments.find((argument) => argument.startsWith("--output="));
      const temporaryOutput = join(temporaryRoot, outputArgument.slice("--output=".length));
      mkdirSync(dirname(temporaryOutput), { recursive: true });
      const run = spawnSync(executable, checked.safeArguments, { cwd: temporaryRoot, encoding: "utf8", windowsHide: true });
      if (run.error || run.status !== 0 || !existsSync(temporaryOutput)) {
        problems.push(`${checked.spec.id} Pandoc reproduction failed: ${run.error?.code || `exit-${run.status}`}`);
        reproduced.push({ id: checked.spec.id, canonicalOutputMatched: false, rawOutputMatched: false });
        continue;
      }
      const bytes = readFileSync(temporaryOutput);
      const reproducedRawSha256 = sha256(bytes);
      const reproducedCanonicalLfSha256 = sha256(canonicalLfBytes(bytes));
      const canonicalOutputMatched = reproducedCanonicalLfSha256 === sample.hashes.outputCanonicalLfSha256;
      const rawOutputMatched = reproducedRawSha256 === sample.hashes.outputRawSha256;
      if (!canonicalOutputMatched) problems.push(`${checked.spec.id} Pandoc reproduction differs beyond CRLF/LF normalization`);
      reproduced.push({ id: checked.spec.id, canonicalOutputMatched, rawOutputMatched, reproducedRawSha256, reproducedCanonicalLfSha256 });
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
  return { ...probe, executableSha256, executableSha256Matched, samples: reproduced };
}

export function verifyRealExportEvidence({ reproduce = false, pandocPath = "pandoc" } = {}) {
  const problems = [];
  const manifest = readRealExportManifest();
  verifyManifestShape(manifest, problems);
  const declaredById = new Map();
  for (const sample of manifest.samples || []) {
    if (declaredById.has(sample?.id)) problems.push(`duplicate sample id: ${sample?.id}`);
    else declaredById.set(sample?.id, sample);
  }
  const checkedSamples = SAMPLE_SPECS.map((spec) => verifySample(declaredById.get(spec.id), spec, problems));
  const observations = Object.fromEntries(checkedSamples.map((checked) => [checked.spec.id, checked.observation]));
  let reproduction = null;
  if (reproduce && problems.length === 0) reproduction = reproduceSamples(manifest, checkedSamples, pandocPath, problems);
  return { ok: problems.length === 0, problems, manifest, observations, observation: checkedSamples[0]?.observation ?? null, reproduction };
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
      const rawMatches = result.reproduction.samples.filter((sample) => sample.rawOutputMatched).length;
      console.log(`Reproduced ${result.reproduction.samples.length} real Pandoc ${result.reproduction.version} exports with the captured executable SHA-256; every canonical HTML SHA-256 matched and ${rawMatches} raw byte output(s) matched.`);
    } else {
      const scores = Object.values(result.observations).map((observation) => observation?.score).join(", ");
      console.log(`Verified ${result.manifest.samples.length} real Pandoc exports: frozen inputs/outputs, provenance, license boundary, and fresh RealityCheck expectations matched (scores: ${scores}).`);
    }
  } catch (error) {
    console.error(`Real export evidence verification failed: ${error.message}`);
    process.exitCode = 2;
  }
}

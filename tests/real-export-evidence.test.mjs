import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { probePandoc, readRealExportManifest, verifyRealExportEvidence } from "../scripts/real-export-evidence.mjs";

const expectedProfiles = new Set([
  "standalone-gfm",
  "embedded-local-resources",
  "toc-footnotes-mathml",
  "multi-source-combined",
]);

test("real export evidence contains four actual-tool scenarios with bounded repository-owned inputs", () => {
  const manifest = readRealExportManifest();
  assert.equal(manifest.kind, "locally-generated-real-html-export-evidence");
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.evidenceBoundary.sourceType, "locally-generated-real-export");
  assert.equal(manifest.evidenceBoundary.syntheticHtmlFixture, false);
  assert.equal(manifest.evidenceBoundary.generatedByActualTool, true);
  assert.equal(manifest.evidenceBoundary.containsThirdPartyUserContent, false);
  assert.equal(manifest.evidenceBoundary.containsPersonalData, false);
  assert.equal(manifest.evidenceBoundary.officialCompatibilityClaim, false);
  assert.equal(manifest.samples.length, 4);
  assert.deepEqual(new Set(manifest.samples.map((sample) => sample.scenarioProfile)), expectedProfiles);
  for (const sample of manifest.samples) {
    assert.equal(sample.sourceProvenance.origin, "repository-authored-test-content");
    assert.equal(sample.sourceProvenance.license, "MIT");
    assert.equal(sample.sourceProvenance.containsThirdPartyUserContent, false);
    assert.equal(sample.sourceProvenance.containsPersonalData, false);
    assert.ok(sample.inputs.length >= 1);
    assert.match(sample.command.display, /^pandoc source\//);
    for (const input of sample.inputs) assert.match(input.rawSha256, /^[a-f0-9]{64}$/);
  }
});

test("frozen Pandoc inputs, outputs, commands, licenses, and fresh RealityCheck analyses agree", () => {
  const result = verifyRealExportEvidence();
  assert.equal(result.ok, true, result.problems.join("\n"));
  assert.deepEqual(result.problems, []);
  assert.equal(Object.keys(result.observations).length, 4);
  for (const observation of Object.values(result.observations)) {
    assert.deepEqual(observation, {
      score: 100,
      status: "ready",
      counts: { error: 0, warning: 0, advice: 0, autoFixable: 0 },
    });
  }
  assert.match(result.manifest.generator.observedExecutableSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.manifest.generator.binaryRedistributed, false);
  assert.equal(result.manifest.generator.templateLicense, "GPL-2.0-or-later OR BSD-3-Clause");
  for (const sample of result.manifest.samples) {
    for (const digest of Object.values(sample.hashes)) assert.match(digest, /^[a-f0-9]{64}$/);
  }

  const notice = readFileSync("examples/real-export-evidence/THIRD_PARTY_NOTICES.md", "utf8");
  assert.match(notice, /Copyright \(c\) 2014–2024, John MacFarlane/);
  assert.match(notice, /BSD 3-clause license/);
  const attributes = readFileSync(".gitattributes", "utf8");
  assert.match(attributes, /\*\.css text eol=lf/);
  assert.match(attributes, /examples\/real-export-evidence\/\*\*\/generated\/\*\.html -text whitespace=cr-at-eol/);
});

test("the captured outputs prove distinct standalone, embedded, structured, and multi-source shapes", () => {
  const standalone = readFileSync("examples/real-export-evidence/pandoc-3.8.2.1/generated/note.html", "utf8");
  const embedded = readFileSync("examples/real-export-evidence/pandoc-3.8.2.1-embed-resources/generated/embedded-note.html", "utf8");
  const structured = readFileSync("examples/real-export-evidence/pandoc-3.8.2.1-structured-note/generated/research-note.html", "utf8");
  const combined = readFileSync("examples/real-export-evidence/pandoc-3.8.2.1-multi-source/generated/combined-note.html", "utf8");
  for (const output of [standalone, embedded, structured, combined]) {
    assert.match(output, /<meta name="generator" content="pandoc" \/>/);
    assert.doesNotMatch(output, /[A-Za-z]:\\Users\\|\/home\/[^/]+\//i);
  }
  assert.match(embedded, /src="data:image\/svg\+xml;base64,/);
  assert.match(embedded, /color:\s*#b43f24/);
  assert.match(structured, /<nav id="TOC" role="doc-toc">/);
  assert.match(structured, /role="doc-endnotes"/);
  assert.match(structured, /<math[^>]+Math\/MathML/);
  assert.match(combined, /id="combined-operations-note"/);
  assert.match(combined, /id="release-checklist"/);
});

test("verification CLI does not require Pandoc or rewrite any captured export", () => {
  const result = spawnSync(process.execPath, ["scripts/real-export-evidence.mjs", "--verify"], { encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Verified 4 real Pandoc exports/);
  assert.match(result.stdout, /scores: 100, 100, 100, 100/);
});

test("CI downloads a hash-pinned official Pandoc build and requires real reproduction", () => {
  const workflow = readFileSync(".github/workflows/validate.yml", "utf8");
  assert.match(workflow, /reproduce-real-pandoc-exports:/);
  assert.match(workflow, /runs-on: windows-latest/);
  assert.match(workflow, /jgm\/pandoc\/releases\/download\/3\.8\.2\.1\/pandoc-3\.8\.2\.1-windows-x86_64\.zip/);
  assert.match(workflow, /ded73890567ae71b945c8b36b8b33f89b5ed7357a9156a233445b46f92a5bc82/);
  assert.match(workflow, /real-export-evidence\.mjs --reproduce --pandoc/);
});

const pandocExecutable = process.env.REAL_EXPORT_PANDOC || "pandoc";
const localPandoc = probePandoc(pandocExecutable);
test("all four recorded commands reproduce with the exact captured Pandoc executable when available", {
  skip: localPandoc.version === "3.8.2.1" ? false : `requires Pandoc 3.8.2.1; ${localPandoc.version || localPandoc.reason}`,
}, () => {
  const result = verifyRealExportEvidence({ reproduce: true, pandocPath: pandocExecutable });
  assert.equal(result.ok, true, result.problems.join("\n"));
  assert.equal(result.reproduction.available, true);
  assert.equal(result.reproduction.version, "3.8.2.1");
  assert.equal(result.reproduction.executableSha256Matched, true);
  assert.equal(result.reproduction.executableSha256, result.manifest.generator.observedExecutableSha256);
  assert.equal(result.reproduction.samples.length, 4);
  assert.ok(result.reproduction.samples.every((sample) => sample.canonicalOutputMatched));
  if (process.platform === "win32") assert.ok(result.reproduction.samples.every((sample) => sample.rawOutputMatched));
});

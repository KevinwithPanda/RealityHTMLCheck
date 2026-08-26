import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  probePandoc,
  readRealExportManifest,
  verifyRealExportEvidence,
} from "../scripts/real-export-evidence.mjs";

test("real export evidence is distinct from synthetic-like fixtures and has a bounded privacy claim", () => {
  const manifest = readRealExportManifest();
  assert.equal(manifest.kind, "locally-generated-real-html-export-evidence");
  assert.equal(manifest.evidenceBoundary.sourceType, "locally-generated-real-export");
  assert.equal(manifest.evidenceBoundary.syntheticHtmlFixture, false);
  assert.equal(manifest.evidenceBoundary.generatedByActualTool, true);
  assert.equal(manifest.evidenceBoundary.containsThirdPartyUserContent, false);
  assert.equal(manifest.evidenceBoundary.containsPersonalData, false);
  assert.equal(manifest.evidenceBoundary.officialCompatibilityClaim, false);
  assert.equal(manifest.samples.length, 1);
  assert.match(manifest.samples[0].command.display, /^pandoc source\/note\.md /);
});

test("checked-in Pandoc output, hashes, command, license boundary, and fresh analysis agree", () => {
  const result = verifyRealExportEvidence();
  assert.equal(result.ok, true, result.problems.join("\n"));
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.observation, {
    score: 100,
    status: "ready",
    counts: { error: 0, warning: 0, advice: 0, autoFixable: 0 },
  });
  const manifest = result.manifest;
  assert.match(manifest.generator.observedExecutableSha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.generator.binaryRedistributed, false);
  assert.equal(manifest.generator.templateLicense, "GPL-2.0-or-later OR BSD-3-Clause");
  for (const digest of Object.values(manifest.samples[0].hashes)) assert.match(digest, /^[a-f0-9]{64}$/);

  const output = readFileSync("examples/real-export-evidence/pandoc-3.8.2.1/generated/note.html", "utf8");
  assert.match(output, /<meta name="generator" content="pandoc" \/>/);
  assert.doesNotMatch(output, /[A-Za-z]:\\Users\\|\/home\/[^/]+\//i);
  const notice = readFileSync("examples/real-export-evidence/THIRD_PARTY_NOTICES.md", "utf8");
  assert.match(notice, /Copyright \(c\) 2014–2024, John MacFarlane/);
  assert.match(notice, /BSD 3-clause license/);
  const attributes = readFileSync(".gitattributes", "utf8");
  assert.match(attributes, /examples\/real-export-evidence\/\*\*\/generated\/\*\.html -text whitespace=cr-at-eol/);
});

test("verification CLI does not require Pandoc or rewrite the captured export", () => {
  const result = spawnSync(process.execPath, ["scripts/real-export-evidence.mjs", "--verify"], { encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Verified 1 real Pandoc export/);
  assert.match(result.stdout, /RealityCheck 100\/100 expectation matched/);
});

const pandocExecutable = process.env.REAL_EXPORT_PANDOC || "pandoc";
const localPandoc = probePandoc(pandocExecutable);
test("the recorded command reproduces the captured HTML with the exact Pandoc version when available", {
  skip: localPandoc.version === "3.8.2.1" ? false : `requires Pandoc 3.8.2.1; ${localPandoc.version || localPandoc.reason}`,
}, () => {
  const result = verifyRealExportEvidence({ reproduce: true, pandocPath: pandocExecutable });
  assert.equal(result.ok, true, result.problems.join("\n"));
  assert.equal(result.reproduction.available, true);
  assert.equal(result.reproduction.version, "3.8.2.1");
  assert.equal(result.reproduction.executableSha256Matched, true);
  assert.equal(result.reproduction.executableSha256, result.manifest.generator.observedExecutableSha256);
  assert.equal(result.reproduction.canonicalOutputMatched, true);
  if (process.platform === "win32") assert.equal(result.reproduction.rawOutputMatched, true);
});

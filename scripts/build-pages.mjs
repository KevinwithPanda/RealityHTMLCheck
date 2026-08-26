#!/usr/bin/env node

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyCompatibilityArtifacts } from "./note-compatibility-evidence.mjs";
import { verifyRealExportEvidence } from "./real-export-evidence.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "_site");
const copy = (source, destination) => {
  const target = join(output, destination);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(root, source), target, { recursive: true });
};

const compatibility = verifyCompatibilityArtifacts();
if (!compatibility.ok) throw new Error(`Representative note compatibility evidence is stale: ${compatibility.problems.join("; ")}`);
const realExport = verifyRealExportEvidence();
if (!realExport.ok) throw new Error(`Real export evidence is invalid: ${realExport.problems.join("; ")}`);

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
copy("site", ".");
copy("docs/assets", "assets");
copy("realitycheck/assets/icon.svg", "assets/icon.svg");
copy("realitycheck/scripts/note-analyzer.mjs", "note-analyzer.mjs");
copy("realitycheck/scripts/note-package.mjs", "note-package.mjs");
copy("realitycheck/scripts/note-summary.mjs", "note-summary.mjs");
copy("realitycheck/scripts/note-scope.mjs", "note-scope.mjs");
copy("realitycheck/scripts/note-compare.mjs", "note-compare.mjs");
copy("realitycheck/scripts/note-comparison-report.mjs", "note-comparison-report.mjs");
copy("realitycheck/scripts/note-ruleset.mjs", "note-ruleset.mjs");
copy("examples/public-evidence", "evidence");
copy("examples/reference-run", "reference");
copy("examples/note-compatibility", "evidence/note-compatibility");
copy("examples/real-export-evidence", "evidence/real-export");
copy("examples/journey-lab", "labs/journey");
copy("examples/link-lab", "labs/links");
copy("examples/network-lab", "labs/network");
copy("examples/metadata-lab", "labs/metadata");
copy("examples/visual-regression-lab", "labs/visual");
copy("examples/security-lab", "labs/security");
copy("examples/privacy-lab", "labs/privacy");
copy("examples/accessibility-lab", "labs/accessibility");
copy("examples/viewport-lab", "labs/viewport");
copy("examples/policy-review-lab", "labs/policy-review");
copy("examples/issue-drafts-lab", "labs/issue-drafts");
// The committed release-decision artifact preserves the source-relative paths
// used when it was generated. Publish matching aliases so those immutable
// evidence links remain reviewable without rewriting the artifact.
copy("examples/policy-review-lab", "labs/policy-review-lab");
copy("examples/issue-drafts-lab", "labs/issue-drafts-lab");
copy("examples/release-decision-lab", "labs/release-decision");
copy("examples/audit-plan-lab", "labs/audit-plan");
copy("examples/reference-run", "labs/reference-run");
writeFileSync(join(output, ".nojekyll"), "", "utf8");

const latest = ["viewport", "journey", "visual", "network", "links", "metadata", "security", "security-headers-broken", "security-headers-fixed", "privacy", "accessibility"].map((kind) => {
  const value = JSON.parse(readFileSync(join(output, "evidence", kind, "latest.json"), "utf8"));
  return `${kind}=${value.score}`;
});
console.log(`Built GitHub Pages site at ${output}`);
console.log(`Published evidence: ${latest.join(", ")}`);

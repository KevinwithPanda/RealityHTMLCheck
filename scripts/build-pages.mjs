#!/usr/bin/env node

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "_site");
const copy = (source, destination) => {
  const target = join(output, destination);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(root, source), target, { recursive: true });
};

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
copy("site", ".");
copy("docs/assets", "assets");
copy("realitycheck/assets/icon.svg", "assets/icon.svg");
copy("examples/public-evidence", "evidence");
copy("examples/reference-run", "reference");
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
copy("examples/release-decision-lab", "labs/release-decision");
copy("examples/reference-run", "labs/reference-run");
writeFileSync(join(output, ".nojekyll"), "", "utf8");

const latest = ["viewport", "journey", "visual", "network", "links", "metadata", "security", "privacy", "accessibility"].map((kind) => {
  const value = JSON.parse(readFileSync(join(output, "evidence", kind, "latest.json"), "utf8"));
  return `${kind}=${value.score}`;
});
console.log(`Built GitHub Pages site at ${output}`);
console.log(`Published evidence: ${latest.join(", ")}`);

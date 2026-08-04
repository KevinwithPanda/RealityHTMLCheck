import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function coveredByPackageFiles(path, entries) {
  return entries.some((entry) => {
    if (entry === path || path.startsWith(`${entry}/`)) return true;
    const match = entry.match(/^(.*)\/\*\.([A-Za-z0-9]+)$/);
    if (!match) return false;
    const directory = path.slice(0, path.lastIndexOf("/"));
    return directory === match[1] && path.endsWith(`.${match[2]}`);
  });
}

test("npm publication whitelist covers every security and governance runtime surface", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const required = [
    "realitycheck/SKILL.md",
    "realitycheck/scripts/audit.mjs",
    "realitycheck/scripts/visual-regression.mjs",
    "realitycheck/scripts/evidence-attestation.mjs",
    "realitycheck/scripts/evidence-trust.mjs",
    "realitycheck/scripts/evidence-trust-report.mjs",
    "realitycheck/assets/evidence-manifest.schema.json",
    "realitycheck/assets/evidence-attestation.schema.json",
    "realitycheck/assets/evidence-trust.schema.json",
    "realitycheck/assets/evidence-trust-report.schema.json",
    "realitycheck/assets/risk-register.schema.json",
    "README.md",
    "LICENSE",
  ];
  for (const path of required) {
    assert.equal(existsSync(path), true, `${path} is missing`);
    assert.equal(coveredByPackageFiles(path, packageJson.files), true, `${path} is omitted by package.json files`);
  }
  assert.equal(packageJson.files.some((entry) => entry.includes(".realitycheck")), false, "generated local evidence must not be published");
  assert.equal(packageJson.files.some((entry) => entry.includes("private")), false, "private-key material must not be published");
});

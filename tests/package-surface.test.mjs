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
  assert.equal(packageJson.scripts.realitycheck, "node realitycheck/scripts/audit.mjs");
  const required = [
    "realitycheck/SKILL.md",
    "realitycheck/scripts/audit.mjs",
    "realitycheck/scripts/note-analyzer.mjs",
    "realitycheck/scripts/note-package.mjs",
    "realitycheck/scripts/note-summary.mjs",
    "realitycheck/scripts/note-check.mjs",
    "realitycheck/scripts/note-github-summary.mjs",
    "realitycheck/scripts/action-paths.mjs",
    "realitycheck/scripts/demo-server.mjs",
    "realitycheck/scripts/github-summary.mjs",
    "realitycheck/scripts/policy-review.mjs",
    "realitycheck/scripts/issue-drafts.mjs",
    "realitycheck/scripts/release-decision.mjs",
    "realitycheck/scripts/audit-plan.mjs",
    "realitycheck/scripts/security-headers.mjs",
    "realitycheck/scripts/visual-regression.mjs",
    "realitycheck/scripts/evidence-attestation.mjs",
    "realitycheck/scripts/evidence-trust.mjs",
    "realitycheck/scripts/evidence-trust-report.mjs",
    "realitycheck/assets/evidence-manifest.schema.json",
    "realitycheck/assets/evidence-attestation.schema.json",
    "realitycheck/assets/evidence-trust.schema.json",
    "realitycheck/assets/evidence-trust-report.schema.json",
    "realitycheck/assets/risk-register.schema.json",
    "realitycheck/assets/policy-review.schema.json",
    "realitycheck/assets/issue-drafts.schema.json",
    "realitycheck/assets/release-decision.schema.json",
    "realitycheck/assets/audit-plan.schema.json",
    "realitycheck/assets/demo/index.html",
    "realitycheck/assets/demo/styles.css",
    "realitycheck/assets/demo/app.js",
    "realitycheck/assets/demo/api/orders.json",
    "realitycheck/references/html-notes.md",
    "README.md",
    "LICENSE",
  ];
  for (const path of required) {
    assert.equal(existsSync(path), true, `${path} is missing`);
    assert.equal(coveredByPackageFiles(path, packageJson.files), true, `${path} is omitted by package.json files`);
  }
  assert.equal(packageJson.files.some((entry) => entry.includes(".realitycheck")), false, "generated local evidence must not be published");
  assert.equal(packageJson.files.some((entry) => entry.includes("private")), false, "private-key material must not be published");
  assert.equal(packageJson.scripts.note, "node realitycheck/scripts/audit.mjs note");
});

test("public project metadata matches the current supported release and community boundary", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const security = readFileSync("SECURITY.md", "utf8");
  const supportedLine = "latest `" + packageJson.version.replace(/\.\d+$/, ".x") + "` release";
  assert.ok(security.includes(supportedLine), `SECURITY.md must include ${supportedLine}`);
  for (const path of ["CODE_OF_CONDUCT.md", "CONTRIBUTING.md", "SECURITY.md", "SUPPORT.md"]) {
    assert.equal(existsSync(path), true, `${path} is missing`);
  }
  const readme = readFileSync("README.md", "utf8");
  assert.match(readme, /actions\/workflows\/validate\.yml\/badge\.svg/);
  assert.match(readme, /SUPPORT\.md/);
  const issueConfig = readFileSync(".github/ISSUE_TEMPLATE/config.yml", "utf8");
  assert.match(issueConfig, /SUPPORT\.md/);
  assert.match(issueConfig, /security\/policy/);
});

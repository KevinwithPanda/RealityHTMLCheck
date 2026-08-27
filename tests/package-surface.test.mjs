import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

test("the supported full test commands serialize real-browser suites", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const nodeCommand = "node --test --test-concurrency=1 tests/*.test.mjs";
  assert.equal(packageJson.scripts["test:node"], nodeCommand);
  assert.equal(packageJson.scripts.test.endsWith(`&& ${nodeCommand}`), true);
});

test("npm publication whitelist covers every security and governance runtime surface", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts.realitycheck, "node realitycheck/scripts/audit.mjs");
  const required = [
    "docs/README.zh-CN.md",
    "docs/note-compatibility.zh-CN.md",
    "docs/assets/hero.svg",
    "docs/assets/note-checker-preview.png",
    "realitycheck/SKILL.md",
    "realitycheck/scripts/audit.mjs",
    "realitycheck/scripts/note-analyzer.mjs",
    "realitycheck/scripts/note-package.mjs",
    "realitycheck/scripts/note-summary.mjs",
    "realitycheck/scripts/note-scope.mjs",
    "realitycheck/scripts/note-compare.mjs",
    "realitycheck/scripts/note-comparison-report.mjs",
    "realitycheck/scripts/note-check.mjs",
    "realitycheck/scripts/note-github-summary.mjs",
    "realitycheck/scripts/action-paths.mjs",
    "realitycheck/scripts/action-publish-result.mjs",
    "realitycheck/scripts/note-publish-github-summary.mjs",
    "realitycheck/scripts/note-publish-stage.mjs",
    "realitycheck/scripts/note-publish-stage-command.mjs",
    "realitycheck/scripts/note-deploy-verify.mjs",
    "realitycheck/scripts/note-deploy-browser.mjs",
    "realitycheck/scripts/note-deploy-report.mjs",
    "realitycheck/scripts/note-deploy-command.mjs",
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
    "realitycheck/assets/html-note-check-bundle.schema.json",
    "realitycheck/assets/html-note-check-comparison.schema.json",
    "realitycheck/assets/html-note-publish-proof.schema.json",
    "realitycheck/assets/html-note-publish-receipt.schema.json",
    "realitycheck/assets/html-note-publish-browser-proof.schema.json",
    "realitycheck/assets/html-note-publish-technical-report.schema.json",
    "realitycheck/assets/html-note-publish-command-result.schema.json",
    "realitycheck/assets/html-note-publish-stage-receipt.schema.json",
    "realitycheck/assets/html-note-deployment-browser-proof.schema.json",
    "realitycheck/assets/html-note-deployment-receipt.schema.json",
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

test("top-level CLI identifies the note-first product and prints its exact version", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const help = spawnSync(process.execPath, ["realitycheck/scripts/audit.mjs", "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /check HTML notes, prove live deployments, and stress authorized Web apps with evidence/);
  assert.ok(help.stdout.indexOf("realitycheck note <FILE|DIRECTORY>") < help.stdout.indexOf("realitycheck demo"));
  assert.match(help.stdout, /realitycheck materialize <PUBLISH_RUN>/);
  assert.match(help.stdout, /realitycheck verify-deploy <PUBLISH_RUN> <HTTP_OR_HTTPS_BASE_URL\/>/);
  assert.match(help.stdout, /-V, --version/);
  for (const flag of ["--version", "-V"]) {
    const version = spawnSync(process.execPath, ["realitycheck/scripts/audit.mjs", flag], { encoding: "utf8" });
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stdout.trim(), packageJson.version);
  }
});

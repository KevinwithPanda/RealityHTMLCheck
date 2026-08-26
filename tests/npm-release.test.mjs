import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));

test("npm package has a memorable npx entry and complete public metadata", () => {
  assert.equal(packageJson.name, "realityhtmlcheck");
  assert.deepEqual(packageJson.bin, {
    realityhtmlcheck: "realitycheck/scripts/audit.mjs",
    realitycheck: "realitycheck/scripts/audit.mjs",
  });
  assert.equal(packageJson.scripts.note, "node realitycheck/scripts/audit.mjs note");
  assert.equal(packageJson.scripts["package:smoke"], "node scripts/verify-packed-package.mjs");
  assert.equal(packageJson.repository.type, "git");
  assert.equal(packageJson.repository.url, "git+https://github.com/KevinwithPanda/RealityHTMLCheck.git");
  assert.equal(packageJson.homepage, "https://kevinwithpanda.github.io/RealityHTMLCheck/");
  assert.equal(packageJson.bugs.url, "https://github.com/KevinwithPanda/RealityHTMLCheck/issues");
  assert.deepEqual(packageJson.publishConfig, {
    access: "public",
    provenance: true,
    registry: "https://registry.npmjs.org/",
  });
  assert.equal(packageLock.name, packageJson.name);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[""].name, packageJson.name);
  assert.deepEqual(packageLock.packages[""].bin, packageJson.bin);
});

test("generated project configuration resolves the renamed installed schema", () => {
  const configSource = readFileSync("realitycheck/scripts/config.mjs", "utf8");
  const profilesTest = readFileSync("tests/profiles.test.mjs", "utf8");
  const expected = "./node_modules/realityhtmlcheck/realitycheck/assets/config.schema.json";
  assert.ok(configSource.includes(expected));
  assert.ok(profilesTest.includes(expected));
  assert.doesNotMatch(configSource, /realitycheck-web-audit/);
});

test("release workflow is manual by default and requires tag, confirmation, checksum, environments, and OIDC", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");
  assert.match(workflow, /^\s{2}workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request|release):/m);
  assert.match(workflow, /default: verify/);
  assert.match(workflow, /- github-release[\s\S]*- npm-publish/);
  assert.match(workflow, /refs\/tags\/\$\{expectedTag\}/);
  assert.match(workflow, /RELEASE_CONFIRMATION !== expectedConfirmation/);
  assert.match(workflow, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/);
  assert.match(workflow, /npm run package:smoke/);
  assert.match(workflow, /sha256sum --check SHA256SUMS/);
  assert.match(workflow, /--verify-tag/);
  assert.match(workflow, /gh release download "\$RELEASE_TAG"[\s\S]*cmp "dist\/\$TARBALL" "released\/\$TARBALL"/);
  assert.match(workflow, /environment: release/);
  assert.match(workflow, /name: npm/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /package-manager-cache: false/);
  assert.match(workflow, /npm publish "\$TARBALL" --access public --provenance/);
  assert.doesNotMatch(workflow, /NPM_TOKEN|NODE_AUTH_TOKEN|npm_[A-Za-z0-9_]*token/i);
});

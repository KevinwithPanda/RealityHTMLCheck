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
  assert.ok(packageJson.files.includes("docs/assets"));
  assert.ok(packageJson.files.includes("docs/README.zh-CN.md"));
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

test("release workflow is browser-dispatchable and binds publication to an exact remote tag", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");
  assert.match(workflow, /^\s{2}workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request|release):/m);
  assert.match(workflow, /default: verify/);
  assert.match(workflow, /- github-release[\s\S]*- npm-publish/);
  assert.match(workflow, /release-tag:/);
  assert.match(workflow, /leave empty for verify mode/);
  assert.match(workflow, /verify\|github-release\|npm-publish/);
  assert.match(workflow, /Unsupported release mode/);
  assert.match(workflow, /release-tag is only valid for github-release or npm-publish mode/);
  assert.match(workflow, /\^v\(0\|\[1-9\]\[0-9\]\*\)\\\.\(0\|\[1-9\]\[0-9\]\*\)\\\.\(0\|\[1-9\]\[0-9\]\*\)\$/);
  assert.match(workflow, /Publishing must be dispatched from the default branch/);
  assert.match(workflow, /test "\$DISPATCH_REF" != "refs\/heads\/\$DEFAULT_BRANCH"/);
  assert.match(workflow, /"\+\$tag_ref:\$tag_ref"/);
  assert.match(workflow, /git rev-parse --verify "\$\{tag_ref\}\^\{commit\}"/);
  assert.match(workflow, /git checkout --detach "\$tag_commit"/);
  assert.match(workflow, /release-tag must exactly match package\.json/);
  assert.match(workflow, /Checkout does not match peeled tag commit/);
  assert.match(workflow, /RELEASE_TAGS_IMMUTABLE/);
  assert.match(workflow, /protected immutable release tags/);
  assert.match(workflow, /RELEASE_CONFIRMATION !== expectedConfirmation/);
  assert.match(workflow, /git merge-base --is-ancestor "\$RESOLVED_TAG_COMMIT" refs\/remotes\/origin\/main/);
  assert.doesNotMatch(workflow, /merge-base --is-ancestor "\$GITHUB_SHA"/);
  assert.match(workflow, /tag-commit: \$\{\{ steps\.metadata\.outputs\.tag-commit \}\}/);
  assert.equal((workflow.match(/git ls-remote --exit-code/g) || []).length, 4);
  assert.equal((workflow.match(/Remote release tag changed after verification/g) || []).length, 2);
  assert.match(workflow, /Remote tag changed immediately before GitHub Release creation/);
  assert.match(workflow, /Remote tag changed immediately before npm publication/);
});

test("release jobs consume one candidate and keep write and OIDC permissions isolated", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");
  assert.match(workflow, /npm run package:smoke/);
  assert.match(workflow, /sha256sum --check SHA256SUMS/);
  assert.match(workflow, /--verify-tag/);
  assert.match(workflow, /gh release download "\$RELEASE_TAG"[\s\S]*cmp "dist\/\$TARBALL" "released\/\$TARBALL"/);
  assert.equal((workflow.match(/name: realityhtmlcheck-\$\{\{ needs\.verify\.outputs\.package-version \}\}/g) || []).length, 2);
  assert.match(workflow, /verify:[\s\S]*?runs-on: ubuntu-latest[\s\S]*?outputs:/);
  assert.match(workflow, /github-release:[\s\S]*?permissions:\n\s+contents: write/);
  assert.match(workflow, /npm-publish:[\s\S]*?permissions:\n\s+contents: read\n\s+id-token: write/);
  assert.match(workflow, /environment: release/);
  assert.match(workflow, /name: npm/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /package-manager-cache: false/);
  assert.match(workflow, /npm publish "\$TARBALL" --access public --provenance/);
  assert.doesNotMatch(workflow, /NPM_TOKEN|NODE_AUTH_TOKEN|npm_[A-Za-z0-9_]*token/i);
});

test("maintainer release guide names the authenticated npm bootstrap boundary", () => {
  const guide = readFileSync("docs/maintainer-release.md", "utf8");
  assert.match(guide, /first npm publication cannot be completed anonymously/i);
  assert.match(guide, /package must exist before this repository's OIDC-only `npm-publish` job/i);
  assert.match(guide, /enable 2FA/i);
  assert.match(guide, /workflow filename: `release\.yml`/);
  assert.match(guide, /environment: `npm`/);
  assert.match(guide, /allowed action: `npm publish`/);
  assert.match(guide, /Never commit an npm token/i);
  assert.match(guide, /same `verify` job/);
  assert.match(guide, /RELEASE_TAGS_IMMUTABLE=true/);
  assert.match(guide, /protected immutable tags close the residual move-tag race/i);
});

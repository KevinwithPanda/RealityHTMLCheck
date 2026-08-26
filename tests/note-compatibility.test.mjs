import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  buildCompatibilityMatrix,
  renderCompatibilityPage,
  verifyCompatibilityArtifacts,
} from "../scripts/note-compatibility-evidence.mjs";

test("representative export evidence is regenerated from hashed synthetic fixtures", () => {
  const matrix = buildCompatibilityMatrix();
  assert.deepEqual(matrix.families, ["Notion-like", "Obsidian-like", "Jupyter-like", "Quarto-like"]);
  assert.deepEqual(matrix.summary, {
    familyCount: 4,
    fixtureCount: 7,
    caseCount: 4,
    allExpectationsMatched: true,
  });
  assert.equal(matrix.evidenceBoundary.sourceType, "synthetic-representative");
  assert.equal(matrix.evidenceBoundary.containsOfficialVendorExports, false);
  assert.equal(matrix.evidenceBoundary.officialCompatibilityClaim, false);
  assert.equal(matrix.evidenceBoundary.browserRuntimeTested, false);
  assert.ok(matrix.fixtures.every((fixture) => fixture.sourceType === "synthetic-representative"));
  assert.ok(matrix.fixtures.every((fixture) => fixture.expectationMatched));
  assert.ok(matrix.fixtures.every((fixture) => /^[a-f0-9]{64}$/.test(fixture.sourceDigestSha256)));
  assert.equal(new Set(matrix.fixtures.map((fixture) => fixture.sourceDigestSha256)).size, matrix.fixtures.length);
});

test("matrix proves concrete portability, navigation, script-review, and CSS dependency outcomes", () => {
  const matrix = buildCompatibilityMatrix();
  const fixtures = new Map(matrix.fixtures.map((fixture) => [fixture.id, fixture]));
  assert.deepEqual(fixtures.get("notion-like-before").detectedRules, ["missing-local-file"]);
  assert.deepEqual(fixtures.get("notion-like-after").detectedRules, []);
  assert.deepEqual(fixtures.get("obsidian-like-before").detectedRules, ["broken-cross-document-fragment"]);
  assert.deepEqual(fixtures.get("obsidian-like-after").detectedRules, []);
  assert.deepEqual(fixtures.get("jupyter-like-review").detectedRules, ["executable-script"]);
  assert.deepEqual(fixtures.get("quarto-like-before").detectedRules, ["css-missing-local-file", "external-css-wide-fixed-layout"]);
  assert.deepEqual(fixtures.get("quarto-like-after").detectedRules, []);
  assert.equal(fixtures.get("notion-like-before").status, "needs-fix");
  assert.equal(fixtures.get("jupyter-like-review").status, "review");
  assert.equal(fixtures.get("quarto-like-after").status, "ready");
  assert.ok(matrix.cases.every((item) => item.expectationMatched));
  assert.equal(matrix.cases.filter((item) => item.outcome === "repaired-copy-verified").length, 3);
  assert.equal(matrix.cases.filter((item) => item.outcome === "review-intended-interactivity").length, 1);
  assert.deepEqual(matrix.cases.find((item) => item.id === "nested-css-repair").resolvedRules, ["css-missing-local-file", "external-css-wide-fixed-layout"]);
  assert.ok(matrix.fixtures.every((fixture) => fixture.findings.every((finding) => finding.id && finding.ruleId && finding.title.en && finding.remediation.zhCN)));
});

test("checked-in JSON and bilingual public page match a fresh analysis byte for byte", () => {
  const verification = verifyCompatibilityArtifacts();
  assert.deepEqual(verification.problems, []);
  assert.equal(verification.ok, true);
  const checkedIn = JSON.parse(readFileSync("examples/note-compatibility/compatibility-matrix.json", "utf8"));
  assert.deepEqual(checkedIn, verification.matrix);
  const page = readFileSync("site/compatibility.html", "utf8");
  assert.equal(page, renderCompatibilityPage(verification.matrix));
  assert.match(page, /Compatibility claims you can rerun/);
  assert.match(page, /可以重新运行的兼容性证据/);
  assert.match(page, /not copied vendor exports/);
  assert.match(page, /不构成对任何产品或版本的兼容认证/);
  assert.match(page, /data-language="zh-CN"/);
  assert.match(page, /missing-local-file/);
  assert.match(page, /broken-cross-document-fragment/);
  assert.match(page, /executable-script/);
  assert.match(page, /css-missing-local-file, external-css-wide-fixed-layout/);
  assert.match(page, /Inspect every decision/);
  assert.match(page, /审查每项判断/);
  assert.match(page, /Recommended change/);
  assert.match(page, /建议修改/);
  assert.match(page, /Open machine-readable matrix/);
  assert.match(page, /Contribute a sanitized real export/);
  assert.match(page, /data-en="Do not share yet" data-zh-cn="暂不建议分享"/);
  assert.doesNotMatch(page, /<script[^>]+src=/i);
  assert.doesNotMatch(page, /<link[^>]+rel="stylesheet"[^>]+href="https?:/i);
});

test("verification CLI succeeds without rewriting evidence", () => {
  const result = spawnSync(process.execPath, ["scripts/note-compatibility-evidence.mjs", "--verify"], { encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Verified 7 representative fixtures and 4 before\/after decision cases/);
});

test("paired fixtures isolate the demonstrated repair instead of rewriting explanatory prose", () => {
  const read = (path) => readFileSync(`examples/note-compatibility/fixtures/${path}`, "utf8");
  assert.equal(read("notion-like/before/index.html"), read("notion-like/after/index.html"));
  assert.equal(read("obsidian-like/before/notes/method.html"), read("obsidian-like/after/notes/method.html"));
  assert.equal(
    read("obsidian-like/before/index.html").replace("#results", "#result"),
    read("obsidian-like/after/index.html"),
  );
  assert.equal(read("quarto-like/before/index.html"), read("quarto-like/after/index.html"));
});

test("compatibility documentation keeps the non-certification boundary explicit", () => {
  const fixtureReadme = readFileSync("examples/note-compatibility/README.md", "utf8");
  const documentation = readFileSync("docs/note-compatibility.zh-CN.md", "utf8");
  assert.match(fixtureReadme, /synthetic representative fixtures/i);
  assert.match(fixtureReadme, /not downloaded or copied vendor exports/i);
  assert.match(fixtureReadme, /No result is an official compatibility claim/i);
  assert.match(documentation, /不是 Notion、Obsidian、Jupyter 或 Quarto 的官方导出文件/);
  assert.match(documentation, /不能说“官方支持上述产品的所有版本”/);
  assert.match(documentation, /node scripts\/note-compatibility-evidence\.mjs --verify/);
});

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { validateArtifactFiles } from "../realitycheck/scripts/artifact-validator.mjs";
import { buildPolicyReview, renderPolicyReviewHtml, renderPolicyReviewMarkdown, writePolicyReview } from "../realitycheck/scripts/policy-review.mjs";

const strong = resolve("examples/policy-review-lab/before.config.json");
const weak = resolve("examples/policy-review-lab/after-weakened.config.json");

test("policy review blocks structural weakening without copying sensitive config text", () => {
  const review = buildPolicyReview(strong, weak, { now: new Date("2026-08-05T00:00:00Z") });
  assert.equal(review.summary.gateFailed, true);
  assert.ok(review.summary.weakened >= 20, review.summary);
  assert.ok(review.summary.review >= 2, review.summary);
  assert.ok(review.changes.some((item) => item.key === "viewports.phone-320" && item.classification === "weakened"));
  assert.ok(review.changes.some((item) => item.key === "security.requiredHeaders" && item.classification === "weakened"));
  assert.ok(review.changes.some((item) => item.key === "privacy.maxCookies" && item.classification === "weakened"));
  assert.ok(review.changes.some((item) => item.key === "qualityGate.minimumScore" && item.classification === "weakened"));
  assert.ok(review.changes.some((item) => item.key === "exceptions.temporary-release-action" && item.classification === "weakened"));
  const serialized = JSON.stringify(review);
  assert.doesNotMatch(serialized, /data-testid|\/admin\/|Tracked in WEB-410/);
  assert.match(renderPolicyReviewMarkdown(review, "zh-CN"), /策略变更审查/);
  const html = renderPolicyReviewHtml(review);
  assert.match(html, /data-language="zh-CN"/);
  assert.match(html, /data-filter="weakened"/);
  assert.match(html, /data-aria-zh-cn="搜索策略变更"/);
  assert.match(html, /data-count/);
  assert.match(html, /before\.config\.json/);
  assert.match(html, /sha256:[a-f0-9]{64}/);
  assert.match(html, /data-zh-cn="弱化"/);
  assert.doesNotMatch(html, /<script[^>]+src=/);
});

test("reversing the same fixture produces a passing strengthening review", () => {
  const review = buildPolicyReview(weak, strong, { now: new Date("2026-08-05T00:00:00Z") });
  assert.equal(review.summary.gateFailed, false);
  assert.equal(review.summary.weakened, 0);
  assert.ok(review.summary.strengthened >= 20, review.summary);
});

test("policy review blocks semantic security header weakening without copying values", () => {
  const directory = mkdtempSync(join(tmpdir(), "realitycheck-header-policy-review-"));
  try {
    const beforePath = join(directory, "before.json");
    const afterPath = join(directory, "after.json");
    const base = { baseUrl: "https://app.example/", security: { severity: "major", requiredHeaders: ["content-security-policy"] } };
    const beforeConfig = structuredClone(base);
    beforeConfig.security.requireSubresourceIntegrity = true;
    beforeConfig.security.headerPolicies = {
      contentSecurityPolicy: { requiredDirectives: ["default-src", "base-uri"], forbiddenTokens: ["'unsafe-eval'", "*"] },
      strictTransportSecurity: { minMaxAgeSeconds: 31536000, requireIncludeSubDomains: true, requirePreload: true },
      xContentTypeOptions: { requireNosniff: true },
      referrerPolicy: { allowedValues: ["no-referrer"] },
      permissionsPolicy: { disabledFeatures: ["camera", "microphone", "geolocation"] },
    };
    const afterConfig = structuredClone(base);
    afterConfig.security.headerPolicies = {
      contentSecurityPolicy: { requiredDirectives: ["default-src"], forbiddenTokens: ["*"] },
      strictTransportSecurity: { minMaxAgeSeconds: 300 },
      referrerPolicy: { allowedValues: ["no-referrer", "unsafe-url"] },
      permissionsPolicy: { disabledFeatures: ["camera"] },
    };
    writeFileSync(beforePath, JSON.stringify(beforeConfig), "utf8");
    writeFileSync(afterPath, JSON.stringify(afterConfig), "utf8");
    const review = buildPolicyReview(beforePath, afterPath, { now: new Date("2026-08-05T00:00:00Z") });
    assert.equal(review.summary.gateFailed, true);
    assert.ok(review.changes.some((item) => item.key === "security.headerPolicies.contentSecurityPolicy.requiredDirectives" && item.classification === "weakened"));
    assert.ok(review.changes.some((item) => item.key === "security.headerPolicies.strictTransportSecurity.minMaxAgeSeconds" && item.classification === "weakened"));
    assert.ok(review.changes.some((item) => item.key === "security-nosniff.policy" && item.classification === "weakened"));
    assert.ok(review.changes.some((item) => item.key === "security.headerPolicies.referrerPolicy.allowedValues" && item.classification === "weakened"));
    assert.ok(review.changes.some((item) => item.key === "security.headerPolicies.permissionsPolicy.disabledFeatures" && item.classification === "weakened"));
    assert.ok(review.changes.some((item) => item.key === "security.requireSubresourceIntegrity" && item.classification === "weakened"));
    assert.doesNotMatch(JSON.stringify(review), /unsafe-eval|unsafe-url|default-src|microphone|geolocation/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("policy review writes schema-valid bilingual artifacts and CLI preserves gate exits", () => {
  const directory = mkdtempSync(join(tmpdir(), "realitycheck-policy-review-"));
  try {
    const review = buildPolicyReview(strong, weak, { now: new Date("2026-08-05T00:00:00Z") });
    const outputs = writePolicyReview(review, directory);
    const [validation] = validateArtifactFiles([outputs.jsonPath]);
    assert.equal(validation.kind, "policy-review");
    assert.equal(validation.valid, true, validation.errors.join("\n"));
    assert.match(readFileSync(outputs.markdownZhPath, "utf8"), /已变更|新增|移除/);

    const blocked = spawnSync(process.execPath, ["realitycheck/scripts/audit.mjs", "policy-review", strong, weak, "--output", join(directory, "blocked")], { encoding: "utf8" });
    assert.equal(blocked.status, 1, `${blocked.stdout}\n${blocked.stderr}`);
    assert.match(blocked.stdout, /policy gate:\s+FAILED/);
    const passed = spawnSync(process.execPath, ["realitycheck/scripts/audit.mjs", "policy-review", weak, strong, "--output", join(directory, "passed")], { encoding: "utf8" });
    assert.equal(passed.status, 0, `${passed.stdout}\n${passed.stderr}`);
    assert.match(passed.stdout, /policy gate:\s+PASSED/);
    const rejectedOption = spawnSync(process.execPath, ["realitycheck/scripts/audit.mjs", "policy-review", weak, strong, "--mode", "deep"], { encoding: "utf8" });
    assert.equal(rejectedOption.status, 2, `${rejectedOption.stdout}\n${rejectedOption.stderr}`);
    assert.match(rejectedOption.stderr, /--output only/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

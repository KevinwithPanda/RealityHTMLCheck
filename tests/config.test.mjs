import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  ConfigError,
  applyFindingWaivers,
  applyFindingOwnership,
  discoverConfig,
  globToRegExp,
  loadProjectConfig,
  mergeProjectOptions,
  resolveRoute,
  routeAllowed,
  validateProjectConfig,
} from "../realitycheck/scripts/config.mjs";

test("configuration rejects unknown and unsafe values", () => {
  assert.throws(() => validateProjectConfig({ surprise: true }), ConfigError);
  assert.throws(() => validateProjectConfig({ mode: "huge" }), /quick or deep/);
  assert.throws(() => validateProjectConfig({ crawl: { maxPages: 101 } }), /1 to 100/);
  assert.throws(() => validateProjectConfig({ routes: [""] }), /non-empty strings/);
  assert.throws(() => validateProjectConfig({ checks: [{ id: "X", selector: "button", assertion: "visible" }] }), /must match/);
  assert.throws(() => validateProjectConfig({ checks: [{ id: "cta", selector: "button", assertion: "javascript" }] }), /not supported/);
  assert.throws(() => validateProjectConfig({ checks: [{ id: "cta", selector: "button", assertion: "attribute" }] }), /attribute is required/);
  assert.throws(() => validateProjectConfig({ budgets: { severity: "major" } }), /at least one/);
  assert.throws(() => validateProjectConfig({ budgets: { requests: -1 } }), /0 to/);
  assert.throws(() => validateProjectConfig({ qualityGate: {} }), /at least one/);
  assert.throws(() => validateProjectConfig({ qualityGate: { minimumCoveragePercent: 101 } }), /0 to 100/);
});

test("release policy gates are explicit, bounded, and preserved", () => {
  const qualityGate = { minimumScore: 90, minimumCoveragePercent: 85, maxWaivedFindings: 2 };
  const config = validateProjectConfig({ qualityGate });
  assert.deepEqual(config.qualityGate, qualityGate);
  const merged = mergeProjectOptions(
    { target: "http://127.0.0.1:3000", mode: null, output: null, failOn: null, routes: [], crawl: undefined },
    { path: null, directory: process.cwd(), cwd: process.cwd(), config },
  );
  assert.deepEqual(merged.qualityGate, qualityGate);
});

test("responsive viewport matrices are bounded, unique, and default safely", () => {
  const viewports = [
    { id: "phone-320", width: 320, height: 700, touch: true },
    { id: "tablet-768", width: 768, height: 1024, touch: false },
  ];
  assert.deepEqual(validateProjectConfig({ viewports }).viewports, viewports);
  assert.deepEqual(validateProjectConfig({ viewports: [{ id: "phone-390", width: 390, height: 844 }] }).viewports, [{ id: "phone-390", width: 390, height: 844, touch: true }]);
  assert.throws(() => validateProjectConfig({ viewports: [] }), /1 to 6/);
  assert.throws(() => validateProjectConfig({ viewports: Array.from({ length: 7 }, (_, index) => ({ id: `phone-${index}`, width: 300 + index, height: 700 })) }), /1 to 6/);
  assert.throws(() => validateProjectConfig({ viewports: [{ id: "baseline", width: 320, height: 700 }] }), /collides/);
  assert.throws(() => validateProjectConfig({ viewports: [{ id: "phone-320", width: 239, height: 700 }] }), /240 to 2560/);
  assert.throws(() => validateProjectConfig({ viewports: [{ id: "phone-320", width: 320, height: 700 }, { id: "phone-320", width: 390, height: 844 }] }), /duplicate id/);
  assert.throws(() => validateProjectConfig({ viewports: [{ id: "phone-320", width: 320, height: 700 }, { id: "narrow-phone", width: 320, height: 700 }] }), /duplicate dimensions/);
  const mergedDefault = mergeProjectOptions({ routes: [] }, { path: null, directory: process.cwd(), cwd: process.cwd(), config: {} });
  assert.deepEqual(mergedDefault.viewports, [{ id: "mobile-375", width: 375, height: 812, touch: true }]);
  const mergedCustom = mergeProjectOptions({ routes: [] }, { path: null, directory: process.cwd(), cwd: process.cwd(), config: { viewports } });
  assert.deepEqual(mergedCustom.viewports, viewports);
});

test("regression baselines can have an explicit bounded freshness policy", () => {
  assert.throws(() => validateProjectConfig({ baselinePolicy: {} }), /at least one/);
  assert.throws(() => validateProjectConfig({ baselinePolicy: { maxAgeDays: 0 } }), /1 to 3650/);
  assert.throws(() => validateProjectConfig({ baselinePolicy: { requireSamePolicy: false } }), /must set/);
  const baselinePolicy = { maxAgeDays: 30, requireSamePolicy: true };
  assert.deepEqual(validateProjectConfig({ baselinePolicy }).baselinePolicy, baselinePolicy);
  const merged = mergeProjectOptions({ routes: [] }, { config: { baselinePolicy }, directory: process.cwd(), cwd: process.cwd(), path: null });
  assert.deepEqual(merged.baselinePolicy, baselinePolicy);
});

test("route and rule ownership assigns one accountable team and rejects ambiguity", () => {
  assert.throws(() => validateProjectConfig({ owners: [{ id: "Team A", name: "A" }] }), /must match/);
  const config = validateProjectConfig({
    owners: [
      { id: "web-platform", name: "Web Platform", ruleIds: ["overflow"], include: ["/app/**"] },
      { id: "checkout", name: "Checkout", ruleIds: ["payment-control"], include: ["/checkout/**"] },
    ],
  });
  const findings = [{ ruleId: "overflow" }, { ruleId: "contrast" }];
  const assigned = applyFindingOwnership(findings, "http://127.0.0.1:3000/app/home", config.owners);
  assert.deepEqual(assigned, { appliedCount: 1, ambiguousCount: 0 });
  assert.deepEqual(findings[0].ownership, { id: "web-platform", name: "Web Platform" });
  assert.equal(findings[1].ownership, undefined);

  const ambiguousFinding = [{ ruleId: "overflow" }];
  const ambiguous = applyFindingOwnership(ambiguousFinding, "http://127.0.0.1:3000/app/home", [
    ...config.owners,
    { id: "all-app", name: "Application", ruleIds: [], include: ["/app/**"], exclude: [] },
  ]);
  assert.equal(ambiguous.ambiguousCount, 1);
  assert.equal(ambiguousFinding[0].ownership, undefined);
});

test("performance budgets are bounded and carry an explicit severity", () => {
  const config = validateProjectConfig({ budgets: { navigationMs: 1500, ttfbMs: 600, largestContentfulPaintMs: 2500, cumulativeLayoutShift: 0.1, requests: 40, transferKb: 500, severity: "minor" } });
  assert.deepEqual(config.budgets, { severity: "minor", navigationMs: 1500, ttfbMs: 600, largestContentfulPaintMs: 2500, requests: 40, transferKb: 500, cumulativeLayoutShift: 0.1 });
  assert.throws(() => validateProjectConfig({ budgets: { cumulativeLayoutShift: -0.1 } }), /number from 0 to 100/);
  assert.throws(() => validateProjectConfig({ budgets: { cumulativeLayoutShift: "0.1" } }), /number from 0 to 100/);
});

test("network reliability budgets are scoped, paired, and bounded", () => {
  const network = {
    severity: "critical",
    scope: "api",
    maxHttpErrors: 0,
    maxFailedRequests: 0,
    slowRequestMs: 750,
    maxSlowRequests: 2,
    maxThirdPartyRequests: 4,
  };
  assert.deepEqual(validateProjectConfig({ network }).network, network);
  assert.deepEqual(validateProjectConfig({ network: { maxHttpErrors: 0 } }).network, { severity: "major", scope: "api", maxHttpErrors: 0 });
  assert.throws(() => validateProjectConfig({ network: { severity: "major" } }), /at least one request limit/);
  assert.throws(() => validateProjectConfig({ network: { maxSlowRequests: 0 } }), /must be configured together/);
  assert.throws(() => validateProjectConfig({ network: { slowRequestMs: 500 } }), /must be configured together/);
  assert.throws(() => validateProjectConfig({ network: { scope: "scripts", maxHttpErrors: 0 } }), /api or all/);
  assert.throws(() => validateProjectConfig({ network: { maxThirdPartyRequests: -1 } }), /0 to 10000/);
});

test("link integrity policy is HEAD-only, bounded, and explicit", () => {
  assert.deepEqual(validateProjectConfig({ links: { maxFailures: 0 } }).links, {
    severity: "major",
    maxFailures: 0,
    maxChecked: 50,
    timeoutMs: 5000,
  });
  const links = { severity: "critical", maxFailures: 2, maxChecked: 100, timeoutMs: 15000 };
  assert.deepEqual(validateProjectConfig({ links }).links, links);
  assert.throws(() => validateProjectConfig({ links: {} }), /maxFailures is required/);
  assert.throws(() => validateProjectConfig({ links: { maxFailures: 0, maxChecked: 0 } }), /1 to 100/);
  assert.throws(() => validateProjectConfig({ links: { maxFailures: 0, timeoutMs: 499 } }), /500 to 15000/);
  assert.throws(() => validateProjectConfig({ links: { maxFailures: 0, method: "GET" } }), /unknown property/);
});

test("publishing metadata policy is explicit, bounded, and text-free", () => {
  const metadata = {
    severity: "major",
    titleMinLength: 5,
    titleMaxLength: 70,
    descriptionMinLength: 50,
    descriptionMaxLength: 180,
    requireCanonical: true,
    requireViewport: true,
    requireLang: true,
    forbidNoindex: true,
    requireSingleH1: true,
  };
  assert.deepEqual(validateProjectConfig({ metadata }).metadata, metadata);
  assert.throws(() => validateProjectConfig({ metadata: {} }), /at least one metadata rule/);
  assert.throws(() => validateProjectConfig({ metadata: { requireCanonical: false } }), /must be true/);
  assert.throws(() => validateProjectConfig({ metadata: { titleMinLength: 80, titleMaxLength: 70 } }), /cannot exceed/);
  assert.throws(() => validateProjectConfig({ metadata: { descriptionMinLength: -1 } }), /0 to 1000/);
  assert.throws(() => validateProjectConfig({ metadata: { title: "secret page copy" } }), /unknown property/);
});

test("visual regression policy is bounded, project-local, and explicit", () => {
  const visual = {
    severity: "major",
    baselineDirectory: ".realitycheck/visual-baselines",
    maxDiffRatio: 0.005,
    pixelThreshold: 24,
    masks: ["[data-dynamic]", ".clock"],
  };
  assert.deepEqual(validateProjectConfig({ visual }).visual, visual);
  assert.throws(() => validateProjectConfig({ visual: { baselineDirectory: "baselines" } }), /maxDiffRatio is required/);
  assert.throws(() => validateProjectConfig({ visual: { baselineDirectory: "../outside", maxDiffRatio: 0.1 } }), /inside the project/);
  assert.throws(() => validateProjectConfig({ visual: { baselineDirectory: "baselines", maxDiffRatio: 1.1 } }), /number from 0 to 1/);
  assert.throws(() => validateProjectConfig({ visual: { baselineDirectory: "baselines", maxDiffRatio: 0.1, pixelThreshold: 256 } }), /0 to 255/);
  assert.throws(() => validateProjectConfig({ visual: { baselineDirectory: "baselines", maxDiffRatio: 0.1, masks: Array.from({ length: 21 }, (_, index) => `.mask-${index}`) } }), /more than 20/);
  const directory = mkdtempSync(join(tmpdir(), "realitycheck-visual-config-"));
  try {
    const merged = mergeProjectOptions({ routes: [] }, { path: join(directory, "realitycheck.config.json"), directory, cwd: directory, config: { visual } });
    assert.equal(merged.visual.baselineDirectoryPath, join(directory, ".realitycheck/visual-baselines"));
    assert.deepEqual(merged.visual.masks, visual.masks);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("security policies are explicit, bounded, and origin-only", () => {
  const security = {
    severity: "major",
    requiredHeaders: ["content-security-policy", "x-content-type-options"],
    forbidMixedContent: true,
    secureForms: true,
    maxThirdPartyOrigins: 2,
    allowedThirdPartyOrigins: ["https://cdn.example.com"],
  };
  assert.deepEqual(validateProjectConfig({ security }).security, security);
  assert.throws(() => validateProjectConfig({ security: { requiredHeaders: ["Content-Security-Policy"] } }), /lowercase/);
  assert.throws(() => validateProjectConfig({ security: { severity: "major" } }), /at least one security policy/);
  assert.throws(() => validateProjectConfig({ security: { forbidMixedContent: false } }), /must be true/);
  assert.throws(() => validateProjectConfig({ security: { requiredHeaders: ["set-cookie"] } }), /unsupported header/);
  assert.throws(() => validateProjectConfig({ security: { allowedThirdPartyOrigins: ["https://cdn.example.com/assets"] } }), /without a path/);
});

test("governed waivers require ownership context and expire automatically", () => {
  assert.throws(() => validateProjectConfig({ waivers: [{ id: "known-risk", ruleId: "overflow", reason: "Migration", expires: "soon" }] }), /valid YYYY-MM-DD/);
  assert.throws(() => validateProjectConfig({ waivers: [{ id: "known-risk", ruleId: "overflow", expires: "2027-01-01" }] }), /reason/);
  const config = validateProjectConfig({
    waivers: [
      { id: "known-risk", ruleId: "overflow", selector: "#legacy", reason: "Removal is tracked in WEB-42", owner: "Web Platform", expires: "2027-01-31", include: ["/legacy/**"] },
      { id: "expired-risk", ruleId: "contrast", reason: "Old exception", expires: "2025-01-01" },
    ],
  });
  const findings = [
    { ruleId: "overflow", selector: "#legacy" },
    { ruleId: "contrast", selector: "main" },
  ];
  const result = applyFindingWaivers(findings, "http://127.0.0.1:3000/legacy/page", config.waivers, new Date("2026-08-01T00:00:00Z"));
  assert.equal(result.appliedCount, 1);
  assert.deepEqual(result.expiredIds, ["expired-risk"]);
  assert.deepEqual(findings[0].waiver, { id: "known-risk", reason: "Removal is tracked in WEB-42", owner: "Web Platform", expires: "2027-01-31" });
  assert.equal(findings[1].waiver, undefined);
});

test("declarative checks are normalized without accepting executable code", () => {
  const config = validateProjectConfig({
    checks: [
      {
        id: "checkout-visible",
        selector: "[data-testid=checkout]",
        assertion: "visible",
        severity: "critical",
        title: "Checkout must remain visible",
      },
      {
        id: "touch-target",
        selector: ".icon-button",
        assertion: "minimum-size",
        options: { minWidth: 44, minHeight: 44 },
      },
    ],
  });
  assert.equal(config.checks.length, 2);
  assert.deepEqual(config.checks[0].include, ["/**"]);
  assert.deepEqual(config.checks[1].options, { minWidth: 44, minHeight: 44 });
  assert.equal(JSON.stringify(config).includes("function"), false);
});

test("declarative journeys require safe bounded navigation and a proving assertion", () => {
  const journeys = [{
    id: "settings-tabs",
    title: "Settings tabs stay usable",
    startPath: "/settings",
    severity: "major",
    steps: [
      { action: "assert", selector: "[role=tab]", assertion: "count", options: { min: 2 } },
      { action: "press", selector: "[role=tab][aria-controls=general]", key: "ArrowRight" },
      { action: "assert", selector: "#security", assertion: "visible" },
      { action: "goto", path: "/settings/profile" },
      { action: "assert-url", path: "/settings/profile" },
      { action: "assert", selector: "h1", assertion: "accessible-name" },
    ],
  }];
  const config = validateProjectConfig({ journeys });
  assert.equal(config.journeys[0].steps.length, 6);
  assert.equal(config.journeys[0].startPath, "/settings");
  assert.throws(() => validateProjectConfig({ journeys: [{ id: "bad-journey", steps: [{ action: "goto", path: "https://example.com" }] }] }), /same-origin absolute path/);
  assert.throws(() => validateProjectConfig({ journeys: [{ id: "no-proof", steps: [{ action: "click", selector: "button" }] }] }), /at least one assert/);
  assert.throws(() => validateProjectConfig({ journeys: [{ id: "script-step", steps: [{ action: "javascript", selector: "body" }, { action: "assert", selector: "body", assertion: "exists" }] }] }), /goto, click, press, assert, or assert-url/);
  assert.throws(() => validateProjectConfig({ journeys: [{ id: "unsafe-key", steps: [{ action: "press", selector: "button", key: "Enter" }, { action: "assert", selector: "body", assertion: "exists" }] }] }), /must be Escape/);
  assert.throws(() => validateProjectConfig({ journeys: [{ id: "url-query", steps: [{ action: "assert-url", path: "https://example.com/settings" }] }] }), /same-origin absolute path/);
  assert.throws(() => validateProjectConfig({ journeys: [{ id: "secret-query", steps: [{ action: "assert-url", path: "/settings?token=secret" }] }] }), /query-free pathname/);
});

test("CLI values override project values and paths resolve beside the config", () => {
  const merged = mergeProjectOptions(
    { target: null, mode: "deep", output: null, failOn: null, routes: [], crawl: undefined },
    {
      path: "C:/project/realitycheck.config.json",
      directory: "C:/project",
      config: { baseUrl: "http://127.0.0.1:4000", mode: "quick", failOn: "minor", output: "artifacts", routes: ["/", "/settings"] },
    },
  );
  assert.equal(merged.target, "http://127.0.0.1:4000");
  assert.equal(merged.mode, "deep");
  assert.equal(merged.failOn, "minor");
  assert.equal(merged.output, resolve("C:/project", "artifacts"));
  assert.deepEqual(merged.routes, ["/", "/settings"]);
  assert.equal(merged.crawl.exclude.includes("/logout/**"), true);
});

test("route filters support globbing and deny sensitive navigation", () => {
  const crawl = {
    include: ["/**"],
    exclude: ["/logout/**", "/checkout/**", "/admin/private"],
  };
  assert.equal(routeAllowed("/dashboard", crawl), true);
  assert.equal(routeAllowed("/logout", crawl), false);
  assert.equal(routeAllowed("/logout/all", crawl), false);
  assert.equal(routeAllowed("/checkout/pay", crawl), false);
  assert.equal(routeAllowed("/admin/private", crawl), false);
  assert.equal(routeAllowed("/Logout", crawl), false);
  assert.equal(routeAllowed("/app/%63heckout/pay", { include: ["/**"], exclude: [] }), false);
  assert.equal(routeAllowed("/app/oauth/callback", { include: ["/**"], exclude: [] }), false);
  assert.equal(globToRegExp("/docs/*").test("/docs/start"), true);
  assert.equal(globToRegExp("/docs/*").test("/docs/a/b"), false);
});

test("configured routes cannot leave the target origin", () => {
  assert.equal(resolveRoute("http://127.0.0.1:3000/app", "/settings"), "http://127.0.0.1:3000/settings");
  assert.throws(() => resolveRoute("http://127.0.0.1:3000", "https://example.com"), /must stay/);
});

test("configuration is discovered from nested project directories", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-config-"));
  try {
    const nested = join(root, "packages", "web");
    mkdirSync(nested, { recursive: true });
    const configPath = join(root, "realitycheck.config.json");
    writeFileSync(configPath, JSON.stringify({ baseUrl: "http://localhost:3000" }), "utf8");
    assert.equal(discoverConfig(nested), configPath);
    assert.equal(loadProjectConfig(null, nested).config.baseUrl, "http://localhost:3000");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

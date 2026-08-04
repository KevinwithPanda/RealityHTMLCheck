import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { buildAuditPlan, computeAuditPlanId, renderAuditPlanHtml, renderAuditPlanMarkdown, writeAuditPlan } from "../realitycheck/scripts/audit-plan.mjs";
import { validateArtifactFiles } from "../realitycheck/scripts/artifact-validator.mjs";
import { loadProjectConfig, mergeProjectOptions } from "../realitycheck/scripts/config.mjs";

function policy() {
  return {
    $schema: "../../realitycheck/assets/config.schema.json",
    baseUrl: "http://127.0.0.1:4182/private/start?token=do-not-retain#panel",
    mode: "deep",
    failOn: "major",
    routes: ["/private/accounts", "/private/settings"],
    viewports: [
      { id: "phone-360", width: 360, height: 800, touch: true },
      { id: "tablet-768", width: 768, height: 1024, touch: true }
    ],
    crawl: { enabled: false, maxPages: 12, maxDepth: 3, include: ["/**"], exclude: ["/private/delete/**"] },
    checks: [{ id: "account-banner", selector: "[data-secret-selector='internal']", assertion: "visible", severity: "major" }],
    journeys: [{ id: "account-review", startPath: "/private/accounts", severity: "major", steps: [{ action: "assert", selector: "#secret-account", assertion: "visible" }] }],
    budgets: { severity: "major", largestContentfulPaintMs: 2500, cumulativeLayoutShift: 0.1 },
    network: { severity: "major", scope: "api", maxHttpErrors: 0, maxFailedRequests: 0, slowRequestMs: 3000, maxSlowRequests: 1, maxThirdPartyRequests: 3 },
    links: { severity: "major", maxFailures: 0, maxChecked: 30, timeoutMs: 5000 },
    metadata: { severity: "major", titleMinLength: 5, requireViewport: true, requireLang: true },
    security: { severity: "major", requiredHeaders: ["x-content-type-options"], forbidMixedContent: true, secureForms: true, maxThirdPartyOrigins: 2 },
    privacy: { severity: "major", maxCookies: 10, maxCookieBytes: 4096, maxLocalStorageEntries: 20, maxLocalStorageBytes: 131072 },
    qualityGate: { minimumScore: 90, minimumCoveragePercent: 100, maxWaivedFindings: 0 },
    owners: [{ id: "web", name: "Web team", ruleIds: ["account-banner"] }]
  };
}

function cli() {
  return {
    command: "plan",
    target: null,
    mode: null,
    failOn: null,
    output: null,
    routes: [],
    crawl: undefined,
    maxPages: undefined,
    maxDepth: undefined,
    storageState: null,
    allowRemote: false,
    compareReport: null,
    baselineReport: null
  };
}

test("audit plan explains effective coverage without copying private config details", () => {
  const directory = mkdtempSync(join(tmpdir(), "realitycheck-audit-plan-"));
  try {
    const configPath = join(directory, "realitycheck.config.json");
    writeFileSync(configPath, JSON.stringify(policy()), "utf8");
    const loaded = loadProjectConfig(configPath, directory);
    const options = mergeProjectOptions(cli(), loaded);
    options.storageState = resolve(directory, "secret-auth-state.json");
    const plan = buildAuditPlan(options, loaded, {
      now: new Date("2026-08-05T01:02:03Z"),
      storageStateSummary: { cookies: 4, origins: 1 }
    });

    assert.equal(plan.target.url, "http://127.0.0.1:4182/private/start");
    assert.equal(plan.target.inspected, false);
    assert.equal(plan.execution.pageStrategy, "explicit-routes");
    assert.equal(plan.execution.pagesMax, 3);
    assert.equal(plan.execution.scenariosPerPage, 14);
    assert.equal(plan.execution.journeyScenarios, 1);
    assert.equal(plan.execution.scenarioExecutionsMax, 43);
    assert.equal(plan.summary.enabledDetectors, 11);
    assert.equal(plan.id, computeAuditPlanId(plan));
    assert.equal(plan.target.inspected, false);
    assert.deepEqual(plan.safety.map((item) => item.id), ["preview-only", "same-origin", "no-submit", "reviewed-repair"]);
    assert.ok(plan.detectors.find((item) => item.key === "privacy")?.enabled);
    assert.ok(plan.warnings.some((item) => /4 cookie record/.test(item)));

    const serialized = JSON.stringify(plan);
    assert.doesNotMatch(serialized, /do-not-retain|data-secret-selector|secret-account|secret-auth-state|private\/accounts|private\/delete/);
    assert.doesNotMatch(serialized, /token=/);
    assert.match(renderAuditPlanMarkdown(plan, "zh-CN"), /运行之前|安全边界|数据保留/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("audit plan writes schema-valid bilingual offline artifacts with semantic binding", () => {
  const directory = mkdtempSync(join(tmpdir(), "realitycheck-audit-plan-write-"));
  try {
    const configPath = join(directory, "realitycheck.config.json");
    writeFileSync(configPath, JSON.stringify(policy()), "utf8");
    const loaded = loadProjectConfig(configPath, directory);
    const plan = buildAuditPlan(mergeProjectOptions(cli(), loaded), loaded, { now: new Date("2026-08-05T01:02:03Z") });
    const outputs = writeAuditPlan(plan, join(directory, "output"));
    const [validation] = validateArtifactFiles([outputs.jsonPath]);
    assert.equal(validation.kind, "audit-plan");
    assert.equal(validation.valid, true, validation.errors.join("\n"));
    const html = readFileSync(outputs.htmlPath, "utf8");
    assert.match(html, /data-language="zh-CN"/);
    assert.match(html, /PREVIEW ONLY · NO BROWSER OPENED/);
    assert.match(html, /Copy audit command/);
    assert.match(html, /connect-src 'none'/);
    assert.doesNotMatch(html, /<script[^>]+src=/);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    assert.equal(scripts.length, 2);
    for (const script of scripts) assert.doesNotThrow(() => new Function(script));
    assert.match(html, /legacyCopy/);

    const tampered = JSON.parse(readFileSync(outputs.jsonPath, "utf8"));
    tampered.summary.scenarioExecutionsMax += 1;
    writeFileSync(outputs.jsonPath, JSON.stringify(tampered), "utf8");
    const [rejected] = validateArtifactFiles([outputs.jsonPath]);
    assert.equal(rejected.valid, false);
    assert.match(rejected.errors.join("\n"), /scenarioExecutionsMax/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("plan CLI is browser-free, validates its output, and rejects browser flags", () => {
  const directory = mkdtempSync(join(tmpdir(), "realitycheck-audit-plan-cli-"));
  try {
    const configPath = join(directory, "realitycheck.config.json");
    const output = join(directory, "plan");
    writeFileSync(configPath, JSON.stringify(policy()), "utf8");
    const result = spawnSync(process.execPath, ["realitycheck/scripts/audit.mjs", "plan", "--config", configPath, "--output", output], { encoding: "utf8" });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /browser access:\s+NONE/);
    assert.match(result.stdout, /coverage ceiling:\s+3 page\(s\), 43 scenario execution\(s\)/);
    const [validation] = validateArtifactFiles([join(output, "audit-plan.json")]);
    assert.equal(validation.valid, true, validation.errors.join("\n"));

    const rejected = spawnSync(process.execPath, ["realitycheck/scripts/audit.mjs", "plan", "--config", configPath, "--browser", "missing-browser"], { encoding: "utf8" });
    assert.equal(rejected.status, 2, `${rejected.stdout}\n${rejected.stderr}`);
    assert.match(rejected.stderr, /does not open a browser/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

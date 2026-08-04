import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { validateArtifactFiles } from "../realitycheck/scripts/artifact-validator.mjs";
import { TOOL_VERSION } from "../realitycheck/scripts/version.mjs";

test("all public surfaces use one tool version", () => {
  const version = readFileSync(resolve("VERSION"), "utf8").trim();
  const packageVersion = JSON.parse(readFileSync(resolve("package.json"), "utf8")).version;
  const referenceVersion = JSON.parse(readFileSync(resolve("examples/reference-run/report.json"), "utf8")).toolVersion;
  const pythonSource = readFileSync(resolve("realitycheck/scripts/report.py"), "utf8");
  assert.equal(version, TOOL_VERSION);
  assert.equal(packageVersion, TOOL_VERSION);
  assert.equal(referenceVersion, TOOL_VERSION);
  assert.match(pythonSource, new RegExp(`TOOL_VERSION = ["']${TOOL_VERSION.replaceAll(".", "\\.")}["']`));
});

test("the published page report satisfies its JSON Schema", () => {
  const [result] = validateArtifactFiles([resolve("examples/reference-run/report.json")]);
  assert.equal(result.kind, "report");
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("the published repair handoff satisfies its JSON Schema", () => {
  const [result] = validateArtifactFiles([resolve("examples/reference-run/repair-plan.json")]);
  assert.equal(result.kind, "repair-plan");
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("the published GitHub issue draft board satisfies its JSON Schema", () => {
  const [result] = validateArtifactFiles([resolve("examples/issue-drafts-lab/github-issue-drafts.json")]);
  assert.equal(result.kind, "github-issue-drafts");
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("the published release decision satisfies its JSON Schema and semantic binding", () => {
  const [result] = validateArtifactFiles([resolve("examples/release-decision-lab/release-decision.json")]);
  assert.equal(result.kind, "release-decision");
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("the published audit plan satisfies its JSON Schema and semantic binding", () => {
  const [result] = validateArtifactFiles([resolve("examples/audit-plan-lab/audit-plan.json")]);
  assert.equal(result.kind, "audit-plan");
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("the published reference evidence manifest verifies every committed output", () => {
  const [result] = validateArtifactFiles([resolve("examples/reference-run/evidence-manifest.json")]);
  assert.equal(result.kind, "evidence-manifest");
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("the published responsive matrix evidence verifies every committed output", () => {
  const latest = JSON.parse(readFileSync(resolve("examples/public-evidence/viewport/latest.json"), "utf8"));
  const [result] = validateArtifactFiles([resolve("examples/public-evidence/viewport", latest.artifacts.integrityManifest)]);
  assert.equal(result.kind, "evidence-manifest");
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("the published aggregate privacy evidence verifies every committed output", () => {
  const latest = JSON.parse(readFileSync(resolve("examples/public-evidence/privacy/latest.json"), "utf8"));
  const [manifest, report] = validateArtifactFiles([
    resolve("examples/public-evidence/privacy", latest.artifacts.integrityManifest),
    resolve("examples/public-evidence/privacy", latest.artifacts.json),
  ]);
  assert.equal(manifest.kind, "evidence-manifest");
  assert.equal(manifest.valid, true, manifest.errors.join("\n"));
  assert.equal(report.kind, "report");
  assert.equal(report.valid, true, report.errors.join("\n"));
});

test("published semantic response-header evidence proves failure and recovery without raw values", () => {
  const expected = [
    ["security-headers-broken", 84, 4],
    ["security-headers-fixed", 100, 0],
  ];
  for (const [kind, score, semanticFindings] of expected) {
    const root = resolve("examples/public-evidence", kind);
    const latest = JSON.parse(readFileSync(resolve(root, "latest.json"), "utf8"));
    const [manifest, reportResult] = validateArtifactFiles([
      resolve(root, latest.artifacts.integrityManifest),
      resolve(root, latest.artifacts.json),
    ]);
    assert.equal(manifest.valid, true, manifest.errors.join("\n"));
    assert.equal(reportResult.valid, true, reportResult.errors.join("\n"));
    const report = JSON.parse(readFileSync(resolve(root, latest.artifacts.json), "utf8"));
    assert.equal(report.score.overall, score);
    const semantic = report.findings.filter((item) => item.ruleId.startsWith("security-header-policy-"));
    assert.equal(semantic.length, semanticFindings);
    const serialized = JSON.stringify(report);
    assert.doesNotMatch(serialized, /default-src 'self'|base-uri 'none'|frame-ancestors 'none'/);
    assert.doesNotMatch(serialized, /private\.example/);
    assert.equal(semantic.every((item) => item.measurements.rawValueRetained === false), true);
    if (kind === "security-headers-broken") {
      assert.match(semantic.find((item) => item.ruleId.endsWith("permissions-policy")).summary, /camera, geolocation/);
      assert.match(semantic.find((item) => item.ruleId.endsWith("content-security-policy")).remediation.summary, /base-uri, form-action, frame-ancestors/);
    }
  }
});

test("committed interactive HTML surfaces contain parseable inline scripts", () => {
  for (const path of ["examples/reference-run/report.html", "examples/index.html", "examples/issue-drafts-lab/github-issue-drafts.html", "examples/release-decision-lab/release-decision.html", "examples/audit-plan-lab/audit-plan.html"]) {
    const source = readFileSync(resolve(path), "utf8");
    const scripts = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    assert.ok(scripts.length > 0, `${path} should contain an inline script`);
    for (const script of scripts) assert.doesNotThrow(() => new Function(script), path);
  }
});

test("the showcase project policy satisfies its JSON Schema", () => {
  const [result] = validateArtifactFiles([resolve("examples/showcase-site/realitycheck.config.json")]);
  assert.equal(result.kind, "config");
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("an explicitly named alternate project policy is recognized by its schema reference", () => {
  const [result] = validateArtifactFiles([resolve("examples/waiver-lab/unwaived.config.json")]);
  assert.equal(result.kind, "config");
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("keyboard and URL journey steps satisfy the project policy schema", () => {
  const [result] = validateArtifactFiles([resolve("examples/journey-lab/realitycheck.config.json")]);
  assert.equal(result.kind, "config");
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("publishing metadata fixtures satisfy the project policy schema", () => {
  for (const name of ["broken.config.json", "fixed.config.json"]) {
    const [result] = validateArtifactFiles([resolve(`examples/metadata-lab/${name}`)]);
    assert.equal(result.kind, "config");
    assert.equal(result.valid, true, `${name}: ${result.errors.join("\n")}`);
  }
});

test("visual regression fixture policies satisfy the project policy schema", () => {
  for (const name of ["realitycheck.config.json", "ci.config.json"]) {
    const [result] = validateArtifactFiles([resolve(`examples/visual-regression-lab/${name}`)]);
    assert.equal(result.kind, "config");
    assert.equal(result.valid, true, `${name}: ${result.errors.join("\n")}`);
  }
});

test("responsive viewport fixture policies satisfy the project policy schema", () => {
  for (const name of ["broken.config.json", "fixed.config.json"]) {
    const [result] = validateArtifactFiles([resolve(`examples/viewport-lab/${name}`)]);
    assert.equal(result.kind, "config");
    assert.equal(result.valid, true, `${name}: ${result.errors.join("\n")}`);
  }
});

test("aggregate browser storage privacy fixtures satisfy the project policy schema", () => {
  for (const name of ["broken.config.json", "fixed.config.json"]) {
    const [result] = validateArtifactFiles([resolve(`examples/privacy-lab/${name}`)]);
    assert.equal(result.kind, "config");
    assert.equal(result.valid, true, `${name}: ${result.errors.join("\n")}`);
  }
});

test("semantic response-header fixtures satisfy the project policy schema", () => {
  for (const name of ["broken.config.json", "fixed.config.json"]) {
    const [result] = validateArtifactFiles([resolve(`examples/security-header-lab/${name}`)]);
    assert.equal(result.kind, "config");
    assert.equal(result.valid, true, `${name}: ${result.errors.join("\n")}`);
  }
});

test("validation reports precise paths for incompatible artifacts", () => {
  const directory = mkdtempSync(join(tmpdir(), "realitycheck-validation-"));
  try {
    const invalid = join(directory, "report.json");
    writeFileSync(invalid, JSON.stringify({ schemaVersion: "1", run: {}, target: {}, scenarios: [], findings: [] }), "utf8");
    const [result] = validateArtifactFiles([invalid]);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /required property|must have required/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("verification and trend contracts accept portable v1 artifacts", () => {
  const directory = mkdtempSync(join(tmpdir(), "realitycheck-contracts-"));
  try {
    writeFileSync(join(directory, "verification.json"), JSON.stringify({
      schemaVersion: "1",
      toolVersion: "0.3.0",
      before: { runId: "before", score: 80 },
      after: { runId: "after", score: 92 },
      scoreDelta: 12,
      counts: { resolved: 1, remaining: 0, worsened: 0, new: 0, unverified: 0 },
      resolved: [{ id: "RC-A", fingerprint: "a", ruleId: "overflow", scenarioId: "mobile-375", severity: "major", confidence: "high", title: "Fixed" }],
      remaining: [],
      worsened: [],
      new: [],
      unverified: [],
      threshold: { failOn: "major", scope: "regressions-only", met: false },
    }), "utf8");
    writeFileSync(join(directory, "trend.json"), JSON.stringify({
      schemaVersion: "1",
      toolVersion: "0.3.0",
      kind: "quality-trend",
      generatedAt: "2026-08-01T00:00:00Z",
      summary: { runs: 1, targets: 1, latestAverage: 92, regressedTargets: 0, improvedTargets: 0 },
      series: [{
        target: "http://127.0.0.1:3000/",
        title: "Demo",
        firstScore: 92,
        latestScore: 92,
        scoreDelta: 0,
        points: [{ runId: "run", startedAt: "2026-08-01T00:00:00Z", finishedAt: "2026-08-01T00:01:00Z", score: 92, gateFailed: false, findings: { critical: 0, major: 1, minor: 0, info: 0 }, coverage: { covered: 6, total: 6 }, reportPath: "../runs/run/report.html" }],
      }],
      warnings: [],
    }), "utf8");
    const results = validateArtifactFiles([directory]);
    assert.equal(results.length, 2);
    assert.equal(results.every((result) => result.valid), true, results.flatMap((result) => result.errors).join("\n"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the v1 verification contract remains compatible with v0.2 artifacts", () => {
  const directory = mkdtempSync(join(tmpdir(), "realitycheck-v02-contract-"));
  try {
    writeFileSync(join(directory, "verification.json"), JSON.stringify({
      schemaVersion: "1",
      toolVersion: "0.2.0",
      before: { runId: "before", score: 80 },
      after: { runId: "after", score: 88 },
      scoreDelta: 8,
      counts: { resolved: 1, remaining: 0, new: 0, unverified: 0 },
      resolved: [],
      remaining: [],
      new: [],
      unverified: [],
      threshold: { failOn: "major", met: false },
    }), "utf8");
    const [result] = validateArtifactFiles([directory]);
    assert.equal(result.valid, true, result.errors.join("\n"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

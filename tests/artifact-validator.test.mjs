import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import test from "node:test";

import { validateArtifactFiles } from "../realitycheck/scripts/artifact-validator.mjs";
import { runNoteCommand } from "../realitycheck/scripts/note-check.mjs";
import { runNotePublishCommand } from "../realitycheck/scripts/note-publish.mjs";
import { buildNotePublishManifest } from "../realitycheck/scripts/note-publish-report.mjs";
import { TOOL_VERSION } from "../realitycheck/scripts/version.mjs";

test("runtime surfaces use one version while immutable evidence keeps its producer version", () => {
  const version = readFileSync(resolve("VERSION"), "utf8").trim();
  const packageVersion = JSON.parse(readFileSync(resolve("package.json"), "utf8")).version;
  const referenceVersion = JSON.parse(readFileSync(resolve("examples/reference-run/report.json"), "utf8")).toolVersion;
  const pythonSource = readFileSync(resolve("realitycheck/scripts/report.py"), "utf8");
  assert.equal(version, TOOL_VERSION);
  assert.equal(packageVersion, TOOL_VERSION);
  assert.match(pythonSource, new RegExp(`TOOL_VERSION = ["']${TOOL_VERSION.replaceAll(".", "\\.")}["']`));
  const numeric = (value) => value.split(".").map(Number).reduce((total, part) => total * 1000 + part, 0);
  assert.match(referenceVersion, /^\d+\.\d+\.\d+$/);
  assert.ok(numeric(referenceVersion) <= numeric(TOOL_VERSION), `${referenceVersion} cannot be newer than runtime ${TOOL_VERSION}`);
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
    ["security-headers-broken", 80, 4],
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
      const sri = report.findings.find((item) => item.ruleId === "security-subresource-integrity");
      assert.equal(sri.measurements.missingIntegrity, 1);
      assert.equal(sri.measurements.resourcePathsRetained, false);
      assert.equal(sri.measurements.integrityValuesRetained, false);
      assert.doesNotMatch(serialized, /asset\.js|sha384-|__realityCheckReviewedAsset/);
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

test("directory discovery recognizes only named HTML-note and publish artifacts", () => {
  const directory = mkdtempSync(join(tmpdir(), "realitycheck-note-discovery-"));
  try {
    writeFileSync(join(directory, "random.json"), "{}\n");
    writeFileSync(join(directory, "manifest.json"), "{}\n");
    writeFileSync(join(directory, "ordinary.receipt.json"), "{}\n");
    const named = [
      ["comparison.json", "html-note-check-comparison"],
      ["technical-report.json", "html-note-publish-technical-report"],
      ["browser-proof.json", "html-note-publish-browser-proof"],
      ["demo.realitycheck-working-copy.receipt.json", "html-note-publish-receipt"],
      ["demo.realitycheck-working-copy.manifest.json", "html-note-publish-proof"],
    ];
    for (const [name, kind] of named) writeFileSync(join(directory, name), JSON.stringify({ schemaVersion: "1", kind }), "utf8");
    mkdirSync(join(directory, "realitycheck-proof"));
    writeFileSync(join(directory, "realitycheck-proof", "manifest.json"), JSON.stringify({ schemaVersion: "1", kind: "html-note-publish-proof" }), "utf8");
    const results = validateArtifactFiles([directory]);
    assert.deepEqual(results.map((result) => relative(directory, result.path)).sort(), [
      "browser-proof.json",
      "comparison.json",
      "demo.realitycheck-working-copy.manifest.json",
      "demo.realitycheck-working-copy.receipt.json",
      "realitycheck-proof/manifest.json".replaceAll("/", process.platform === "win32" ? "\\" : "/"),
      "technical-report.json",
    ].sort());
    assert.equal(results.every((result) => result.kind !== "unknown"), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("emitted HTML-note bundles and comparisons pass schema and semantic validation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "realitycheck-note-artifacts-"));
  const note = join(directory, "note.html");
  const before = join(directory, "before");
  const after = join(directory, "after");
  try {
    writeFileSync(note, '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Portable note</title></head><body><main><h1 id="start">Portable note</h1><p>This complete static HTML note contains enough readable content to verify schema-bound note evidence without relying on a browser or a network service.</p><a href="#start">Back to start</a></main></body></html>', "utf8");
    assert.equal(await runNoteCommand([note, "--output", before, "--language", "en"]), 0);
    assert.equal(await runNoteCommand([note, "--output", after, "--baseline", join(before, "report.json"), "--language", "en"]), 0);
    const results = validateArtifactFiles([after]);
    assert.ok(results.some((result) => result.kind === "html-note-check-bundle"));
    assert.ok(results.some((result) => result.kind === "html-note-check-comparison"));
    assert.equal(results.every((result) => result.valid), true, results.flatMap((result) => result.errors).join("\n"));

    const reportPath = join(after, "report.json");
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    report.summary.counts.warning += 1;
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    const [corrupt] = validateArtifactFiles([reportPath]);
    assert.equal(corrupt.valid, false);
    assert.match(corrupt.errors.join("\n"), /summary\/counts\/warning/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function browserProofFixture() {
  const sha = "a".repeat(64);
  const observer = {
    serverRequestCount: 0,
    serverRequests: [],
    coverageTruncated: false,
    consoleTotal: 0,
    consoleByType: {},
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    httpErrors: [],
    unexpectedRequests: [],
    responseVerificationErrors: [],
    responseProof: [{ path: "index.html", bytes: 100, sha256: sha }],
    popups: 0,
    dialogs: 0,
    downloads: 0,
    workers: 0,
    websockets: 0,
    truncatedKinds: [],
  };
  const measurement = { titleLength: 4, textLength: 80, scrollWidth: 800, clientWidth: 800, scrollHeight: 600, elementCount: 8, finalPath: "/", finalHash: "" };
  const page = (id, mount, source, width, height) => ({ id, status: "passed", viewport: { width, height }, source, mount, navigationError: null, measurement: { ...measurement, finalPath: mount }, overflow: false, ...structuredClone(observer) });
  return {
    schemaVersion: "1",
    kind: "html-note-publish-browser-proof",
    profile: "passive-static-v1",
    deploy: { contentId: `sha256:${"b".repeat(64)}`, entrypoint: "index.html", files: 1, bytes: 100, contract: "realitycheck-publish-deploy-content-v1" },
    browser: { name: "Chromium", version: "151.0.7922.174" },
    safety: { javaScriptEnabled: false, serviceWorkers: "block", downloadsAccepted: false, externalRequestsAllowed: false, businessActionsActivated: false, offlineMeaning: "browser-offline-exact-package-replay" },
    archive: { bytes: 1000, sha256: "c".repeat(64), manifestFiles: 1 },
    limits: { maxHtmlFiles: 200, maxFragments: 500, maxLinksPerHtml: 1000, maxTotalLinks: 5000, maxEventRecords: 100, maxRequestRecords: 2000, maxResponseBodies: 1000, maxRecordedTextCharacters: 300, maxRecordedPathCharacters: 500 },
    scenarios: [
      page("desktop-root", "/", "loopback-exact-bytes", 1440, 900),
      page("mobile-375-root", "/", "loopback-exact-bytes", 375, 812),
      page("desktop-project-mount", "/project/", "loopback-exact-bytes", 1440, 900),
      page("mobile-375-project-mount", "/project/", "loopback-exact-bytes", 375, 812),
      page("offline-exact-replay", "/offline/", "offline-exact-replay", 1280, 800),
      { id: "local-pages-and-fragments", status: "passed", source: "loopback-exact-bytes", mount: "/project/", htmlFiles: 1, totalLinks: 0, fragments: 0, failures: [], ...structuredClone(observer) },
    ],
    screenshots: [],
    evidenceTruncated: false,
    passed: true,
  };
}

test("browser-proof semantics reject a passed claim without its two bound screenshots", () => {
  const directory = mkdtempSync(join(tmpdir(), "realitycheck-browser-proof-"));
  try {
    const path = join(directory, "browser-proof.json");
    writeFileSync(path, `${JSON.stringify(browserProofFixture(), null, 2)}\n`, "utf8");
    const [result] = validateArtifactFiles([path]);
    assert.equal(result.kind, "html-note-publish-browser-proof");
    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /passed does not match scenario and screenshot evidence/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("public publish manifest IDs are recomputed instead of trusted", () => {
  const directory = mkdtempSync(join(tmpdir(), "realitycheck-publish-manifest-"));
  try {
    const platforms = {
      netlifyDrop: { status: "block", reasons: ["required-gate-failed"] },
      cloudflarePagesDirectUpload: { status: "block", reasons: ["cloudflare-direct-upload-cannot-switch-to-git", "required-gate-failed"] },
      githubPages: { status: "block", reasons: ["github-pages-zip-requires-extraction-or-action", "required-gate-failed"] },
    };
    const manifest = buildNotePublishManifest({ generatedAt: new Date().toISOString(), deployContentId: `sha256:${"d".repeat(64)}`, browserProofId: null, status: "browser-proof-required", platformDecisions: platforms, findingsSummary: { errors: 0, warnings: 0, advice: 0, unverified: 0 } });
    const path = join(directory, "note.realitycheck-working-copy.manifest.json");
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    let [result] = validateArtifactFiles([directory]);
    assert.equal(result.valid, true, result.errors.join("\n"));
    manifest.manifestId = `sha256:${"e".repeat(64)}`;
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    [result] = validateArtifactFiles([directory]);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /manifestId/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("static publish receipts verify their sibling ZIP, sidecar, embedded manifest, and technical report", async () => {
  const directory = mkdtempSync(join(tmpdir(), "realitycheck-publish-artifacts-"));
  const source = join(directory, "source");
  const output = join(directory, "publish");
  try {
    mkdirSync(source);
    writeFileSync(join(source, "index.html"), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Publish capsule</title></head><body><main><h1>Publish capsule</h1><p>This passive static note contains enough useful readable content for deterministic preflight, archive readback, and receipt validation.</p></main></body></html>', "utf8");
    assert.equal(await runNotePublishCommand([join(source, "index.html"), "--static-only", "--output", output, "--language", "en"]), 1);
    const run = join(output, readdirSync(output, { withFileTypes: true }).find((entry) => entry.isDirectory()).name);
    const results = validateArtifactFiles([run]);
    assert.ok(results.some((result) => result.kind === "html-note-publish-receipt"));
    assert.ok(results.some((result) => result.kind === "html-note-publish-technical-report"));
    assert.equal(results.every((result) => result.valid), true, results.flatMap((result) => result.errors).join("\n"));

    const receiptResult = results.find((result) => result.kind === "html-note-publish-receipt");
    const receipt = JSON.parse(readFileSync(receiptResult.path, "utf8"));
    const archivePath = join(run, receipt.archive.filename);
    const archive = readFileSync(archivePath);
    archive[40] ^= 0xff;
    writeFileSync(archivePath, archive);
    const [corrupt] = validateArtifactFiles([receiptResult.path]);
    assert.equal(corrupt.valid, false);
    assert.match(corrupt.errors.join("\n"), /sha256|readback/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

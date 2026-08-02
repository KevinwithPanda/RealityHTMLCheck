import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateArtifactFiles } from "../realitycheck/scripts/artifact-validator.mjs";
import { buildLatestRun, renderLatestRunHtml, updateLatestRunArtifacts, writeLatestRun } from "../realitycheck/scripts/latest-run.mjs";

test("latest-run pointer keeps portable links to the newest complete evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-latest-"));
  try {
    const run = join(root, "20260801T170000Z-demo");
    const manifest = buildLatestRun({
      artifactKind: "page-audit",
      outputRoot: root,
      runId: "20260801T170000Z-demo",
      target: "http://127.0.0.1:4175/examples/waiver-lab/index.html",
      score: 96,
      gateFailed: true,
      updatedAt: new Date("2026-08-01T17:01:00Z"),
      artifacts: {
        html: join(run, "report.html"),
        json: join(run, "report.json"),
        repairPlanJson: join(run, "repair-plan.json"),
        repairPlanMarkdown: join(run, "repair-plan.md"),
      },
    });
    assert.equal(manifest.state, "failed");
    assert.equal(manifest.artifacts.html, "20260801T170000Z-demo/report.html");
    const outputs = writeLatestRun(manifest, root);
    assert.equal(updateLatestRunArtifacts({ outputRoot: root, runId: "historical-run", artifacts: { attestationHtml: join(run, "old.html") } }), false);
    assert.throws(() => updateLatestRunArtifacts({ outputRoot: root, runId: manifest.runId, artifacts: { attestationHtml: join(root, "..", "escape.html") } }), /must stay inside/);
    assert.equal(updateLatestRunArtifacts({ outputRoot: root, runId: manifest.runId, updatedAt: "2026-08-01T17:02:00Z", artifacts: { attestationHtml: join(run, "evidence-attestation.html") } }), true);
    const updated = JSON.parse(readFileSync(outputs.jsonPath, "utf8"));
    assert.equal(updated.artifacts.attestationHtml, "20260801T170000Z-demo/evidence-attestation.html");
    const html = readFileSync(outputs.htmlPath, "utf8");
    assert.match(html, /Latest complete evidence\./);
    assert.match(html, /最近一次完整证据。/);
    assert.match(html, /20260801T170000Z-demo\/report\.html/);
    assert.match(html, /Open repair plan/);
    assert.match(html, /Open signed receipt/);
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    assert.doesNotThrow(() => new Function(script));
    const [validation] = validateArtifactFiles([outputs.jsonPath]);
    assert.equal(validation.kind, "latest-run");
    assert.equal(validation.valid, true, validation.errors.join("\n"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("latest-run pointer rejects artifacts outside its output root", () => {
  const root = join(tmpdir(), "realitycheck-latest-root");
  assert.throws(() => buildLatestRun({
    artifactKind: "page-audit",
    outputRoot: root,
    runId: "run",
    target: "http://127.0.0.1:4175/",
    score: 100,
    gateFailed: false,
    artifacts: { html: join(root, "..", "report.html"), json: join(root, "run", "report.json") },
  }), /must stay inside/);
});

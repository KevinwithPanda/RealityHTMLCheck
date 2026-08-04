import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  approveVisualBaseline,
  resolveVisualBaselineDirectory,
  visualBaselineFilename,
} from "../realitycheck/scripts/visual-regression.mjs";

const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("visual baseline keys are pathname-only and query-free", () => {
  const local = visualBaselineFilename("http://127.0.0.1:3000/settings?token=secret#panel");
  const staging = visualBaselineFilename("https://staging.example.test/settings?different=value");
  assert.equal(local, staging);
  assert.match(local, /^settings-[a-f0-9]{12}\.png$/);
  assert.doesNotMatch(local, /token|secret|different/);
});

test("visual approval is idempotent and requires explicit replacement", () => {
  const directory = join(tmpdir(), `realitycheck-visual-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const reportDirectory = join(directory, "run");
  const screenshotDirectory = join(reportDirectory, "screenshots");
  mkdirSync(screenshotDirectory, { recursive: true });
  const reportPath = join(reportDirectory, "report.json");
  const source = join(screenshotDirectory, "visual-current.png");
  writeFileSync(source, ONE_PIXEL_PNG);
  const report = {
    run: { id: "visual-run-1" },
    target: { requestedUrl: "http://127.0.0.1:3000/settings", finalUrl: "http://127.0.0.1:3000/settings" },
    adapter: { capabilities: ["explicit-visual-regression-baseline"] },
  };
  const policy = { baselineDirectory: "baselines" };
  try {
    assert.throws(() => approveVisualBaseline({ report: { ...report, adapter: { capabilities: [] } }, reportPath, configDirectory: directory, policy }), /not produced with explicit visual/);
    const first = approveVisualBaseline({ report, reportPath, configDirectory: directory, policy, now: new Date("2026-08-05T00:00:00Z") });
    assert.equal(first.replaced, false);
    assert.equal(first.unchanged, false);
    assert.equal(existsSync(first.destination), true);
    const repeated = approveVisualBaseline({ report, reportPath, configDirectory: directory, policy, now: new Date("2026-08-05T00:01:00Z") });
    assert.equal(repeated.unchanged, true);

    writeFileSync(source, Buffer.concat([ONE_PIXEL_PNG, Buffer.from("reviewed-change")]));
    assert.throws(() => approveVisualBaseline({ report, reportPath, configDirectory: directory, policy }), /--replace-baseline/);
    const replaced = approveVisualBaseline({ report: { ...report, run: { id: "visual-run-2" } }, reportPath, configDirectory: directory, policy, replace: true, now: new Date("2026-08-05T00:02:00Z") });
    assert.equal(replaced.replaced, true);
    const index = JSON.parse(readFileSync(replaced.indexPath, "utf8"));
    assert.equal(index.entries.length, 1);
    assert.equal(index.entries[0].pathname, "/settings");
    assert.equal(index.entries[0].sourceRunId, "visual-run-2");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("visual baseline directories cannot escape the project", () => {
  const directory = join(tmpdir(), `realitycheck-visual-root-${Date.now()}`);
  mkdirSync(directory, { recursive: true });
  try {
    assert.throws(() => resolveVisualBaselineDirectory(directory, "../outside"), /child/);
    assert.throws(() => resolveVisualBaselineDirectory(directory, "."), /child/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

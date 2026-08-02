import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { validateArtifactFiles } from "../realitycheck/scripts/artifact-validator.mjs";
import { buildRiskRegister, writeRiskRegister } from "../realitycheck/scripts/risk-register.mjs";

test("risk register deduplicates recurring findings and proves resolution conservatively", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-risks-"));
  try {
    const beforeDirectory = join(root, "runs", "before");
    const afterDirectory = join(root, "runs", "after");
    const output = join(root, "register");
    const driftBeforeDirectory = join(root, "runs", "drift-before");
    const driftAfterDirectory = join(root, "runs", "drift-after");
    const openDirectory = join(root, "runs", "open");
    mkdirSync(beforeDirectory, { recursive: true });
    mkdirSync(afterDirectory, { recursive: true });
    mkdirSync(driftBeforeDirectory, { recursive: true });
    mkdirSync(driftAfterDirectory, { recursive: true });
    mkdirSync(openDirectory, { recursive: true });
    const source = JSON.parse(readFileSync(resolve("examples/reference-run/report.json"), "utf8"));
    const before = structuredClone(source);
    const after = structuredClone(source);
    for (const report of [before, after]) {
      report.target.requestedUrl = "http://127.0.0.1:4180/dashboard";
      report.target.finalUrl = "http://127.0.0.1:4180/dashboard";
    }
    before.run.id = "risk-before";
    before.run.startedAt = "2026-08-01T10:00:00Z";
    before.run.finishedAt = "2026-08-01T10:01:00Z";
    before.findings = before.findings.slice(0, 2);
    after.run.id = "risk-after";
    after.run.startedAt = "2026-08-02T10:00:00Z";
    after.run.finishedAt = "2026-08-02T10:01:00Z";
    after.findings = [structuredClone(before.findings[1])];
    after.findings[0].title = "=SUM(1,1) must not execute in CSV";
    after.findings[0].ownership = { id: "web-platform", name: "Web Platform" };
    after.findings[0].waiver = { id: "risk-waiver", reason: "Tracked in WEB-92", owner: "Web Platform", expires: "2027-01-31" };
    writeFileSync(join(beforeDirectory, "report.json"), JSON.stringify(before), "utf8");
    writeFileSync(join(afterDirectory, "report.json"), JSON.stringify(after), "utf8");
    const driftBefore = structuredClone(source);
    const driftAfter = structuredClone(source);
    for (const report of [driftBefore, driftAfter]) {
      report.target.requestedUrl = "http://127.0.0.1:4181/drift";
      report.target.finalUrl = "http://127.0.0.1:4181/drift";
    }
    driftBefore.run.id = "drift-before";
    driftBefore.run.startedAt = "2026-08-01T11:00:00Z";
    driftBefore.run.finishedAt = "2026-08-01T11:01:00Z";
    driftBefore.config.policyFingerprint = `sha256:${"a".repeat(64)}`;
    driftBefore.findings = [driftBefore.findings[2]];
    driftAfter.run.id = "drift-after";
    driftAfter.run.startedAt = "2026-08-02T11:00:00Z";
    driftAfter.run.finishedAt = "2026-08-02T11:01:00Z";
    driftAfter.config.policyFingerprint = `sha256:${"b".repeat(64)}`;
    driftAfter.findings = [];
    writeFileSync(join(driftBeforeDirectory, "report.json"), JSON.stringify(driftBefore), "utf8");
    writeFileSync(join(driftAfterDirectory, "report.json"), JSON.stringify(driftAfter), "utf8");
    const open = structuredClone(source);
    open.target.requestedUrl = "http://127.0.0.1:4182/open";
    open.target.finalUrl = "http://127.0.0.1:4182/open";
    open.run.id = "risk-open";
    open.run.startedAt = "2026-08-01T09:00:00Z";
    open.run.finishedAt = "2026-08-01T09:01:00Z";
    open.findings = [open.findings[3]];
    writeFileSync(join(openDirectory, "report.json"), JSON.stringify(open), "utf8");

    const register = buildRiskRegister([join(root, "runs")], output, { now: new Date("2026-08-03T10:00:00Z"), maxOpenAgeDays: 1, maxOpenRisks: 0, maxRecurringRisks: 0 });
    assert.deepEqual(register.summary, { risks: 4, open: 1, recurring: 1, overdue: 1, waived: 1, resolved: 1, unverified: 1, targets: 3, runs: 5 });
    assert.equal(register.entries.find((item) => item.state === "open").overdue, true);
    assert.equal(register.policy.gateFailed, true);
    assert.deepEqual(register.policy.violations, [
      { code: "open-risk-age", actual: 1 + 1, expected: 1 },
      { code: "open-risk-count", actual: 1, expected: 0 },
      { code: "recurring-risk-count", actual: 1, expected: 0 },
    ]);
    assert.equal(register.entries.find((item) => item.state === "resolved").occurrences, 1);
    const waived = register.entries.find((item) => item.state === "waived");
    assert.equal(waived.occurrences, 2);
    assert.equal(waived.ownership.name, "Web Platform");
    assert.match(waived.evidencePath, /#RC-/);
    assert.equal(register.entries.find((item) => item.state === "unverified").unverifiedReason, "policy-drift");

    const outputs = writeRiskRegister(register, output);
    const html = readFileSync(outputs.htmlPath, "utf8");
    const csv = readFileSync(outputs.csvPath, "utf8");
    const markdown = readFileSync(outputs.markdownPath, "utf8");
    assert.match(html, /Recurring risk, made accountable\./);
    assert.match(html, /让反复风险可追踪、可负责。/);
    assert.match(html, /data-filter="resolved"/);
    assert.match(html, /data-filter="recurring"/);
    assert.match(html, /data-filter="overdue"/);
    assert.match(html, /data-recurring="true"/);
    assert.match(html, /data-overdue="true"/);
    assert.match(html, /Web Platform/);
    assert.match(html, /detector policy drifted/);
    assert.match(csv, /"'=SUM\(1,1\) must not execute in CSV"/);
    assert.match(markdown, /Risks: \*\*4\*\*/);
    assert.match(markdown, /Risk policy: \*\*FAILED\*\*/);
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    assert.doesNotThrow(() => new Function(script));
    const [validation] = validateArtifactFiles([outputs.jsonPath]);
    assert.equal(validation.kind, "risk-register");
    assert.equal(validation.valid, true, validation.errors.join("\n"));
    const tamperedRegister = structuredClone(register);
    tamperedRegister.policy.gateFailed = false;
    tamperedRegister.summary.open = 0;
    writeFileSync(outputs.jsonPath, JSON.stringify(tamperedRegister), "utf8");
    const tamperedValidation = validateArtifactFiles([outputs.jsonPath])[0];
    assert.equal(tamperedValidation.valid, false);
    assert.match(tamperedValidation.errors.join("\n"), /summary\/open does not match|gateFailed does not match/);
    writeRiskRegister(register, output);
    const cliOutput = join(root, "cli-register");
    const cli = spawnSync(process.execPath, ["realitycheck/scripts/audit.mjs", "risk-register", join(root, "runs"), "--output", cliOutput, "--max-open-age-days", "1", "--max-open-risks", "0", "--max-recurring-risks", "0"], { encoding: "utf8" });
    assert.equal(cli.status, 1, `${cli.stdout}\n${cli.stderr}`);
    assert.match(cli.stdout, /risk policy:\s+FAIL/);
    assert.equal(validateArtifactFiles([join(cliOutput, "risk-register.json")])[0].valid, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

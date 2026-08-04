import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { validateArtifactFiles } from "../realitycheck/scripts/artifact-validator.mjs";
import { buildIssueDrafts, renderIssueDraftsCsv, renderIssueDraftsHtml, renderIssueDraftsMarkdown, writeIssueDrafts } from "../realitycheck/scripts/issue-drafts.mjs";

function fixture(root, name, mutate = () => {}) {
  const directory = join(root, name);
  cpSync(resolve("examples/reference-run"), directory, { recursive: true });
  const path = join(directory, "repair-plan.json");
  const value = JSON.parse(readFileSync(path, "utf8"));
  mutate(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return { directory, path };
}

test("issue drafts convert repair evidence into deduplicated, private, reviewable handoffs", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-issue-drafts-"));
  try {
    const first = fixture(root, "first", (plan) => {
      plan.source.target = "https://example.test/checkout?token=do-not-copy#private";
      plan.items[0].title = "Alert @security <script> before release";
      plan.items[1].fingerprint = "legacy-fingerprint-v0.2";
    });
    const output = join(root, "out");
    const bundle = buildIssueDrafts([first.path], output, { now: new Date("2026-08-05T02:00:00Z") });
    assert.deepEqual(bundle.summary, { drafts: 6, occurrences: 6, duplicates: 0, actionable: 5, review: 1, waived: 0, critical: 0, major: 2, minor: 4, info: 0 });
    assert.equal(bundle.drafts[0].severity, "major");
    assert.equal(bundle.drafts.every((draft) => draft.labels.includes("realitycheck")), true);
    assert.equal(bundle.drafts.every((draft) => draft.verification.requireFingerprintAbsent), true);
    assert.match(bundle.drafts.find((draft) => draft.fingerprint === "legacy-fingerprint-v0.2").id, /^ISSUE-[A-F0-9]{12}$/);
    const serialized = JSON.stringify(bundle);
    assert.doesNotMatch(serialized, /do-not-copy|#private|<script>|@security/);
    assert.match(serialized, /https:\/\/example\.test\/checkout/);
    assert.match(serialized, /@​security/);
    assert.match(renderIssueDraftsMarkdown(bundle, "zh-CN"), /GitHub 工单草稿/);
    assert.match(renderIssueDraftsCsv(bundle), /^"id","title"/);
    const html = renderIssueDraftsHtml(bundle);
    assert.match(html, /NO AUTO-SUBMISSION/);
    assert.match(html, /navigator\.clipboard\.writeText/);
    assert.match(html, /TITLE\\n/);
    assert.match(html, /data-en="Open evidence"/);
    assert.match(html, /data-aria-zh="搜索草稿"/);
    assert.match(html, /querySelector\('\.copied'\)/);
    assert.doesNotMatch(html, /status=b\.nextElementSibling/);
    assert.match(html, /data-filter="actionable"/);
    assert.match(html, /Content-Security-Policy/);
    assert.doesNotMatch(html, /<script[^>]+src=/);
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    assert.doesNotThrow(() => new Function(script));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("issue drafts merge repeated fingerprints while retaining each evidence occurrence", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-issue-dedupe-"));
  try {
    const first = fixture(root, "one", (plan) => { plan.items[0].ownership = { id: "web-a", name: "Web A" }; });
    const second = fixture(root, "two", (plan) => {
      plan.source.runId = "second-run";
      plan.items[0].ownership = { id: "web-b", name: "Web B" };
    });
    const bundle = buildIssueDrafts([first.directory, second.directory], join(root, "out"), { now: new Date("2026-08-05T02:00:00Z") });
    assert.equal(bundle.summary.drafts, 6);
    assert.equal(bundle.summary.occurrences, 12);
    assert.equal(bundle.summary.duplicates, 6);
    assert.equal(bundle.drafts.every((draft) => draft.occurrences.length === 2), true);
    assert.equal(new Set(bundle.drafts.map((draft) => draft.fingerprint)).size, 6);
    const ownershipConflict = bundle.drafts.find((draft) => draft.ruleId === "element-text-clipping");
    assert.equal(ownershipConflict.disposition, "review");
    assert.equal(ownershipConflict.owner, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("waived findings keep safe governance metadata without copying reasons", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-issue-waiver-"));
  try {
    const source = fixture(root, "waived", (plan) => {
      plan.items[0].waiver = { id: "accepted-until-q4", reason: "Private customer migration detail", owner: "Release Council", expires: "2026-10-31" };
    });
    const bundle = buildIssueDrafts([source.path], join(root, "out"), { now: new Date("2026-08-05T02:00:00Z") });
    assert.equal(bundle.summary.actionable, 4);
    assert.equal(bundle.summary.review, 1);
    assert.equal(bundle.summary.waived, 1);
    const draft = bundle.drafts.find((item) => item.waiver?.id === "accepted-until-q4");
    assert.equal(draft.disposition, "waived");
    assert.deepEqual(draft.waiver, { id: "accepted-until-q4", expires: "2026-10-31" });
    const serialized = JSON.stringify(bundle);
    assert.doesNotMatch(serialized, /Private customer migration detail|Release Council/);
    assert.match(draft.body, /Active waiver/);
    assert.match(draft.bodyZh, /有效豁免/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("issue draft artifacts validate and the CLI never submits them", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-issue-cli-"));
  try {
    const source = fixture(root, "run");
    const output = join(root, "drafts");
    const bundle = buildIssueDrafts([source.path], output, { now: new Date("2026-08-05T02:00:00Z") });
    const outputs = writeIssueDrafts(bundle, output);
    const [validation] = validateArtifactFiles([outputs.jsonPath]);
    assert.equal(validation.kind, "github-issue-drafts");
    assert.equal(validation.valid, true, validation.errors.join("\n"));
    assert.match(readFileSync(outputs.markdownZhPath, "utf8"), /绝不|人工复核/);
    assert.match(readFileSync(outputs.csvPath, "utf8"), /"severity"/);

    const cliOutput = join(root, "cli");
    const cli = spawnSync(process.execPath, ["realitycheck/scripts/audit.mjs", "issue-drafts", source.path, "--output", cliOutput], { encoding: "utf8" });
    assert.equal(cli.status, 0, `${cli.stdout}\n${cli.stderr}`);
    assert.match(cli.stdout, /6 \(5 actionable, 1 review/);
    const rejected = spawnSync(process.execPath, ["realitycheck/scripts/audit.mjs", "issue-drafts", source.path, "--mode", "deep"], { encoding: "utf8" });
    assert.equal(rejected.status, 2, `${rejected.stdout}\n${rejected.stderr}`);
    assert.match(rejected.stderr, /--output only/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

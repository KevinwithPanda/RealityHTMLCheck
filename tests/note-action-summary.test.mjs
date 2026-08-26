import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  buildNoteGitHubSummary,
  buildNoteWorkflowAnnotations,
  run,
} from "../realitycheck/scripts/note-github-summary.mjs";

function fixture() {
  return {
    kind: "html-note-check-bundle",
    summary: {
      status: "needs-fix",
      score: 42,
      files: 2,
      counts: { error: 1, warning: 2, advice: 0, autoFixable: 1 },
    },
    reports: [
      {
        path: "notes/index.html",
        findings: [
          {
            id: "RC-NOTE-001",
            level: "error",
            title: { en: "Broken attachment", zhCN: "附件缺失" },
            summary: { en: "The image is missing.\n::warning::not a command", zhCN: "图片文件不存在。" },
            remediation: { en: "Restore the image.", zhCN: "恢复图片文件。" },
            evidence: [{ path: "notes/image,one.html", line: 8, excerpt: "missing" }],
          },
          {
            id: "RC-NOTE-002",
            level: "warning",
            title: { en: "Review remote CSS", zhCN: "复核远程样式" },
            summary: { en: "The note depends on a remote stylesheet.", zhCN: "笔记依赖远程样式。" },
            remediation: { en: "Bundle the stylesheet when portability matters.", zhCN: "需要便携时请打包样式。" },
            evidence: [{ path: "../outside.html", line: 3, excerpt: "remote" }],
          },
        ],
      },
      { path: "notes/clean.html", findings: [] },
    ],
    packageFindings: [
      {
        id: "NOTE-CSS-MISSING-LOCAL-FILE",
        level: "warning",
        title: { en: "Missing stylesheet asset", zhCN: "样式表资源缺失" },
        summary: { en: "A CSS dependency is missing.", zhCN: "CSS 依赖不存在。" },
        remediation: { en: "Restore the dependency.", zhCN: "恢复该依赖。" },
        evidence: [{ path: "styles/main.css", line: 12, excerpt: "url(missing.png)" }],
      },
    ],
  };
}

function baselineFixture() {
  const bundle = fixture();
  const [errorFinding, warningFinding] = bundle.reports[0].findings;
  const packageFinding = bundle.packageFindings[0];
  const item = (state, finding, scope, reason, before = null, after = null) => ({
    fingerprint: `${scope.kind}:${scope.path || ""}::${finding.id}`,
    state,
    scope,
    ruleId: finding.id.toLowerCase(),
    beforeAffectedCount: before ? 1 : 0,
    afterAffectedCount: after ? 1 : 0,
    affectedCountDelta: 0,
    reason,
    details: {},
    before,
    after,
  });
  bundle.comparison = {
    schemaVersion: "1",
    kind: "html-note-check-comparison",
    counts: { new: 1, resolved: 1, worsened: 1, persistent: 1, unverified: 1, regressions: 3, active: 3, compared: 5 },
    new: [item("new", errorFinding, { kind: "html", path: "notes/index.html" }, "not-present-in-baseline", null, errorFinding)],
    worsened: [item("worsened", packageFinding, { kind: "package" }, "affected-count-increased", packageFinding, packageFinding)],
    unverified: [item("unverified", warningFinding, { kind: "html", path: "notes/removed.html" }, "html-scope-missing", warningFinding, null)],
    resolved: [item("resolved", warningFinding, { kind: "html", path: "notes/clean.html" }, "not-detected-in-complete-scope", warningFinding, null)],
    persistent: [item("persistent", warningFinding, { kind: "html", path: "notes/index.html" }, "still-detected", warningFinding, warningFinding)],
    regressionsByLevel: { error: 1, warning: 2, advice: 0, total: 3 },
    gate: { mode: "baseline-regressions-only", failOn: "warning", failed: true, states: ["new", "worsened", "unverified"] },
    warnings: [],
  };
  return bundle;
}

test("note Action summary leads with the share decision and lowest-file scope", () => {
  const summary = buildNoteGitHubSummary(fixture(), "en");
  assert.match(summary, /Do not share yet/);
  assert.match(summary, /42\/100/);
  assert.match(summary, /lowest HTML file score adjusted by package dependency findings/);
  assert.match(summary, /did not upload source notes/);
  assert.match(summary, /generated report with bounded evidence excerpts/);
  assert.match(summary, /RC\\-NOTE\\-001/);
  assert.match(summary, /NOTE\\-CSS\\-MISSING\\-LOCAL\\-FILE/);
  assert.match(summary, /styles\/main\.css:12/);
});

test("note Action annotations encode properties and neutralize workflow-command text", () => {
  const annotations = buildNoteWorkflowAnnotations(fixture(), "en", 20, "exported-notes");
  assert.equal(annotations.length, 3);
  assert.match(annotations[0], /^::error /);
  assert.match(annotations[0], /file=exported-notes\/notes\/image%2Cone\.html/);
  assert.match(annotations[0], /line=8/);
  assert.doesNotMatch(annotations[0], /\n::warning::/);
  assert.doesNotMatch(annotations[1], /file=\.\.\//);
  assert.equal(annotations.some((item) => /file=exported-notes\/styles\/main\.css/.test(item) && /line=12/.test(item)), true);
  assert.equal(annotations.some((item) => /NOTE-CSS-MISSING-LOCAL-FILE/.test(item) && /notes\/index\.html/.test(item)), false);
  const noLocation = fixture();
  noLocation.packageFindings[0].evidence = [];
  const packageAnnotation = buildNoteWorkflowAnnotations(noLocation, "en", 20, "exported-notes").find((item) => /NOTE-CSS-MISSING-LOCAL-FILE/.test(item));
  assert.doesNotMatch(packageAnnotation, /file=|line=|notes\/index\.html/);
  assert.throws(() => buildNoteWorkflowAnnotations(fixture(), "en", 20, "../outside"), /safe relative path/);
});

test("note Action summary CLI writes bounded bilingual Markdown", () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-note-action-"));
  try {
    const report = join(root, "report.json");
    const output = join(root, "summary.md");
    writeFileSync(report, JSON.stringify(fixture()), "utf8");
    const logged = [];
    const originalLog = console.log;
    console.log = (value) => logged.push(value);
    try {
      assert.equal(run([report, "--output", output, "--language", "zh-CN", "--max-annotations", "1"]), 0);
    } finally {
      console.log = originalLog;
    }
    assert.equal(logged.some((value) => String(value).startsWith("::error ")), true);
    const summary = readFileSync(output, "utf8");
    assert.match(summary, /暂不建议分享/);
    assert.match(summary, /附件缺失/);
    assert.match(summary, /latest\.html/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("note Action baseline summary shows diff counts and annotates regressions without persistent debt", () => {
  const bundle = baselineFixture();
  const summary = buildNoteGitHubSummary(bundle, "en");
  assert.match(summary, /Regression gate failed/);
  assert.match(summary, /Changes since baseline/);
  assert.match(summary, /\| 1 \| 1 \| 1 \| 1 \| 1 \|/);
  assert.match(summary, /persistent baseline finding\(s\) do not keep the job red/);
  assert.match(summary, /comparison\.html/);
  const annotations = buildNoteWorkflowAnnotations(bundle, "en", 20, "exported-notes");
  assert.equal(annotations.length, 3);
  assert.equal(annotations.some((value) => /RealityCheck persistent|PERSISTENT/.test(value)), false);
  assert.equal(annotations.some((value) => /RealityCheck resolved|RESOLVED/.test(value)), false);
  assert.equal(annotations.some((value) => /RealityCheck new/.test(value)), true);
  assert.equal(annotations.some((value) => /RealityCheck worsened/.test(value)), true);
  const unverified = annotations.find((value) => /RealityCheck unverified/.test(value));
  assert.ok(unverified);
  assert.doesNotMatch(unverified, /file=/, "a removed HTML scope must not emit a stale file annotation");
});

test("note Action summary rejects non-note artifacts", () => {
  assert.throws(() => buildNoteGitHubSummary({ kind: "site-audit" }), /HTML note report bundle/);
  assert.throws(() => buildNoteWorkflowAnnotations(fixture(), "en", 51), /1 to 50/);
});

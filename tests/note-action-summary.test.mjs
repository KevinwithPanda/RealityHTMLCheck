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
      counts: { error: 1, warning: 1, advice: 0, autoFixable: 1 },
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
  };
}

test("note Action summary leads with the share decision and lowest-file scope", () => {
  const summary = buildNoteGitHubSummary(fixture(), "en");
  assert.match(summary, /Do not share yet/);
  assert.match(summary, /42\/100/);
  assert.match(summary, /lowest file score/);
  assert.match(summary, /did not upload source notes/);
  assert.match(summary, /generated report with bounded evidence excerpts/);
  assert.match(summary, /RC\\-NOTE\\-001/);
});

test("note Action annotations encode properties and neutralize workflow-command text", () => {
  const annotations = buildNoteWorkflowAnnotations(fixture(), "en", 20, "exported-notes");
  assert.equal(annotations.length, 2);
  assert.match(annotations[0], /^::error /);
  assert.match(annotations[0], /file=exported-notes\/notes\/image%2Cone\.html/);
  assert.match(annotations[0], /line=8/);
  assert.doesNotMatch(annotations[0], /\n::warning::/);
  assert.doesNotMatch(annotations[1], /file=\.\.\//);
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

test("note Action summary rejects non-note artifacts", () => {
  assert.throws(() => buildNoteGitHubSummary({ kind: "site-audit" }), /HTML note report bundle/);
  assert.throws(() => buildNoteWorkflowAnnotations(fixture(), "en", 51), /1 to 50/);
});

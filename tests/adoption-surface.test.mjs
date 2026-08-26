import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("community HTML export intake is versioned, privacy-safe, and evidence-bounded", () => {
  const template = readFileSync(".github/ISSUE_TEMPLATE/html-note-export.yml", "utf8");
  assert.match(template, /Exporting tool and version/);
  assert.match(template, /Platform where the export was created/);
  assert.match(template, /Public sanitized fixture or reproduction link/);
  assert.match(template, /removed personal, confidential, credential, account, and proprietary content/);
  assert.match(template, /not official or universal vendor compatibility/);
  assert.match(template, /MIT-licensed regression evidence/);
});

test("HTML note Action adoption has a complete copy-ready workflow", () => {
  const workflow = readFileSync("examples/github-actions/html-note-gate.yml", "utf8");
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /actions\/checkout@v7/);
  assert.match(workflow, /KevinwithPanda\/RealityHTMLCheck@v0\.8\.0/);
  assert.match(workflow, /kind: note/);
  assert.match(workflow, /path: exported-notes/);
  assert.match(workflow, /artifact-name: realitycheck-html-notes/);
  assert.match(workflow, /baseline: realitycheck-baselines\/html-notes\/report\.json/);
  assert.doesNotMatch(workflow, /npm (?:ci|install)|url:/);
});

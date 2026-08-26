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
  assert.match(workflow, /KevinwithPanda\/RealityHTMLCheck@v0\.11\.0/);
  assert.match(workflow, /kind: note/);
  assert.match(workflow, /path: exported-notes/);
  assert.match(workflow, /artifact-name: realitycheck-html-notes/);
  assert.match(workflow, /baseline: realitycheck-baselines\/html-notes\/report\.json/);
  assert.doesNotMatch(workflow, /npm (?:ci|install)|url:/);
});

test("verified publish Action adoption has a minimal permission-bounded workflow", () => {
  const workflow = readFileSync("examples/github-actions/verified-publish.yml", "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /KevinwithPanda\/RealityHTMLCheck@v0\.11\.0/);
  assert.match(workflow, /kind: publish/);
  assert.match(workflow, /path: exported-site/);
  assert.match(workflow, /artifact-name: verified-html-publish-capsule/);
  assert.match(workflow, /publish-archive-sha256/);
  assert.match(workflow, /complete HTML, images, styles, and/);
  assert.match(workflow, /never deploys a site/);
  assert.doesNotMatch(workflow, /pages: write|id-token: write|deploy-pages|NETLIFY|CLOUDFLARE/);
});

test("verified publish Action preserves one exact run and never deploys it", () => {
  const action = readFileSync("action.yml", "utf8");
  for (const value of [
    "kind is publish",
    "entry:",
    "publish-name:",
    'publish_run_key="action-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"',
    "realitycheck/scripts/action-publish-result.mjs",
    "realitycheck/scripts/note-publish-github-summary.mjs",
    "--result-json",
    "mktemp -d",
    "trap cleanup_publish_result EXIT",
    "publish-ready",
    "publish-archive-path",
    "publish-working-copy-path",
    "publish-deploy-content-id",
    "publish-archive-sha256",
    "publish-artifact-id",
    "publish-artifact-url",
    "publish-artifact-digest",
    "Upload the exact RealityCheck publish run",
    "compression-level: 0",
    "full HTML/site bytes",
    "Action never deploys",
    "Validated repair plan",
  ]) assert.match(action, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(action, /steps\.resolve\.outputs\.kind == 'web' \|\| steps\.resolve\.outputs\.kind == 'publish'/);
  assert.match(action, /steps\.resolve\.outputs\.kind == 'web' \|\| \(steps\.resolve\.outputs\.kind == 'note'/);
  assert.match(action, /Publish mode does not accept fail-on, baseline, exclude-html, url, or config/);
  assert.match(action, /Publish mode does not accept allow-remote/);
  assert.match(action, /path: \$\{\{ steps\.publish\.outputs\.run-directory-absolute \}\}/);
  assert.match(action, /RC_REPAIR_PLAN: \$\{\{ steps\.publish\.outputs\.repair-plan-path-absolute \}\}/);
  assert.match(action, /value: \$\{\{ steps\.publish\.outputs\.publish-status \}\}/);
  assert.match(action, /value: \$\{\{ steps\.publish\.outputs\.run-directory \}\}/);
  assert.match(action, /RC_PUBLISH_UPLOAD_OUTCOME/);
  assert.doesNotMatch(action, /result_json="\$RUNNER_TEMP\/realitycheck-publish-result-/);
  assert.doesNotMatch(action, /actions\/deploy-pages|wrangler pages deploy|netlify deploy/i);
  assert.ok(action.indexOf("Upload the exact RealityCheck publish run") < action.indexOf("Enforce the RealityCheck result"));
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the public Golden Path joins check, no-clone Skill repair, and live proof", () => {
  const homepage = readFileSync("site/index.html", "utf8");
  const notePage = readFileSync("site/note.html", "utf8");
  const noteChecker = readFileSync("site/note-checker.js", "utf8");
  const readme = readFileSync("README.md", "utf8");
  const chineseGuide = readFileSync("docs/README.zh-CN.md", "utf8");
  const llms = readFileSync("site/llms.txt", "utf8");
  const installerPath = "https://github.com/KevinwithPanda/RealityHTMLCheck/tree/v0.13.0/realitycheck";
  const receiptPath = "evidence/live-canary/latest/deployment-receipt.html";

  assert.ok(homepage.indexOf('href="note.html" data-en="1 · Check online"') < homepage.indexOf('href="#codex-repair" data-en="2 · Repair in Codex"'));
  assert.ok(homepage.indexOf('href="#codex-repair" data-en="2 · Repair in Codex"') < homepage.indexOf('href="#start" data-en="3 · Publish &amp; prove"'));
  assert.match(homepage, /id="golden-path"/);
  assert.match(homepage, /labs\/skill-repair-case\//);
  assert.match(homepage, /id="codex-repair"/);
  assert.match(homepage, /before technical report, the repaired working copy, the after report/);
  assert.match(homepage, /Label the copy directly usable only if the after verification meets the Skill's delivery gate/);
  assert.match(homepage, /data-copy-zh-cn="使用 \$skill-installer/);
  assert.match(homepage, /data-copy-zh-cn="使用 \$realitycheck 检查并修复/);
  assert.match(homepage, /Illustrative format · open the public status for current evidence/);
  assert.match(homepage, new RegExp(installerPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(homepage, new RegExp(receiptPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(homepage, /npm run/);
  assert.doesNotMatch(llms, /npm run/);

  for (const text of [readme, chineseGuide, llms]) {
    assert.match(text, /\$skill-installer/);
    assert.match(text, /\$realitycheck/);
    assert.match(text, new RegExp(installerPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  const firstThreeHundredWords = readme.split(/\s+/).slice(0, 300).join(" ");
  assert.match(firstThreeHundredWords, /Check online/);
  assert.match(firstThreeHundredWords, /Repair in Codex—no clone/);
  assert.match(firstThreeHundredWords, /Publish and prove/);
  assert.match(firstThreeHundredWords, /\$skill-installer/);
  assert.ok(readme.indexOf("Use $skill-installer") < readme.indexOf("git clone --branch v0.13.0"));

  for (const block of [...readme.matchAll(/```bash\n([\s\S]*?)```/g)].map((match) => match[1])) {
    if (/realityhtmlcheck\s+(?:note|publish)\b/.test(block.replace(/\\\n\s*/g, " "))) {
      assert.match(block, /--language en/, `English note/publish command is missing --language en:\n${block}`);
    }
  }

  assert.match(notePage, /id="copy-skill-install"/);
  assert.match(notePage, /id="copy-skill-repair"/);
  assert.ok(notePage.indexOf('id="copy-skill-install"') < notePage.indexOf('id="copy-skill-repair"'));
  assert.match(notePage, /Install or safely update Skill/);
  assert.match(notePage, /Static checks are not a security certification/);
  assert.match(notePage, /Browser repair stays limited to doctype, language, and early UTF-8 metadata/);
  assert.ok(notePage.indexOf('id="demo-button"') < notePage.indexOf('class="publish-handoff"'));
  assert.match(noteChecker, /SKILL_INSTALL_REQUEST/);
  assert.match(noteChecker, /timestamped realitycheck backup outside the skills directory/);
  assert.match(noteChecker, /SKILL_REPAIR_REQUEST/);
  assert.match(noteChecker, /elements\.copySkillInstall\.addEventListener/);
  assert.match(noteChecker, /elements\.copySkillRepair\.addEventListener/);
  const app = readFileSync("site/app.js", "utf8");
  assert.match(app, /button\.dataset\.copyZhCn/);
});

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
  assert.match(workflow, /KevinwithPanda\/RealityHTMLCheck@v0\.13\.0/);
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
  assert.match(workflow, /KevinwithPanda\/RealityHTMLCheck@v0\.13\.0/);
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
  assert.match(action, /64-character lowercase SHA-256 hex/);
  assert.match(action, /RC_PUBLISH_UPLOAD_OUTCOME/);
  assert.doesNotMatch(action, /result_json="\$RUNNER_TEMP\/realitycheck-publish-result-/);
  assert.doesNotMatch(action, /actions\/deploy-pages|wrangler pages deploy|netlify deploy/i);
  assert.ok(action.indexOf("Upload the exact RealityCheck publish run") < action.indexOf("Enforce the RealityCheck result"));

  const validation = readFileSync(".github/workflows/validate.yml", "utf8");
  assert.match(validation, /\^\[0-9a-f\]\{64\}\$/);
  assert.doesNotMatch(validation, /RC_ARTIFACT_DIGEST[^\n]*sha256:\*/);
});

test("verified Pages adoption separates check, deployment permission, and live receipt", () => {
  const reusable = readFileSync(".github/workflows/verified-pages.yml", "utf8");
  const caller = readFileSync("examples/github-actions/verified-pages.yml", "utf8");
  for (const value of [
    "workflow_call:",
    "authorize-trigger:",
    "Refuse pull requests and non-default-branch deployment",
    "verify-and-stage:",
    "contents: read",
    "materialize-output:",
    "github-pages-verified-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}",
    "realitycheck-pages-artifact/artifact.tar",
    "compression-level: 0",
    "deploy:",
    "pages: write",
    "id-token: write",
    "environment:",
    "name: github-pages",
    "verify-live:",
    "timeout-minutes: 10",
    "realityhtmlcheck verify-deploy",
    "--allow-remote",
    "actions/download-artifact@v8",
    "RealityHTMLCheck#v0.13.0",
  ]) assert.match(reusable, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(reusable, /pull_request(?:_target)?:|contents: write|NETLIFY|CLOUDFLARE|wrangler|git push/i);
  assert.match(reusable, /RC_EVENT_NAME[\s\S]*workflow_dispatch[\s\S]*RC_DEFAULT_BRANCH/);
  assert.ok(reusable.indexOf("verify-and-stage:") < reusable.indexOf("deploy:"));
  assert.ok(reusable.indexOf("deploy:") < reusable.indexOf("verify-live:"));

  assert.match(caller, /workflow_dispatch:/);
  assert.match(caller, /KevinwithPanda\/RealityHTMLCheck\/\.github\/workflows\/verified-pages\.yml@v0\.13\.0/);
  assert.match(caller, /path: exported-site/);
  assert.match(caller, /pages: write/);
  assert.match(caller, /id-token: write/);
  assert.match(caller, /Settings -> Pages/);
  assert.doesNotMatch(caller, /push:|pull_request(?:_target)?:|contents: write/);
});

import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("GitHub Pages build publishes every live evidence and fixture link", () => {
  const output = resolve("_site");
  rmSync(output, { recursive: true, force: true });
  const built = spawnSync(process.execPath, ["scripts/build-pages.mjs"], { encoding: "utf8" });
  assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
  for (const path of [
    "index.html",
    "app.js",
    "styles.css",
    "robots.txt",
    "llms.txt",
    "site.webmanifest",
    "sitemap.xml",
    "assets/icon.svg",
    "reference/report.html",
    "evidence/viewport/latest.html",
    "evidence/journey/latest.html",
    "evidence/links/latest.html",
    "evidence/network/latest.html",
    "evidence/metadata/latest.html",
    "evidence/visual/latest.html",
    "evidence/security/latest.html",
    "evidence/security-headers-broken/latest.html",
    "evidence/security-headers-fixed/latest.html",
    "evidence/privacy/latest.html",
    "evidence/accessibility/latest.html",
    "labs/journey/broken.html",
    "labs/viewport/broken.html",
    "labs/viewport/fixed.html",
    "labs/policy-review/review/policy-review.html",
    "labs/policy-review/review/policy-review.json",
    "labs/issue-drafts/github-issue-drafts.html",
    "labs/issue-drafts/github-issue-drafts.json",
    "labs/issue-drafts/github-issue-drafts.csv",
    "labs/release-decision/release-decision.html",
    "labs/release-decision/release-decision.json",
    "labs/release-decision/release-decision.md",
    "labs/release-decision/release-decision.zh-CN.md",
    "labs/audit-plan/audit-plan.html",
    "labs/audit-plan/audit-plan.json",
    "labs/audit-plan/audit-plan.md",
    "labs/audit-plan/audit-plan.zh-CN.md",
    "labs/reference-run/report.html",
    "labs/links/broken.html",
    "labs/links/fixed.html",
    "labs/network/broken.html",
    "labs/network/fixed.html",
    "labs/metadata/broken.html",
    "labs/metadata/fixed.html",
    "labs/visual/approved/index.html",
    "labs/visual/regressed/index.html",
    "labs/visual/baselines/visual-baseline-index.json",
    "labs/security/index.html",
    "labs/privacy/broken.html",
    "labs/privacy/fixed.html",
    "labs/accessibility/broken.html",
  ]) assert.equal(existsSync(resolve(output, path)), true, `Pages output is missing ${path}`);

  const html = readFileSync(resolve(output, "index.html"), "utf8");
  assert.match(html, /<link rel="canonical" href="https:\/\/kevinwithpanda\.github\.io\/RealityHTMLCheck\/">/);
  assert.match(html, /<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">/);
  assert.match(html, /<link rel="manifest" href="site\.webmanifest">/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  const structuredDataMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(structuredDataMatch, "Pages homepage is missing JSON-LD product metadata");
  const structuredData = JSON.parse(structuredDataMatch[1]);
  assert.equal(structuredData["@type"], "SoftwareApplication");
  assert.equal(structuredData.softwareVersion, "0.4.0");
  assert.equal(structuredData.codeRepository, "https://github.com/KevinwithPanda/RealityHTMLCheck");
  assert.ok(structuredData.featureList.includes("Policy anti-weakening review"));
  assert.ok(structuredData.featureList.includes("Browser-free bilingual audit plan previews"));
  assert.match(html, /data-language="zh-CN"/);
  assert.match(html, /init --profile product --base-url/);
  assert.match(html, /npm run demo/);
  assert.match(html, /内置 Demo 不需要应用服务器或配置/);
  assert.match(html, /Issue drafts, anti-weakening policy review, before\/after proof, GitHub annotations/);
  assert.match(html, /工单草稿、防弱化策略审查、前后证明、GitHub 注释/);
  assert.match(html, /Choose a transparent starting policy/);
  assert.match(html, /选择一个透明的起始策略/);
  assert.match(html, /ArrowRight changes the tab/);
  assert.match(html, /方向键切换标签后/);
  assert.match(html, /PUBLISHING CONTRACT/);
  assert.match(html, /七项发布信号却失败/);
  assert.match(html, /VISUAL REGRESSION/);
  assert.match(html, /18\.920% 像素变化/);
  assert.match(html, /375px passes; the release action vanishes at 320px/);
  assert.match(html, /375px 正常，320px 发布按钮却消失/);
  assert.match(html, /POLICY CANNOT QUIETLY GET WEAKER/);
  assert.match(html, /策略不能静默变弱/);
  assert.match(html, /EVIDENCE BECOMES REVIEWABLE WORK/);
  assert.match(html, /让证据变成可复核工作/);
  assert.match(html, /external issues&nbsp; 0 created/);
  assert.match(html, /ONE CONSERVATIVE DELIVERY ANSWER/);
  assert.match(html, /给出一个保守的交付答案/);
  assert.match(html, /automatic deployments · 0/);
  assert.match(html, /BROWSER STORAGE PRIVACY/);
  assert.match(html, /UNDERSTAND BEFORE EXECUTION/);
  assert.match(html, /Open the 301-scenario plan/);
  assert.match(html, /browser access&nbsp; NONE/);
  assert.match(html, /SEMANTIC RESPONSE HEADERS/);
  assert.match(html, /evidence\/security-headers-broken\/latest\.html/);
  assert.match(html, /evidence\/security-headers-fixed\/latest\.html/);
  assert.match(html, /浏览器存储隐私/);
  assert.doesNotMatch(html, /<script[^>]+src="https?:/i);
  const localReferences = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1])
    .filter((value) => !/^(?:https?:|#|mailto:|data:)/.test(value));
  for (const reference of localReferences) {
    const path = resolve(output, reference.split(/[?#]/)[0]);
    assert.equal(path.startsWith(output), true, `Pages reference escapes output: ${reference}`);
    assert.equal(existsSync(path), true, `Pages reference is missing: ${reference}`);
  }

  const robots = readFileSync(resolve(output, "robots.txt"), "utf8");
  assert.match(robots, /Sitemap: https:\/\/kevinwithpanda\.github\.io\/RealityHTMLCheck\/sitemap\.xml/);
  const manifest = JSON.parse(readFileSync(resolve(output, "site.webmanifest"), "utf8"));
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.icons[0].src, "assets/icon.svg");
  const llms = readFileSync(resolve(output, "llms.txt"), "utf8");
  assert.match(llms, /GitHub issue drafts are local files that are never submitted automatically/);
  assert.match(llms, /labs\/policy-review\/review\/policy-review\.html/);
  assert.match(llms, /labs\/audit-plan\/audit-plan\.html/);
  assert.match(llms, /evidence\/security-headers-fixed\/latest\.html/);
});

test("Pages workflow uses the supported deployment artifact path", () => {
  const workflow = readFileSync(".github/workflows/pages.yml", "utf8");
  assert.match(workflow, /npm run site:build/);
  assert.match(workflow, /actions\/upload-pages-artifact@v4/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /path: _site/);
  assert.match(workflow, /continue-on-error: true/);
  assert.match(workflow, /Settings → Pages → Source: GitHub Actions/);
  assert.match(workflow, /if: steps\.pages\.outcome == 'success'/);
});

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
    "note.html",
    "compatibility.html",
    "note.css",
    "note-checker.js",
    "note-analyzer.mjs",
    "note-package.mjs",
    "note-summary.mjs",
    "note-repair-verification.mjs",
    "note-share-report.mjs",
    "app.js",
    "styles.css",
    "robots.txt",
    "llms.txt",
    "site.webmanifest",
    "sitemap.xml",
    "assets/icon.svg",
    "assets/social-preview.png",
    "assets/note-checker-preview.png",
    "assets/report-preview.png",
    "assets/finding-preview.png",
    "reference/report.html",
    "evidence/note-compatibility/manifest.json",
    "evidence/note-compatibility/compatibility-matrix.json",
    "evidence/note-compatibility/fixtures/notion-like/before/index.html",
    "evidence/note-compatibility/fixtures/notion-like/after/export_assets/workflow.svg",
    "evidence/note-compatibility/fixtures/obsidian-like/before/notes/method.html",
    "evidence/note-compatibility/fixtures/jupyter-like/review/notebook.html",
    "evidence/note-compatibility/fixtures/quarto-like/after/site_libs/quarto-html/theme.css",
    "evidence/real-export/manifest.json",
    "evidence/real-export/THIRD_PARTY_NOTICES.md",
    "evidence/real-export/pandoc-3.8.2.1/generated/note.html",
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
    "labs/policy-review-lab/review/policy-review.json",
    "labs/issue-drafts/github-issue-drafts.html",
    "labs/issue-drafts/github-issue-drafts.json",
    "labs/issue-drafts-lab/github-issue-drafts.json",
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
  const compatibilityHtml = readFileSync(resolve(output, "compatibility.html"), "utf8");
  const styles = readFileSync(resolve(output, "styles.css"), "utf8");
  assert.match(styles, /\.profile-grid button\{min-height:40px;/);
  for (const [name, width, height] of [["report-preview.png", 1440, 900], ["finding-preview.png", 1440, 900], ["note-checker-preview.png", 1440, 1000]]) {
    const png = readFileSync(resolve(output, "assets", name));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${name} has an invalid PNG signature`);
    assert.equal(png.readUInt32BE(16), width, `${name} width changed`);
    assert.equal(png.readUInt32BE(20), height, `${name} height changed`);
  }
  assert.match(html, /<link rel="canonical" href="https:\/\/kevinwithpanda\.github\.io\/RealityHTMLCheck\/">/);
  assert.match(html, /<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">/);
  assert.match(html, /<link rel="manifest" href="site\.webmanifest">/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/kevinwithpanda\.github\.io\/RealityHTMLCheck\/assets\/social-preview\.png">/);
  assert.match(html, /<meta property="og:image:type" content="image\/png">/);
  assert.match(html, /<meta property="og:image:width" content="1280">/);
  assert.match(html, /<meta property="og:image:height" content="640">/);
  const structuredDataMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(structuredDataMatch, "Pages homepage is missing JSON-LD product metadata");
  const structuredData = JSON.parse(structuredDataMatch[1]);
  assert.equal(structuredData["@type"], "SoftwareApplication");
  assert.equal(structuredData.softwareVersion, "0.7.2");
  assert.equal(structuredData.codeRepository, "https://github.com/KevinwithPanda/RealityHTMLCheck");
  assert.equal(structuredData.image, "https://kevinwithpanda.github.io/RealityHTMLCheck/assets/social-preview.png");
  assert.ok(structuredData.featureList.includes("Policy anti-weakening review"));
  assert.ok(structuredData.featureList.includes("Browser-free bilingual audit plan previews"));
  assert.ok(structuredData.featureList.includes("Zero-upload HTML note and folder checks"));
  assert.match(html, /href="note\.html"/);
  assert.match(html, /href="compatibility\.html"/);
  assert.match(html, /Open reproducible note evidence/);
  assert.match(html, /Check AI-made HTML before you trust or share it/);
  assert.match(html, /AI 生成的 HTML，使用和分享前先体检/);
  assert.match(html, /<article><strong>30<\/strong><span[^>]+>HTML note integrity and portability rules/);
  assert.match(html, /<article><strong>4<\/strong><span[^>]+>byte-reproducible real Pandoc exports/);
  assert.match(html, /github:KevinwithPanda\/RealityHTMLCheck#v0\.7\.2/);
  assert.match(html, /realityhtmlcheck note \.\/my-notes/);
  assert.match(html, /data-language="zh-CN"/);
  assert.match(html, /init --profile product --base-url/);
  assert.match(html, /npm run realitycheck -- init --profile product/);
  assert.doesNotMatch(html, /npx realitycheck-web-audit/);
  assert.match(html, /无需克隆 · 无需全局安装/);
  assert.match(html, /ADVANCED WEB QA · REAL BROWSER/);
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
  assert.match(html, /SECURITY POLICY/);
  assert.match(html, /80→100/);
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
  const compatibilityReferences = [...compatibilityHtml.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1])
    .filter((value) => !/^(?:https?:|#|mailto:|data:)/.test(value));
  for (const reference of compatibilityReferences) {
    const path = resolve(output, reference.split(/[?#]/)[0]);
    assert.equal(path.startsWith(output), true, `Compatibility reference escapes output: ${reference}`);
    assert.equal(existsSync(path), true, `Compatibility reference is missing: ${reference}`);
  }
  const releaseDecisionHtml = readFileSync(resolve(output, "labs/release-decision/release-decision.html"), "utf8");
  const releaseReferences = [...releaseDecisionHtml.matchAll(/href="([^"]+)"/g)].map((match) => match[1])
    .filter((value) => !/^(?:https?:|#|mailto:|data:)/.test(value));
  for (const reference of releaseReferences) {
    const path = resolve(output, "labs/release-decision", reference.split(/[?#]/)[0]);
    assert.equal(path.startsWith(output), true, `Release-decision reference escapes output: ${reference}`);
    assert.equal(existsSync(path), true, `Release-decision reference is missing: ${reference}`);
  }
  assert.deepEqual(
    JSON.parse(readFileSync(resolve(output, "evidence/note-compatibility/compatibility-matrix.json"), "utf8")),
    JSON.parse(readFileSync("examples/note-compatibility/compatibility-matrix.json", "utf8")),
  );
  assert.match(compatibilityHtml, /ACTUAL TOOL OUTPUT/);
  assert.match(compatibilityHtml, /Pandoc 3\.8\.2\.1/);
  assert.match(compatibilityHtml, /evidence\/real-export\/pandoc-3\.8\.2\.1\/generated\/note\.html/);

  const robots = readFileSync(resolve(output, "robots.txt"), "utf8");
  assert.match(robots, /Sitemap: https:\/\/kevinwithpanda\.github\.io\/RealityHTMLCheck\/sitemap\.xml/);
  const sitemap = readFileSync(resolve(output, "sitemap.xml"), "utf8");
  assert.match(sitemap, /RealityHTMLCheck\/compatibility\.html/);
  const manifest = JSON.parse(readFileSync(resolve(output, "site.webmanifest"), "utf8"));
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.icons[0].src, "assets/icon.svg");
  const llms = readFileSync(resolve(output, "llms.txt"), "utf8");
  assert.match(llms, /GitHub issue drafts are local files that are never submitted automatically/);
  assert.match(llms, /labs\/policy-review\/review\/policy-review\.html/);
  assert.match(llms, /labs\/audit-plan\/audit-plan\.html/);
  assert.match(llms, /evidence\/security-headers-fixed\/latest\.html/);
  assert.match(llms, /npm run realitycheck -- plan/);
  assert.match(llms, /Zero-install HTML note checker/);
  assert.match(llms, /github:KevinwithPanda\/RealityHTMLCheck#v0\.7\.2/);
  assert.match(llms, /realityhtmlcheck note \.\/my-notes/);
  assert.match(llms, /compatibility\.html/);
  assert.match(llms, /evidence\/real-export\/manifest\.json/);
  const previewRenderer = readFileSync("scripts/render-note-preview.mjs", "utf8");
  assert.match(previewRenderer, /overflow-anchor:none/);
  assert.match(previewRenderer, /unexpectedOrigins\.size/);
  assert.match(previewRenderer, /animations: "disabled", caret: "hide"/);
  assert.match(previewRenderer, /sha256\(first\) !== sha256\(second\)/);
});

test("Pages workflow uses the supported deployment artifact path", () => {
  const workflow = readFileSync(".github/workflows/pages.yml", "utf8");
  assert.match(workflow, /npm run site:build/);
  assert.match(workflow, /actions\/configure-pages@v6/);
  assert.match(workflow, /actions\/upload-pages-artifact@v4/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /path: _site/);
  assert.match(workflow, /continue-on-error: true/);
  assert.match(workflow, /Settings → Pages → Source: GitHub Actions/);
  assert.match(workflow, /Require a real Pages deployment/);
  assert.match(workflow, /GitHub Pages is not enabled for this repository/);
  assert.match(workflow, /exit 1/);
  assert.match(workflow, /if: steps\.pages\.outcome == 'success'/);
});

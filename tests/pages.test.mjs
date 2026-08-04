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
    "assets/icon.svg",
    "reference/report.html",
    "evidence/viewport/latest.html",
    "evidence/journey/latest.html",
    "evidence/links/latest.html",
    "evidence/network/latest.html",
    "evidence/metadata/latest.html",
    "evidence/visual/latest.html",
    "evidence/security/latest.html",
    "evidence/accessibility/latest.html",
    "labs/journey/broken.html",
    "labs/viewport/broken.html",
    "labs/viewport/fixed.html",
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
    "labs/accessibility/broken.html",
  ]) assert.equal(existsSync(resolve(output, path)), true, `Pages output is missing ${path}`);

  const html = readFileSync(resolve(output, "index.html"), "utf8");
  assert.match(html, /<link rel="canonical" href="https:\/\/kevinwithpanda\.github\.io\/RealityHTMLCheck\/">/);
  assert.match(html, /data-language="zh-CN"/);
  assert.match(html, /init --profile product --base-url/);
  assert.match(html, /npm run demo/);
  assert.match(html, /内置 Demo 不需要应用服务器或配置/);
  assert.match(html, /bounded GitHub annotations/);
  assert.match(html, /有上限的 GitHub 注释/);
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
  assert.doesNotMatch(html, /<script[^>]+src="https?:/i);
  const localReferences = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1])
    .filter((value) => !/^(?:https?:|#|mailto:|data:)/.test(value));
  for (const reference of localReferences) {
    const path = resolve(output, reference.split(/[?#]/)[0]);
    assert.equal(path.startsWith(output), true, `Pages reference escapes output: ${reference}`);
    assert.equal(existsSync(path), true, `Pages reference is missing: ${reference}`);
  }
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

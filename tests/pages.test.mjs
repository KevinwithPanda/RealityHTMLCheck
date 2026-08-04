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
    "evidence/journey/latest.html",
    "evidence/security/latest.html",
    "evidence/accessibility/latest.html",
    "labs/journey/broken.html",
    "labs/security/index.html",
    "labs/accessibility/broken.html",
  ]) assert.equal(existsSync(resolve(output, path)), true, `Pages output is missing ${path}`);

  const html = readFileSync(resolve(output, "index.html"), "utf8");
  assert.match(html, /<link rel="canonical" href="https:\/\/kevinwithpanda\.github\.io\/RealityHTMLCheck\/">/);
  assert.match(html, /data-language="zh-CN"/);
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
});

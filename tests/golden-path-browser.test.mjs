import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import test from "node:test";

import { chromium } from "playwright-core";

import { findPublishBrowserExecutable } from "../realitycheck/scripts/note-publish-browser.mjs";

function browserForTest() {
  try { return findPublishBrowserExecutable(chromium); } catch (_) { return null; }
}

const browserPath = browserForTest();

function startSite() {
  const root = resolve("site");
  const browserModules = new Set([
    "note-analyzer.mjs",
    "note-compare.mjs",
    "note-comparison-report.mjs",
    "note-package.mjs",
    "note-ruleset.mjs",
    "note-scope.mjs",
    "note-summary.mjs",
  ]);
  const contentTypes = new Map([
    [".css", "text/css; charset=utf-8"],
    [".html", "text/html; charset=utf-8"],
    [".js", "text/javascript; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".mjs", "text/javascript; charset=utf-8"],
    [".svg", "image/svg+xml"],
  ]);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const filename = relative.replace(/^\//, "");
      const repositoryScript = filename.startsWith("realitycheck/scripts/");
      const documentationAsset = filename.startsWith("assets/");
      const sourceRoot = repositoryScript
        ? resolve(".")
        : documentationAsset
          ? resolve("realitycheck")
          : browserModules.has(filename)
            ? resolve("realitycheck/scripts")
            : root;
      const target = resolve(sourceRoot, filename);
      if (target !== sourceRoot && !target.startsWith(`${sourceRoot}${sep}`)) {
        response.writeHead(403).end("forbidden");
        return;
      }
      const bytes = await readFile(target);
      response.writeHead(200, { "content-type": contentTypes.get(extname(target).toLowerCase()) || "application/octet-stream" });
      response.end(bytes);
    } catch (_) {
      response.writeHead(404).end("not found");
    }
  });
  return new Promise((resolveStart, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveStart(server));
  });
}

test("375px note Golden Path keeps the demo above the fold and copies Skill handoffs", { skip: !browserPath }, async () => {
  const server = await startSite();
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    const unexpectedOrigins = new Set();
    const consoleErrors = [];
    page.on("request", (request) => {
      const requested = new URL(request.url());
      if (requested.origin !== origin) unexpectedOrigins.add(requested.origin);
    });
    page.on("response", (response) => {
      if (response.status() >= 400) consoleErrors.push(`${response.status()} ${response.url()}`);
    });
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(String(error)));

    await page.goto(`${origin}/note.html`, { waitUntil: "networkidle" });
    await page.click('[data-language="en"]');
    const demoBox = await page.locator("#demo-button").boundingBox();
    assert.ok(demoBox, "built-in demo button is not rendered");
    assert.ok(demoBox.y >= 0 && demoBox.y + demoBox.height <= 812, `built-in demo leaves the 375x812 first viewport: ${JSON.stringify(demoBox)}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);

    await page.click("#demo-button");
    await page.waitForTimeout(1200);
    assert.equal(await page.locator("#results").getAttribute("hidden"), null, JSON.stringify({
      status: await page.locator("#status").innerText(),
      consoleErrors,
    }));
    await page.waitForSelector("#copy-skill-install:visible");
    await page.waitForSelector("#copy-skill-repair:visible");
    const actionIds = await page.locator(".result-actions > button").evaluateAll((buttons) => buttons.map((button) => button.id));
    assert.ok(actionIds.indexOf("copy-skill-install") < actionIds.indexOf("copy-skill-repair"));
    assert.match(await page.locator(".result-actions").innerText(), /Browser repair stays limited to doctype, language, and early UTF-8 metadata/);

    await page.click("#copy-skill-install");
    const installRequest = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(installRequest, /\$skill-installer/);
    assert.match(installRequest, /RealityHTMLCheck\/tree\/v0\.13\.0\/realitycheck/);
    assert.match(installRequest, /timestamped realitycheck backup outside the skills directory/);

    await page.click('[data-language="zh-CN"]');
    await page.click("#copy-skill-repair");
    const repairRequest = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(repairRequest, /\$realitycheck/);
    assert.match(repairRequest, /修复前技术报告/);
    assert.match(repairRequest, /修复后报告/);
    assert.match(repairRequest, /复检满足 Skill 交付门槛/);

    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    await page.click('[data-language="zh-CN"]');
    await page.click('#codex-repair [data-copy-zh-cn*="$skill-installer"]');
    const homepageInstallRequest = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(homepageInstallRequest, /使用 \$skill-installer/);
    assert.match(homepageInstallRequest, /带时间戳的 realitycheck 备份目录/);
    assert.match(await page.locator('[aria-label="Illustrative live deployment receipt state"]').innerText(), /状态示例/);
    assert.equal(unexpectedOrigins.size, 0, `note Golden Path requested unexpected origins: ${[...unexpectedOrigins].join(", ")}`);
    assert.deepEqual(consoleErrors, []);
    await context.close();
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});

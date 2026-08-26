#!/usr/bin/env node

import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

import { chromium } from "playwright-core";

const browserPath = process.argv[2];
if (!browserPath) throw new Error("Usage: render-note-preview.mjs <browser-path>");

const siteRoot = resolve("_site");
const output = resolve("docs/assets/note-checker-preview.png");
const mime = new Map([
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
    const requested = decodeURIComponent(url.pathname === "/" ? "/note.html" : url.pathname);
    const target = resolve(siteRoot, `.${requested}`);
    if (target !== siteRoot && !target.startsWith(`${siteRoot}${sep}`)) {
      response.writeHead(403).end("forbidden");
      return;
    }
    const body = await readFile(target);
    response.writeHead(200, { "content-type": mime.get(extname(target).toLowerCase()) || "application/octet-stream" });
    response.end(body);
  } catch (_) {
    response.writeHead(404).end("not found");
  }
});

await new Promise((resolveListen, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolveListen);
});

const address = server.address();
const browser = await chromium.launch({ executablePath: browserPath, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const unexpectedOrigins = new Set();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1") unexpectedOrigins.add(url.origin);
  });
  await page.goto(`http://127.0.0.1:${address.port}/note.html`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html,body{overflow-anchor:none!important;scroll-behavior:auto!important}*{animation:none!important;transition:none!important;caret-color:transparent!important}" });
  await page.click("#demo-button");
  await page.waitForSelector("#results:not([hidden])");
  await page.click('[data-language="zh-CN"]');
  await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = "auto";
    for (const selector of [".intro", ".checker", ".explain", ".result-heading", "body > footer"]) {
      const element = document.querySelector(selector);
      if (element) element.style.display = "none";
    }
    const results = document.querySelector("#results");
    if (results) results.style.paddingTop = "20px";
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
    window.scrollTo(0, 0);
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
  });
  if (unexpectedOrigins.size) throw new Error(`Preview requested unexpected remote origins: ${[...unexpectedOrigins].join(", ")}`);
  const screenshotOptions = { type: "png", animations: "disabled", caret: "hide" };
  const first = await page.screenshot(screenshotOptions);
  const second = await page.screenshot(screenshotOptions);
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
  if (sha256(first) !== sha256(second)) throw new Error("Preview rendering is not deterministic across consecutive captures");
  await writeFile(output, first);
  console.log(`Rendered deterministic HTML note checker preview: ${output} (sha256:${sha256(first)})`);
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

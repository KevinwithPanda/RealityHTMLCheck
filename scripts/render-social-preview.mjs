#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { chromium } from "playwright-core";

const browserPath = process.argv[2];
if (!browserPath) throw new Error("Usage: render-social-preview.mjs <browser-path>");
const svg = readFileSync(resolve("docs/assets/social-preview.svg"), "utf8");
const browser = await chromium.launch({ executablePath: browserPath, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><style>*{box-sizing:border-box}html,body{margin:0;width:1280px;height:640px;overflow:hidden}svg{display:block;width:1280px;height:640px}</style>${svg}`);
  await page.screenshot({ path: resolve("docs/assets/social-preview.png"), type: "png" });
} finally {
  await browser.close();
}

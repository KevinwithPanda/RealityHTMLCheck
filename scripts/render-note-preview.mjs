#!/usr/bin/env node

import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

import { chromium } from "playwright-core";
import { buildBrowserDeflateZipFixture } from "./browser-zip-fixture.mjs";

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
  const deflateZip = buildBrowserDeflateZipFixture([
    { path: "browser-deflate/index.html", text: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Browser DEFLATE export</title><link rel="stylesheet" href="assets/note.css"></head><body><h1>Browser DEFLATE export</h1><p>This real Chrome path proves common method-8 ZIP intake and a zero-change verified output handoff.</p></body></html>' },
    { path: "browser-deflate/assets/note.css", text: "body{max-width:72rem;margin:auto}\n" },
  ]);
  await page.setInputFiles("#zip-picker", { name: "browser-deflate-export.zip", mimeType: "application/zip", buffer: Buffer.from(deflateZip) });
  await page.waitForSelector("#results:not([hidden])");
  await page.waitForFunction(() => /ZIP VERIFIED LOCALLY|ZIP 已在本地验证/.test(document.querySelector("#folder-repair")?.textContent || ""));
  await page.click("#download-folder-zip");
  await page.click("#download-folder-zip");
  await page.waitForFunction(() => Boolean(document.querySelector("#folder-repair .folder-candidate-id")) && !document.querySelector("#download-folder-zip")?.disabled);
  const deflateEvidencePromise = page.waitForEvent("download");
  await page.click("#download-json");
  const deflateEvidenceDownload = await deflateEvidencePromise;
  const deflateEvidencePath = await deflateEvidenceDownload.path();
  if (!deflateEvidencePath) throw new Error("DEFLATE browser evidence download did not produce a local file");
  const deflateEvidence = JSON.parse((await readFile(deflateEvidencePath)).toString("utf8"));
  if (!deflateEvidence.importedArchive?.methods?.includes("deflate")) throw new Error("Real Chrome did not report DEFLATE ZIP intake");
  if (!/^[a-f0-9]{64}$/.test(deflateEvidence.importedArchive.archiveSha256 || "") || !/^sha256:[a-f0-9]{64}$/.test(deflateEvidence.importedArchive.importContentId || "")) throw new Error("DEFLATE browser evidence is missing source/import identities");
  if (!/^sha256:[a-f0-9]{64}$/.test(deflateEvidence.safeFolderRepairVerification?.candidateId || "") || deflateEvidence.safeFolderRepairVerification?.archive?.manifest?.format !== "zip32-store") throw new Error("DEFLATE browser evidence is missing candidate/output identities");
  if (deflateEvidence.safeFolderRepairVerification.totalChanges !== 0) throw new Error("Clean DEFLATE browser fixture was not preserved as a zero-change candidate");
  const deflateOutputPromise = page.waitForEvent("download");
  await page.click("#download-folder-zip");
  const deflateOutput = await deflateOutputPromise;
  const deflateOutputPath = await deflateOutput.path();
  if (!deflateOutputPath) throw new Error("DEFLATE browser output did not produce a local ZIP");
  const deflateOutputBytes = await readFile(deflateOutputPath);
  if (deflateOutputBytes.readUInt32LE(0) !== 0x04034b50) throw new Error("DEFLATE browser output is not a ZIP archive");
  await page.click("#reset-button");
  await page.waitForSelector("#results", { state: "hidden" });
  await page.click("#demo-button");
  await page.waitForSelector("#results:not([hidden])");
  await page.click("#download-folder-zip");
  await page.click("#download-folder-zip");
  await page.waitForFunction(() => Boolean(document.querySelector("#folder-repair .folder-candidate-id")) && !document.querySelector("#download-folder-zip")?.disabled);
  const downloadPromise = page.waitForEvent("download");
  await page.click("#download-json");
  const evidenceDownload = await downloadPromise;
  const evidencePath = await evidenceDownload.path();
  if (!evidencePath) throw new Error("Browser evidence download did not produce a local file");
  const evidenceBuffer = await readFile(evidencePath);
  const evidence = JSON.parse(evidenceBuffer.toString("utf8"));
  if (evidence.discovery?.htmlFiles !== 2 || evidence.discovery?.truncated !== false || evidence.selection?.html?.excludedCount !== 0) throw new Error("Browser evidence is not comparison-compatible");
  if (!/^sha256:[a-f0-9]{64}$/.test(evidence.importedArchive?.importContentId || "") || !/^[a-f0-9]{64}$/.test(evidence.importedArchive?.archiveSha256 || "")) throw new Error("Browser evidence is missing imported ZIP identities");
  if (Object.hasOwn(evidence, "sources") || Object.hasOwn(evidence, "analysis")) throw new Error("Browser evidence retained private source objects");
  await page.setInputFiles("#baseline-picker", {
    name: "prior-realitycheck-evidence.json",
    mimeType: "application/json",
    buffer: evidenceBuffer,
  });
  await page.waitForSelector("#baseline-comparison:not([hidden])");
  const comparisonCounts = await page.locator("#baseline-comparison .comparison-counts strong").allTextContents();
  if (comparisonCounts[0] !== "0" || comparisonCounts[2] !== "0" || comparisonCounts[4] !== "0") {
    throw new Error(`Self-comparison produced a regression or unverified scope: ${comparisonCounts.join("/")}`);
  }
  await page.click('[data-language="zh-CN"]');
  await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = "auto";
    for (const selector of [".intro", ".checker", ".explain", ".result-heading", ".baseline-comparison", "body > footer"]) {
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

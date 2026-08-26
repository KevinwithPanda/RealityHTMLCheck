import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { digestZipSource, readStoredZipEntries } from "./note-zip.mjs";
import { publishContentType, startPublishByteServer } from "./note-publish-server.mjs";

const require = createRequire(import.meta.url);
const encoder = new TextEncoder();
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const SHA256 = /^[a-f0-9]{64}$/;
const CONTENT_ID = /^sha256:[a-f0-9]{64}$/;
const FORBIDDEN_ENCODED_PATH = /%(?:00|2f|5c)/i;

export const PUBLISH_BROWSER_LIMITS = Object.freeze({
  maxHtmlFiles: 200,
  maxFragments: 500,
  maxLinksPerHtml: 1_000,
  maxTotalLinks: 5_000,
  maxEventRecords: 100,
  maxRequestRecords: 2_000,
  maxResponseBodies: 1_000,
  maxRecordedTextCharacters: 300,
  maxRecordedPathCharacters: 500,
});

function commandPath(command) {
  const lookup = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookup, [command], { encoding: "utf8", windowsHide: true });
  return result.status === 0 ? result.stdout.split(/\r?\n/).map((item) => item.trim()).find(Boolean) || null : null;
}

function loadPlaywright() {
  for (const resolver of [require, createRequire(join(process.cwd(), "package.json"))]) {
    for (const packageName of ["playwright-core", "playwright"]) {
      try { return resolver(packageName); } catch (_) {}
    }
  }
  throw new Error("Playwright Core is required for publish-capsule browser proof");
}

export function findPublishBrowserExecutable(chromium, requestedPath = null) {
  const explicit = requestedPath || process.env.REALITYCHECK_BROWSER;
  if (explicit) {
    const candidate = resolve(explicit);
    if (!existsSync(candidate)) throw new Error(`Browser executable was not found: ${candidate}`);
    return candidate;
  }
  const bundled = chromium.executablePath();
  if (bundled && existsSync(bundled)) return bundled;
  const candidates = process.platform === "win32"
    ? [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      ]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Chromium.app/Contents/MacOS/Chromium"]
      : [commandPath("google-chrome"), commandPath("google-chrome-stable"), commandPath("microsoft-edge"), commandPath("chromium"), commandPath("chromium-browser")].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("No supported Chrome, Edge, or Chromium executable was found. Pass --browser PATH.");
  return found;
}

function configuredLimits(input = {}) {
  const limits = {};
  for (const [name, fallback] of Object.entries(PUBLISH_BROWSER_LIMITS)) {
    const value = input[name] ?? fallback;
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer`);
    limits[name] = value;
  }
  return limits;
}

async function normalizedDeployRows(input) {
  if (input instanceof Map) {
    const rows = [];
    for (const [path, bytes] of input) {
      if (typeof path !== "string" || !path || !(bytes instanceof Uint8Array)) throw new TypeError("Deploy entries require a path and Uint8Array bytes");
      const digest = await digestZipSource({ bytes });
      rows.push({ path, size: digest.size, sha256: digest.sha256 });
    }
    return rows.sort((left, right) => compareText(left.path, right.path));
  }
  const values = Array.isArray(input) ? input : input?.entries;
  if (!Array.isArray(values) || values.length === 0) throw new TypeError("Deploy content ID requires non-empty manifest entries or an entry Map");
  const seen = new Set();
  return values.map((entry) => {
    if (!entry || typeof entry.path !== "string" || !entry.path || !Number.isSafeInteger(entry.size) || entry.size < 0 || !SHA256.test(entry.sha256 || "")) {
      throw new TypeError("Deploy manifest entries require path, non-negative size, and SHA-256");
    }
    if (seen.has(entry.path)) throw new Error(`Duplicate deploy manifest path: ${entry.path}`);
    seen.add(entry.path);
    return { path: entry.path, size: entry.size, sha256: entry.sha256 };
  }).sort((left, right) => compareText(left.path, right.path));
}

/** Compute the sole canonical identity used by the builder and browser proof. */
export async function computeDeployContentId(entries, entrypoint = "index.html") {
  if (typeof entrypoint !== "string" || !entrypoint) throw new TypeError("A final ZIP-relative publish entrypoint is required");
  const rows = await normalizedDeployRows(entries);
  if (!rows.some((entry) => entry.path === entrypoint)) throw new Error(`Deploy entrypoint is absent from the content contract: ${entrypoint}`);
  const contract = JSON.stringify({
    contract: "realitycheck-publish-deploy-content-v1",
    entrypoint,
    entries: rows,
  });
  const digest = await digestZipSource({ bytes: encoder.encode(contract) });
  return `sha256:${digest.sha256}`;
}

function selectDeployEntries(readBack, supplied) {
  const archiveEvidence = new Map(readBack.manifest.entries.map((entry) => [entry.path, entry]));
  const selected = supplied === undefined || supplied === null ? readBack.manifest.entries : supplied;
  if (!Array.isArray(selected) || selected.length === 0) throw new TypeError("deployManifestEntries must be a non-empty array");
  const rows = [];
  const entries = new Map();
  const seen = new Set();
  for (const entry of selected) {
    if (!entry || typeof entry.path !== "string" || seen.has(entry.path)) throw new Error("Deploy manifest contains an invalid or duplicate path");
    seen.add(entry.path);
    const actual = archiveEvidence.get(entry.path);
    if (!actual || entry.size !== actual.size || entry.sha256 !== actual.sha256) throw new Error(`Deploy manifest differs from the final ZIP bytes: ${entry.path}`);
    rows.push({ path: actual.path, size: actual.size, sha256: actual.sha256 });
    entries.set(actual.path, readBack.entries.get(actual.path));
  }
  rows.sort((left, right) => compareText(left.path, right.path));
  return { rows, entries, evidence: new Map(rows.map((entry) => [entry.path, entry])) };
}

function encodePath(path) {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function scenarioUrl(origin, mount, entrypoint) {
  return `${origin}${mount}${entrypoint === "index.html" ? "" : encodePath(entrypoint)}`;
}

function mountedEntry(requestUrl, { origin, mount, entries, entrypoint }) {
  let url;
  try { url = new URL(requestUrl); } catch (_) { return null; }
  if (url.origin !== origin || FORBIDDEN_ENCODED_PATH.test(url.pathname)) return null;
  const mountWithoutSlash = mount.slice(0, -1);
  if (url.pathname !== mountWithoutSlash && !url.pathname.startsWith(mount)) return null;
  const encodedRelative = url.pathname === mountWithoutSlash ? "" : url.pathname.slice(mount.length);
  let path;
  try { path = decodeURIComponent(encodedRelative); } catch (_) { return null; }
  if (!path) path = entrypoint;
  if (path.endsWith("/") || path.includes("\\") || path.startsWith("/") || path.split("/").some((part) => !part || part === "." || part === "..")) return null;
  return entries.has(path) ? { path, url } : null;
}

function safeNetworkTarget(value, origin, limits) {
  try {
    const url = value instanceof URL ? value : new URL(value);
    return {
      scope: url.origin === origin ? "same-origin" : "external",
      origin: url.origin.slice(0, limits.maxRecordedPathCharacters),
      path: url.pathname.slice(0, limits.maxRecordedPathCharacters),
    };
  } catch (_) {
    return { scope: "invalid", origin: "[invalid]", path: "[invalid]" };
  }
}

function sanitizeText(value, limits) {
  let text = String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
  text = text.replace(/\b(?:authorization|cookie|password|secret|token)\s*[:=]\s*[^\s,;]+/gi, (match) => `${match.split(/[:=]/, 1)[0]}=[redacted]`);
  text = text.replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => {
    try {
      const url = new URL(candidate);
      return `${url.origin}${url.pathname}`;
    } catch (_) { return "[url]"; }
  });
  return text.replace(/\s+/g, " ").trim().slice(0, limits.maxRecordedTextCharacters);
}

function boundedPush(state, key, value, limits) {
  const target = state[key];
  if (target.length < limits.maxEventRecords) target.push(value);
  else {
    state.coverageTruncated = true;
    state.truncatedKinds.add(key);
  }
}

function createObserver({ page, origin, mount, entries, evidence, entrypoint, limits }) {
  const state = {
    consoleErrors: [], pageErrors: [], requestFailures: [], httpErrors: [], unexpectedRequests: [], responseVerificationErrors: [],
    responseProof: [], popups: 0, dialogs: 0, downloads: 0, workers: 0, websockets: 0,
    consoleTotal: 0, consoleByType: {}, coverageTruncated: false, truncatedKinds: new Set(),
  };
  const checkedResponsePaths = new Set();
  const recordUnexpected = (request) => boundedPush(state, "unexpectedRequests", {
    method: request.method(),
    ...safeNetworkTarget(request.url(), origin, limits),
  }, limits);
  page.on("console", (message) => {
    const type = message.type();
    state.consoleTotal += 1;
    state.consoleByType[type] = (state.consoleByType[type] || 0) + 1;
    if (type === "error") boundedPush(state, "consoleErrors", sanitizeText(message.text(), limits), limits);
  });
  page.on("pageerror", (error) => boundedPush(state, "pageErrors", sanitizeText(error.message || error, limits), limits));
  page.on("requestfailed", (request) => boundedPush(state, "requestFailures", {
    ...safeNetworkTarget(request.url(), origin, limits),
    error: sanitizeText(request.failure()?.errorText || "request failed", limits),
  }, limits));
  page.on("response", (response) => {
    const status = response.status();
    if (status >= 400) boundedPush(state, "httpErrors", { ...safeNetworkTarget(response.url(), origin, limits), status }, limits);
  });
  page.on("popup", (popup) => { state.popups += 1; void popup.close().catch(() => {}); });
  page.on("dialog", (dialog) => { state.dialogs += 1; void dialog.dismiss().catch(() => {}); });
  page.on("download", (download) => { state.downloads += 1; void download.cancel().catch(() => {}); });
  page.on("worker", () => { state.workers += 1; });
  page.on("websocket", () => { state.websockets += 1; });
  return {
    state,
    recordUnexpected,
    async recordResponseBytes(path, body) {
      if (checkedResponsePaths.has(path)) return;
      if (checkedResponsePaths.size >= limits.maxResponseBodies) {
        state.coverageTruncated = true;
        state.truncatedKinds.add("responseProof");
        return;
      }
      checkedResponsePaths.add(path);
      try {
        const digest = await digestZipSource({ bytes: body });
        const expected = evidence.get(path);
        if (!expected || digest.size !== expected.size || digest.sha256 !== expected.sha256) {
          boundedPush(state, "responseVerificationErrors", { path: path.slice(0, limits.maxRecordedPathCharacters), expectedBytes: expected?.size ?? null, actualBytes: digest.size }, limits);
          return;
        }
        state.responseProof.push({ path, bytes: digest.size, sha256: digest.sha256 });
      } catch (error) {
        boundedPush(state, "responseVerificationErrors", { path: path.slice(0, limits.maxRecordedPathCharacters), error: sanitizeText(error.message || error, limits) }, limits);
      }
    },
    recordResponseError(path, error) {
      boundedPush(state, "responseVerificationErrors", { path: path.slice(0, limits.maxRecordedPathCharacters), error: sanitizeText(error.message || error, limits) }, limits);
    },
    async finish() {
      state.responseProof.sort((left, right) => compareText(left.path, right.path));
      return { ...state, truncatedKinds: [...state.truncatedKinds].sort(compareText) };
    },
  };
}

async function settleAndMeasure(page) {
  let last = null;
  let stableSamples = 0;
  let lastError = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const sample = await page.evaluate(() => ({
        titleLength: document.title.length,
        textLength: (document.body?.innerText || "").trim().length,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollHeight: document.documentElement.scrollHeight,
        elementCount: Math.min(document.querySelectorAll("*").length, 2_001),
        finalPath: location.pathname,
        finalHash: location.hash,
      }));
      stableSamples = last && JSON.stringify(last) === JSON.stringify(sample) ? stableSamples + 1 : 1;
      last = sample;
      lastError = null;
      if (stableSamples >= 3) return last;
    } catch (error) {
      lastError = error;
      stableSamples = 0;
      await page.waitForLoadState("domcontentloaded", { timeout: 1_000 }).catch(() => {});
    }
    if (attempt < 11) await page.waitForTimeout(100);
  }
  if (!last) throw lastError || new Error("Publish page did not produce a stable DOM measurement");
  return last;
}

function trackerSlice(tracker, startIndex, limits) {
  const requests = Array.isArray(tracker.requests) ? tracker.requests.slice(startIndex) : [];
  if (requests.length > limits.maxRequestRecords) return { requests: requests.slice(0, limits.maxRequestRecords), truncated: true };
  return { requests, truncated: Boolean(tracker.truncated) };
}

async function installRequestBoundary({ context, observer, origin, mount, entries, entrypoint, offlineReplay }) {
  await context.route("**/*", async (route) => {
    const request = route.request();
    const resolved = mountedEntry(request.url(), { origin, mount, entries, entrypoint });
    if (!resolved || !new Set(["GET", "HEAD"]).has(request.method())) {
      observer.recordUnexpected(request);
      await route.abort("internetdisconnected");
      return;
    }
    if (!offlineReplay) {
      try {
        const upstream = await route.fetch();
        if (request.method() === "GET" && upstream.status() >= 200 && upstream.status() < 300) {
          const body = new Uint8Array(await upstream.body());
          await observer.recordResponseBytes(resolved.path, body);
          await route.fulfill({ response: upstream, body: Buffer.from(body.buffer, body.byteOffset, body.byteLength) });
        } else await route.fulfill({ response: upstream });
      } catch (error) {
        observer.recordResponseError(resolved.path, error);
        await route.abort("failed");
      }
      return;
    }
    if (request.method() === "HEAD") {
      await route.fulfill({ status: 200, contentType: publishContentType(resolved.path), body: "", headers: { "content-length": String(entries.get(resolved.path).byteLength), "cache-control": "no-store", "x-content-type-options": "nosniff" } });
      return;
    }
    const body = entries.get(resolved.path);
    await observer.recordResponseBytes(resolved.path, body);
    await route.fulfill({
      status: 200,
      contentType: publishContentType(resolved.path),
      body: Buffer.from(body.buffer, body.byteOffset, body.byteLength),
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" },
    });
  });
}

async function runScenario({ browser, origin, mount, entries, evidence, entrypoint, id, viewport, offlineReplay, screenshotPath, tracker, limits }) {
  const context = await browser.newContext({ viewport, javaScriptEnabled: false, serviceWorkers: "block", acceptDownloads: false, offline: offlineReplay });
  const page = await context.newPage();
  const observer = createObserver({ page, origin, mount, entries, evidence, entrypoint, limits });
  await installRequestBoundary({ context, observer, origin, mount, entries, entrypoint, offlineReplay });
  const serverCountBefore = tracker.count;
  const serverRequestIndex = Array.isArray(tracker.requests) ? tracker.requests.length : 0;
  let navigationError = null;
  let measurement = null;
  try {
    await page.goto(scenarioUrl(origin, mount, entrypoint), { waitUntil: "load", timeout: 15_000 });
    measurement = await settleAndMeasure(page);
  } catch (error) {
    navigationError = sanitizeText(error.message || error, limits);
  }
  if (!navigationError && screenshotPath) await page.screenshot({ path: screenshotPath, type: "png", animations: "disabled", caret: "hide", fullPage: false }).catch(() => {});
  const observed = await observer.finish();
  const serverRequests = trackerSlice(tracker, serverRequestIndex, limits);
  const serverRequestCount = tracker.count - serverCountBefore;
  const overflow = measurement ? measurement.scrollWidth > measurement.clientWidth + 1 : null;
  const dangerousEvents = observed.popups + observed.dialogs + observed.downloads + observed.workers + observed.websockets;
  const coverageTruncated = observed.coverageTruncated || serverRequests.truncated;
  const passed = !navigationError
    && measurement.textLength >= 20
    && !overflow
    && observed.consoleErrors.length === 0
    && observed.pageErrors.length === 0
    && observed.requestFailures.length === 0
    && observed.httpErrors.length === 0
    && observed.unexpectedRequests.length === 0
    && observed.responseVerificationErrors.length === 0
    && observed.responseProof.some((entry) => entry.path === entrypoint)
    && dangerousEvents === 0
    && !coverageTruncated
    && (!offlineReplay || serverRequestCount === 0);
  await context.close();
  return {
    id, status: passed ? "passed" : "failed", viewport, source: offlineReplay ? "offline-exact-replay" : "loopback-exact-bytes",
    mount, navigationError, measurement, overflow, serverRequestCount, serverRequests: serverRequests.requests, coverageTruncated,
    consoleTotal: observed.consoleTotal, consoleByType: observed.consoleByType, consoleErrors: observed.consoleErrors,
    pageErrors: observed.pageErrors, requestFailures: observed.requestFailures, httpErrors: observed.httpErrors,
    unexpectedRequests: observed.unexpectedRequests, responseVerificationErrors: observed.responseVerificationErrors,
    responseProof: observed.responseProof, popups: observed.popups, dialogs: observed.dialogs, downloads: observed.downloads,
    workers: observed.workers, websockets: observed.websockets, truncatedKinds: observed.truncatedKinds,
  };
}

async function runFragmentCoverage({ browser, origin, entries, evidence, entrypoint, tracker, limits }) {
  const htmlPaths = [...entries.keys()].filter((path) => /\.html?$/i.test(path)).sort(compareText);
  if (htmlPaths.length > limits.maxHtmlFiles) {
    return {
      id: "local-pages-and-fragments", status: "failed", source: "loopback-exact-bytes", mount: "/project/",
      coverageTruncated: true, truncatedKinds: ["htmlFiles"], htmlFiles: htmlPaths.length, fragments: 0,
      failures: [`HTML coverage exceeds ${limits.maxHtmlFiles} files`], consoleTotal: 0, consoleByType: {}, consoleErrors: [],
      pageErrors: [], requestFailures: [], httpErrors: [], unexpectedRequests: [], responseVerificationErrors: [], responseProof: [],
      popups: 0, dialogs: 0, downloads: 0, workers: 0, websockets: 0, serverRequestCount: 0, serverRequests: [],
    };
  }
  const mount = "/project/";
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, javaScriptEnabled: false, serviceWorkers: "block", acceptDownloads: false });
  const page = await context.newPage();
  const observer = createObserver({ page, origin, mount, entries, evidence, entrypoint, limits });
  await installRequestBoundary({ context, observer, origin, mount, entries, entrypoint, offlineReplay: false });
  const serverCountBefore = tracker.count;
  const serverRequestIndex = Array.isArray(tracker.requests) ? tracker.requests.length : 0;
  const failures = [];
  const targets = new Map();
  let totalLinks = 0;
  let coverageTruncated = false;
  for (const path of htmlPaths) {
    const url = `${origin}${mount}${encodePath(path)}`;
    let response;
    try { response = await page.goto(url, { waitUntil: "load", timeout: 15_000 }); }
    catch (error) { failures.push(`${path}: ${sanitizeText(error.message || error, limits)}`); continue; }
    if (!response || response.status() >= 400) { failures.push(`${path}: navigation failed`); continue; }
    const measurement = await settleAndMeasure(page);
    if (measurement.textLength === 0) failures.push(`${path}: rendered no visible text`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(100);
    const linkCount = await page.locator("a[href]").count();
    totalLinks += linkCount;
    if (linkCount > limits.maxLinksPerHtml || totalLinks > limits.maxTotalLinks) {
      coverageTruncated = true;
      failures.push(linkCount > limits.maxLinksPerHtml ? `${path}: link coverage exceeds ${limits.maxLinksPerHtml}` : `Total link coverage exceeds ${limits.maxTotalLinks}`);
      break;
    }
    const hrefs = await page.locator("a[href]").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    const documentUrl = page.url();
    for (const href of hrefs) {
      if (!href || !href.includes("#")) continue;
      let target;
      try { target = new URL(href, documentUrl); } catch (_) { continue; }
      if (!target.hash || target.origin !== origin || (target.pathname !== "/project" && !target.pathname.startsWith(mount))) continue;
      const key = `${target.origin}${target.pathname}${target.search}${target.hash}`;
      if (!targets.has(key)) targets.set(key, target);
      if (targets.size > limits.maxFragments) {
        coverageTruncated = true;
        failures.push(`Fragment coverage exceeds ${limits.maxFragments} unique targets`);
        break;
      }
    }
    if (coverageTruncated) break;
  }
  if (!coverageTruncated) {
    for (const target of targets.values()) {
      try {
        const response = await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 10_000 });
        // Playwright returns null for a same-document fragment navigation.
        if (response && response.status() >= 400) {
          failures.push(`Fragment page failed: ${target.pathname}${target.hash}`);
          continue;
        }
        const result = await page.evaluate(() => ({ hash: location.hash, targets: document.querySelectorAll(":target").length }));
        if (result.hash !== target.hash || result.targets !== 1) failures.push(`Fragment target failed: ${target.pathname}${target.hash}`);
      } catch (error) {
        failures.push(`Fragment navigation failed: ${target.pathname}${target.hash}: ${sanitizeText(error.message || error, limits)}`);
      }
      if (failures.length > limits.maxEventRecords) {
        coverageTruncated = true;
        failures.length = limits.maxEventRecords;
        break;
      }
    }
  }
  const observed = await observer.finish();
  const serverRequests = trackerSlice(tracker, serverRequestIndex, limits);
  const serverRequestCount = tracker.count - serverCountBefore;
  const dangerousEvents = observed.popups + observed.dialogs + observed.downloads + observed.workers + observed.websockets;
  coverageTruncated ||= observed.coverageTruncated || serverRequests.truncated;
  const passed = failures.length === 0
    && observed.consoleErrors.length === 0
    && observed.pageErrors.length === 0
    && observed.requestFailures.length === 0
    && observed.httpErrors.length === 0
    && observed.unexpectedRequests.length === 0
    && observed.responseVerificationErrors.length === 0
    && observed.responseProof.some((entry) => entry.path === entrypoint)
    && dangerousEvents === 0
    && !coverageTruncated;
  await context.close();
  return {
    id: "local-pages-and-fragments", status: passed ? "passed" : "failed", source: "loopback-exact-bytes", mount,
    coverageTruncated, htmlFiles: htmlPaths.length, totalLinks, fragments: targets.size, failures: failures.slice(0, limits.maxEventRecords),
    serverRequestCount, serverRequests: serverRequests.requests, consoleTotal: observed.consoleTotal, consoleByType: observed.consoleByType,
    consoleErrors: observed.consoleErrors, pageErrors: observed.pageErrors, requestFailures: observed.requestFailures,
    httpErrors: observed.httpErrors, unexpectedRequests: observed.unexpectedRequests, responseVerificationErrors: observed.responseVerificationErrors,
    responseProof: observed.responseProof, popups: observed.popups, dialogs: observed.dialogs, downloads: observed.downloads,
    workers: observed.workers, websockets: observed.websockets, truncatedKinds: [...new Set([...observed.truncatedKinds, ...(coverageTruncated ? ["coverage"] : [])])].sort(compareText),
  };
}

/** Prove the exact final archive bytes in a real browser without executing note scripts. */
export async function runPublishBrowserProof({
  archive,
  manifest,
  deployManifestEntries = null,
  deployContentId,
  entrypoint = "index.html",
  outputDirectory,
  browserPath = null,
  headed = false,
  startServer = startPublishByteServer,
  limits: configured = {},
} = {}) {
  if (!CONTENT_ID.test(deployContentId || "")) throw new TypeError("A sha256 deployContentId is required before browser navigation");
  if (typeof outputDirectory !== "string" || !outputDirectory) throw new TypeError("A browser proof output directory is required");
  if (typeof startServer !== "function") throw new TypeError("startServer must be a function");
  const limits = configuredLimits(configured);
  const readBack = await readStoredZipEntries(archive, manifest);
  const deploy = selectDeployEntries(readBack, deployManifestEntries);
  if (!deploy.entries.has(entrypoint)) throw new Error(`Browser proof entrypoint is missing from the final ZIP deploy payload: ${entrypoint}`);
  const actualDeployContentId = await computeDeployContentId(deploy.rows, entrypoint);
  if (deployContentId !== actualDeployContentId) throw new Error("deployContentId differs from the exact final ZIP deploy bytes");
  const archiveDigest = await digestZipSource({ bytes: archive });
  mkdirSync(outputDirectory, { recursive: true });
  const { chromium } = loadPlaywright();
  const executablePath = findPublishBrowserExecutable(chromium, browserPath);
  const tracker = { count: 0, requests: [], truncated: false };
  let server = null;
  let browser = null;
  try {
    server = await startServer(deploy.entries, tracker, { entrypoint });
    if (!server || typeof server.origin !== "string" || !/^http:\/\/127\.0\.0\.1:\d+$/.test(server.origin) || typeof server.close !== "function") {
      throw new Error("Publish byte server did not return a valid loopback origin and close handle");
    }
    browser = await chromium.launch({ executablePath, headless: !headed });
    const desktopScreenshot = join(outputDirectory, "desktop.png");
    const mobileScreenshot = join(outputDirectory, "mobile.png");
    const scenarios = [];
    scenarios.push(await runScenario({ browser, origin: server.origin, mount: "/", entries: deploy.entries, evidence: deploy.evidence, entrypoint, id: "desktop-root", viewport: { width: 1440, height: 900 }, offlineReplay: false, screenshotPath: desktopScreenshot, tracker, limits }));
    scenarios.push(await runScenario({ browser, origin: server.origin, mount: "/", entries: deploy.entries, evidence: deploy.evidence, entrypoint, id: "mobile-375-root", viewport: { width: 375, height: 812 }, offlineReplay: false, screenshotPath: mobileScreenshot, tracker, limits }));
    scenarios.push(await runScenario({ browser, origin: server.origin, mount: "/project/", entries: deploy.entries, evidence: deploy.evidence, entrypoint, id: "desktop-project-mount", viewport: { width: 1440, height: 900 }, offlineReplay: false, screenshotPath: null, tracker, limits }));
    scenarios.push(await runScenario({ browser, origin: server.origin, mount: "/project/", entries: deploy.entries, evidence: deploy.evidence, entrypoint, id: "mobile-375-project-mount", viewport: { width: 375, height: 812 }, offlineReplay: false, screenshotPath: null, tracker, limits }));
    scenarios.push(await runScenario({ browser, origin: server.origin, mount: "/offline/", entries: deploy.entries, evidence: deploy.evidence, entrypoint, id: "offline-exact-replay", viewport: { width: 1280, height: 800 }, offlineReplay: true, screenshotPath: null, tracker, limits }));
    scenarios.push(await runFragmentCoverage({ browser, origin: server.origin, entries: deploy.entries, evidence: deploy.evidence, entrypoint, tracker, limits }));

    const screenshotEntries = [];
    for (const [role, path] of [["desktop", desktopScreenshot], ["mobile", mobileScreenshot]]) {
      if (!existsSync(path)) continue;
      const bytes = new Uint8Array(await readFile(path));
      const digest = await digestZipSource({ bytes });
      screenshotEntries.push({ role, path: `${role}.png`, bytes: digest.size, sha256: digest.sha256 });
    }
    const passed = scenarios.every((scenario) => scenario.status === "passed")
      && screenshotEntries.length === 2
      && tracker.truncated === false;
    const proof = {
      schemaVersion: "1",
      kind: "html-note-publish-browser-proof",
      profile: "passive-static-v1",
      deploy: {
        contentId: actualDeployContentId,
        entrypoint,
        files: deploy.rows.length,
        bytes: deploy.rows.reduce((sum, entry) => sum + entry.size, 0),
        contract: "realitycheck-publish-deploy-content-v1",
      },
      browser: { name: "Chromium", version: browser.version() },
      safety: {
        javaScriptEnabled: false,
        serviceWorkers: "block",
        downloadsAccepted: false,
        externalRequestsAllowed: false,
        businessActionsActivated: false,
        offlineMeaning: "browser-offline-exact-package-replay",
      },
      archive: { bytes: archiveDigest.size, sha256: archiveDigest.sha256, manifestFiles: readBack.manifest.files },
      limits,
      scenarios,
      screenshots: screenshotEntries,
      evidenceTruncated: tracker.truncated || scenarios.some((scenario) => scenario.coverageTruncated),
      passed,
    };
    writeFileSync(join(outputDirectory, "browser-proof.json"), `${JSON.stringify(proof, null, 2)}\n`, "utf8");
    return { proof, screenshots: { desktop: desktopScreenshot, mobile: mobileScreenshot }, entries: deploy.entries, manifest: readBack.manifest };
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
  }
}

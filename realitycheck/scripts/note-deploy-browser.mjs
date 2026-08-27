import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { computeDeployContentId, findPublishBrowserExecutable } from "./note-publish-browser.mjs";
import { publishContentType } from "./note-publish-server.mjs";

const require = createRequire(import.meta.url);
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const SAFE_METHODS = new Set(["GET"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const FORBIDDEN_ENCODED_PATH = /%(?:00|2f|5c)/i;
const SHA256 = /^[a-f0-9]{64}$/;
const SHA256_ID = /^sha256:[a-f0-9]{64}$/;
const pathEncoder = new TextEncoder();
const FORCED_INCOMPLETE_REASONS = new Set(["browser-time-limit", "fragment-limit", "html-file-limit", "request-limit", "response-verification-incomplete"]);
const ROUTE_CLEANUP_GRACE_MS = 1_000;
const BROWSER_CLEANUP_GRACE_MS = 5_000;

export const LIVE_DEPLOY_BROWSER_LIMITS = Object.freeze({
  maxHtmlFiles: 200,
  maxFragments: 500,
  maxRequests: 2_000,
  navigationTimeoutMs: 15_000,
  maxRunTimeMs: 120_000,
  maxBrowserResponseBytes: 32 * 1024 * 1024,
  maxBrowserTotalBytes: 192 * 1024 * 1024,
  browserRequestTimeoutMs: 10_000,
});

/** Observe one promise without allowing it to hold a live-proof deadline open. */
export async function waitForLiveBrowserDeadline(promise, deadline) {
  const remaining = deadline - Date.now();
  const observed = Promise.resolve(promise).then(
    (value) => ({ settled: true, value, error: null }),
    (error) => ({ settled: true, value: undefined, error }),
  );
  if (remaining <= 0) return { settled: false, value: undefined, error: null };
  let timer;
  try {
    return await Promise.race([
      observed,
      new Promise((resolve) => { timer = setTimeout(() => resolve({ settled: false, value: undefined, error: null }), remaining); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function loadPlaywright() {
  for (const resolver of [require, createRequire(join(process.cwd(), "package.json"))]) {
    for (const packageName of ["playwright-core", "playwright"]) {
      try { return resolver(packageName); } catch (_) {}
    }
  }
  throw new Error("Playwright Core is required for live deployment browser proof");
}

function configuredLimits(input = {}) {
  const limits = {};
  for (const [name, fallback] of Object.entries(LIVE_DEPLOY_BROWSER_LIMITS)) {
    const value = input[name] ?? fallback;
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer`);
    limits[name] = value;
  }
  return limits;
}

function normalizedPathname(pathname) {
  if (FORBIDDEN_ENCODED_PATH.test(pathname)) throw new Error("Deployment URL contains an encoded separator or NUL");
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch (_) { throw new Error("Deployment URL path must use valid percent encoding"); }
  if (decoded.includes("\\") || decoded.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("Deployment URL path is not portable");
  }
  return pathname;
}

export function normalizeLiveBrowserTarget(value) {
  const url = new URL(value);
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("Deployment URL protocol must be http or https");
  if (url.username || url.password) throw new Error("Deployment URL must not contain credentials");
  if (url.search || url.hash) throw new Error("Deployment URL must not contain a query or fragment");
  normalizedPathname(url.pathname);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  if (url.pathname.length > 500 || pathEncoder.encode(url.pathname).byteLength > 1024) throw new Error("Deployment URL path exceeds the live receipt boundary");
  return Object.freeze({
    url: url.href,
    origin: url.origin,
    basePath: url.pathname,
  });
}

function encodePortablePath(path) {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function normalizeEntries(input, entrypoint) {
  const rows = input instanceof Map
    ? [...input].map(([path, bytes]) => ({ path, bytes }))
    : Array.isArray(input)
      ? input.map((entry) => ({ path: entry.path, bytes: entry.bytes ?? null }))
      : [];
  if (!rows.length) throw new Error("Live browser proof requires deploy entries");
  const seen = new Set();
  const evidence = new Map();
  const exactBytes = new Map();
  for (const row of rows) {
    if (typeof row.path !== "string" || !row.path || row.path.startsWith("/") || row.path.includes("\\") || row.path.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new Error("Live browser proof received an unsafe deploy path");
    }
    if (row.path.length > 500 || pathEncoder.encode(row.path).byteLength > 1024) throw new Error(`Live browser deploy path exceeds the receipt boundary: ${row.path.slice(0, 80)}`);
    if (seen.has(row.path)) throw new Error(`Duplicate live browser deploy path: ${row.path}`);
    seen.add(row.path);
    if (!(row.bytes instanceof Uint8Array)) throw new Error(`Live browser deploy entry is missing exact bytes: ${row.path}`);
    evidence.set(row.path, { size: row.bytes.byteLength, sha256: createHash("sha256").update(row.bytes).digest("hex") });
    exactBytes.set(row.path, row.bytes);
  }
  if (!seen.has(entrypoint)) throw new Error(`Live browser entrypoint is absent: ${entrypoint}`);
  return {
    rows: rows.sort((left, right) => compareText(left.path, right.path)),
    paths: seen,
    evidence,
    exactBytes,
  };
}

function routeForArchivePath(target, path, entrypoint) {
  if (path === entrypoint && entrypoint === "index.html") return target.url;
  return new URL(encodePortablePath(path), target.url).href;
}

/** Map one same-origin live URL to a declared archive path without guessing. */
export function mapLiveRequestPath(value, targetValue, declaredPaths, entrypoint = "index.html") {
  const target = typeof targetValue === "string" ? normalizeLiveBrowserTarget(targetValue) : targetValue;
  const paths = declaredPaths instanceof Set ? declaredPaths : new Set(declaredPaths);
  let url;
  try { url = new URL(value); } catch (_) { return null; }
  if (url.origin !== target.origin || url.username || url.password || FORBIDDEN_ENCODED_PATH.test(url.pathname)) return null;
  const baseWithoutSlash = target.basePath === "/" ? "/" : target.basePath.slice(0, -1);
  if (url.pathname === baseWithoutSlash || url.pathname === target.basePath) return paths.has(entrypoint) ? entrypoint : null;
  if (!url.pathname.startsWith(target.basePath)) return null;
  const encodedRelative = url.pathname.slice(target.basePath.length);
  let relative;
  try { relative = decodeURIComponent(encodedRelative); } catch (_) { return null; }
  if (!relative || relative.startsWith("/") || relative.includes("\\")) return null;
  const directoryRoute = relative.endsWith("/");
  const portableParts = relative.slice(0, directoryRoute ? -1 : undefined).split("/");
  if (portableParts.some((part) => !part || part === "." || part === "..")) return null;
  if (paths.has(relative)) return relative;
  if (directoryRoute && paths.has(`${relative}index.html`)) return `${relative}index.html`;
  return null;
}

function scenarioState(id, viewport) {
  const state = {
    id,
    status: "failed",
    viewport,
    navigations: 0,
    requests: 0,
    htmlPages: 0,
    fragments: 0,
    fragmentFailures: 0,
    consoleErrors: 0,
    pageErrors: 0,
    requestFailures: 0,
    httpErrors: 0,
    responseVerificationErrors: 0,
    capsuleFallbackRequests: 0,
    unexpectedRequests: 0,
    redirectsOutsideScope: 0,
    horizontalOverflow: 0,
    popups: 0,
    dialogs: 0,
    downloads: 0,
    workers: 0,
    websockets: 0,
    coverageTruncated: false,
    reasonCodes: [],
  };
  Object.defineProperty(state, "incompleteRequests", { value: new WeakSet(), enumerable: false });
  Object.defineProperty(state, "frozen", { value: false, writable: true, enumerable: false });
  return state;
}

function finishScenario(state) {
  state.reasonCodes = [...new Set(state.reasonCodes)].sort(compareText);
  const failed = state.fragmentFailures
    || state.consoleErrors
    || state.pageErrors
    || state.requestFailures
    || state.httpErrors
    || state.responseVerificationErrors
    || state.unexpectedRequests
    || state.redirectsOutsideScope
    || state.horizontalOverflow
    || state.popups
    || state.dialogs
    || state.downloads
    || state.workers
    || state.websockets;
  const forcedIncomplete = state.coverageTruncated && state.reasonCodes.some((reason) => FORCED_INCOMPLETE_REASONS.has(reason));
  const navigationIncomplete = !failed && state.reasonCodes.some((reason) => reason === "html-navigation-failed" || reason === "navigation-failed");
  state.status = failed ? "failed" : forcedIncomplete || navigationIncomplete ? "incomplete" : "passed";
  return state;
}

const FORWARDED_REQUEST_HEADERS = new Set(["accept", "accept-language", "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site", "sec-fetch-user", "user-agent"]);
const FORWARDED_RESPONSE_HEADERS = new Set([
  "clear-site-data", "content-disposition", "content-language", "content-security-policy", "content-security-policy-report-only", "content-type",
  "cross-origin-embedder-policy", "cross-origin-opener-policy", "cross-origin-resource-policy", "link", "nel", "origin-agent-cluster",
  "permissions-policy", "referrer-policy", "refresh", "reporting-endpoints", "report-to", "x-content-type-options",
]);

function reviewedRequestHeaders(request) {
  const headers = request.headers();
  if (headers.range) return null;
  return Object.fromEntries(Object.entries(headers).filter(([name, value]) => FORWARDED_REQUEST_HEADERS.has(name.toLowerCase()) && typeof value === "string" && value.length <= 1000 && !/[\r\n]/.test(value)));
}

function reviewedResponseHeaders(response) {
  const headers = {};
  for (const [name, value] of response.headers) {
    if (!FORWARDED_RESPONSE_HEADERS.has(name.toLowerCase())) continue;
    if (value.length > 4000 || /[\r\n]/.test(value)) return null;
    headers[name.toLowerCase()] = value;
  }
  return headers;
}

function contentTypeSupportsPath(path, headers) {
  const mediaType = String(headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (/\.html?$/i.test(path)) return new Set(["text/html", "application/xhtml+xml"]).has(mediaType);
  if (/\.css$/i.test(path)) return mediaType === "text/css";
  return true;
}

async function verifyLiveBrowserRequest(initialUrl, path, request, target, deploy, limits, budget, deadline) {
  const incomplete = (reason) => ({ ok: false, incomplete: true, reason });
  const broken = (reason) => ({ ok: false, incomplete: false, reason });
  const expected = deploy.evidence.get(path);
  const exact = deploy.exactBytes.get(path);
  if (!expected || !(exact instanceof Uint8Array)) return incomplete("expected-bytes-unavailable");
  const requestHeaders = reviewedRequestHeaders(request);
  if (!requestHeaders) return incomplete("request-headers-unsupported");
  let redirectedFrom = request.redirectedFrom?.() || null;
  let redirectCount = 0;
  while (redirectedFrom) {
    redirectCount += 1;
    if (redirectCount > 5) return broken("redirect-limit");
    redirectedFrom = redirectedFrom.redirectedFrom?.() || null;
  }
  const current = new URL(initialUrl);
  const remaining = Math.min(limits.browserRequestTimeoutMs, deadline - Date.now());
  if (remaining <= 0) return incomplete("browser-time-limit");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining);
  try {
    const response = await fetch(current, {
      method: "GET", redirect: "manual", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
      headers: requestHeaders, signal: controller.signal,
    });
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirectCount >= 5) return broken("redirect-policy");
      const next = new URL(location, current);
      if (next.username || next.password || next.search || next.hash || next.origin !== target.origin || !mapLiveRequestPath(next.href, target, deploy.paths)) return broken("redirect-boundary");
      return { ok: true, redirect: { status: response.status, location: next.href } };
    }
    if (response.status !== 200) return broken("http-status");
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > limits.maxBrowserResponseBytes) return incomplete("response-size-limit");
    const decodedLimit = Math.min(limits.maxBrowserResponseBytes, expected.size + 1);
    const hash = createHash("sha256");
    let size = 0;
    const reader = response.body?.getReader?.();
    if (!reader) return incomplete("response-body-unavailable");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      budget.used += value.byteLength;
      if (size > decodedLimit || budget.used > limits.maxBrowserTotalBytes || Date.now() >= deadline) {
          controller.abort();
          await reader.cancel().catch(() => {});
          return incomplete(Date.now() >= deadline ? "browser-time-limit" : "response-size-limit");
      }
      hash.update(value);
    }
    if (size !== expected.size || hash.digest("hex") !== expected.sha256) return broken("response-bytes-differ");
    const headers = reviewedResponseHeaders(response);
    if (!headers) return incomplete("response-headers-unsupported");
    if (!contentTypeSupportsPath(path, headers)) return broken("content-type-invalid");
    return { ok: true, body: Buffer.from(exact.buffer, exact.byteOffset, exact.byteLength), headers };
  } catch (_) {
    return incomplete("response-request-failed");
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function createBoundedContext(browser, target, deploy, limits, state, browserBudget, deadline) {
  const context = await browser.newContext({
    viewport: state.viewport,
    javaScriptEnabled: false,
    acceptDownloads: false,
    serviceWorkers: "block",
    permissions: [],
  });
  const pendingRoutes = new Set();
  let acceptingRoutes = true;
  const markTimeLimit = () => {
    if (state.frozen) return;
    state.coverageTruncated = true;
    state.reasonCodes.push("browser-time-limit");
  };
  const markIncomplete = (request) => {
    if (state.frozen) return;
    state.coverageTruncated = true;
    state.reasonCodes.push("response-verification-incomplete");
    if (request) state.incompleteRequests.add(request);
  };
  const routeAction = async (factory, request, { cleanup = false } = {}) => {
    if (!cleanup && Date.now() >= deadline) {
      markTimeLimit();
      markIncomplete(request);
      return false;
    }
    let action;
    try { action = factory(); }
    catch (_) { markIncomplete(request); return false; }
    const actionDeadline = cleanup ? Math.max(deadline, Date.now() + ROUTE_CLEANUP_GRACE_MS) : deadline;
    const outcome = await waitForLiveBrowserDeadline(action, actionDeadline);
    if (!outcome.settled) {
      markTimeLimit();
      markIncomplete(request);
      return false;
    }
    if (outcome.error) {
      markIncomplete(request);
      return false;
    }
    return true;
  };
  const handleRoute = async (route) => {
    const request = route.request();
    if (!acceptingRoutes || state.frozen) {
      markIncomplete(request);
      await routeAction(() => route.abort("blockedbyclient"), request, { cleanup: true });
      return;
    }
    state.requests += 1;
    if (state.requests > limits.maxRequests) {
      state.coverageTruncated = true;
      state.reasonCodes.push("request-limit");
      await routeAction(() => route.abort("blockedbyclient"), request, { cleanup: true });
      return;
    }
    const path = mapLiveRequestPath(request.url(), target, deploy.paths);
    if (!path || !SAFE_METHODS.has(request.method())) {
      state.unexpectedRequests += 1;
      state.reasonCodes.push("unexpected-request");
      await routeAction(() => route.abort("blockedbyclient"), request, { cleanup: true });
      return;
    }
    const verified = await verifyLiveBrowserRequest(new URL(request.url()), path, request, target, deploy, limits, browserBudget, deadline);
    if (state.frozen) {
      await routeAction(() => route.abort("blockedbyclient"), request, { cleanup: true });
      return;
    }
    if (!verified.ok) {
      if (verified.incomplete) {
        markIncomplete(request);
        const fallback = deploy.exactBytes.get(path);
        if (fallback instanceof Uint8Array) {
          const delivered = await routeAction(() => route.fulfill({
            status: 200,
            body: Buffer.from(fallback.buffer, fallback.byteOffset, fallback.byteLength),
            headers: { "content-type": publishContentType(path) },
          }), request);
          if (delivered && !state.frozen) state.capsuleFallbackRequests += 1;
          else await routeAction(() => route.abort("blockedbyclient"), request, { cleanup: true });
          return;
        }
      } else state.responseVerificationErrors += 1;
      await routeAction(() => route.abort("blockedbyclient"), request, { cleanup: true });
      return;
    }
    if (verified.redirect) {
      const delivered = await routeAction(() => route.fulfill({ status: verified.redirect.status, headers: { location: verified.redirect.location }, body: "" }), request);
      if (!delivered) await routeAction(() => route.abort("blockedbyclient"), request, { cleanup: true });
      return;
    }
    const delivered = await routeAction(() => route.fulfill({ status: 200, body: verified.body, headers: verified.headers }), request);
    if (!delivered) await routeAction(() => route.abort("blockedbyclient"), request, { cleanup: true });
  };
  await context.route("**/*", (route) => {
    const request = route.request();
    let task;
    task = handleRoute(route)
      .catch(async () => {
        markIncomplete(request);
        await routeAction(() => route.abort("blockedbyclient"), request, { cleanup: true });
      })
      .finally(() => pendingRoutes.delete(task));
    pendingRoutes.add(task);
    return task;
  });
  const settleRoutes = async ({ seal = false } = {}) => {
    if (seal) acceptingRoutes = false;
    while (pendingRoutes.size) {
      const outcome = await waitForLiveBrowserDeadline(Promise.allSettled([...pendingRoutes]), deadline);
      if (!outcome.settled) { markTimeLimit(); return false; }
    }
    const turn = await waitForLiveBrowserDeadline(new Promise((resolve) => setImmediate(resolve)), deadline);
    if (!turn.settled) { markTimeLimit(); return false; }
    while (pendingRoutes.size) {
      const outcome = await waitForLiveBrowserDeadline(Promise.allSettled([...pendingRoutes]), deadline);
      if (!outcome.settled) { markTimeLimit(); return false; }
    }
    return true;
  };
  const stopRoutes = async () => settleRoutes({ seal: true });
  return { context, settleRoutes, stopRoutes };
}

function observePage(page, target, deploy, state) {
  page.on("console", (message) => { if (!state.frozen && message.type() === "error") state.consoleErrors += 1; });
  page.on("pageerror", () => { if (!state.frozen) state.pageErrors += 1; });
  page.on("requestfailed", (request) => {
    if (state.frozen) return;
    if (state.incompleteRequests.has(request)) return;
    if (mapLiveRequestPath(request.url(), target, deploy.paths)) state.requestFailures += 1;
  });
  page.on("response", (response) => {
    if (state.frozen) return;
    const status = response.status();
    const path = mapLiveRequestPath(response.url(), target, deploy.paths);
    if (path && status !== 200 && !REDIRECT_STATUSES.has(status)) state.httpErrors += 1;
    if (status >= 300 && status < 400) {
      const location = response.headers().location;
      if (location) {
        try {
          const redirect = new URL(location, response.url());
          if (!mapLiveRequestPath(redirect.href, target, deploy.paths)) state.redirectsOutsideScope += 1;
        } catch (_) { state.redirectsOutsideScope += 1; }
      }
    }
  });
  page.on("popup", (popup) => { if (!state.frozen) state.popups += 1; void popup.close().catch(() => {}); });
  page.on("dialog", (dialog) => { if (!state.frozen) state.dialogs += 1; void dialog.dismiss().catch(() => {}); });
  page.on("download", (download) => { if (!state.frozen) state.downloads += 1; void download.cancel().catch(() => {}); });
  page.on("worker", () => { if (!state.frozen) state.workers += 1; });
  page.on("websocket", () => { if (!state.frozen) state.websockets += 1; });
}

async function captureBrowserScreenshot(page, path, deadline) {
  const remaining = deadline - Date.now();
  const timeout = Math.max(1, Math.min(15_000, remaining > 0 ? remaining : ROUTE_CLEANUP_GRACE_MS));
  return page.screenshot({ path, fullPage: true, timeout });
}

async function closeBrowserContext(context, state) {
  let closing;
  try { closing = context.close(); }
  catch (_) { closing = Promise.reject(_); }
  const outcome = await waitForLiveBrowserDeadline(closing, Date.now() + ROUTE_CLEANUP_GRACE_MS);
  if (!outcome.settled || outcome.error) {
    if (!state.frozen) {
      state.coverageTruncated = true;
      state.reasonCodes.push("browser-time-limit");
    }
    return false;
  }
  return true;
}

async function navigateAndMeasure(page, url, state, limits, deadline, settleRoutes) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    state.coverageTruncated = true;
    state.reasonCodes.push("browser-time-limit");
    throw new Error("browser-time-limit");
  }
  state.navigations += 1;
  const response = await page.goto(url, { waitUntil: "load", timeout: Math.min(limits.navigationTimeoutMs, remaining) });
  if (!await settleRoutes()) throw new Error("browser-time-limit");
  if (!response || response.status() >= 400) state.httpErrors += 1;
  const measurement = await page.evaluate(() => ({
    documentWidth: Math.max(document.documentElement?.scrollWidth || 0, document.body?.scrollWidth || 0),
    viewportWidth: document.documentElement?.clientWidth || window.innerWidth || 0,
  }));
  if (measurement.documentWidth > measurement.viewportWidth + 1) state.horizontalOverflow += 1;
  return response;
}

async function runViewportScenario({ browser, target, deploy, entrypoint, id, viewport, screenshotPath, limits, deadline, browserBudget }) {
  const state = scenarioState(id, viewport);
  const { context, settleRoutes, stopRoutes } = await createBoundedContext(browser, target, deploy, limits, state, browserBudget, deadline);
  let page = null;
  try {
    page = await context.newPage();
    observePage(page, target, deploy, state);
    await navigateAndMeasure(page, routeForArchivePath(target, entrypoint, entrypoint), state, limits, deadline, settleRoutes);
    state.htmlPages = 1;
    if (screenshotPath) {
      const fallbacksBefore = state.capsuleFallbackRequests;
      await captureBrowserScreenshot(page, screenshotPath, deadline);
      await settleRoutes();
      if (state.capsuleFallbackRequests !== fallbacksBefore) await captureBrowserScreenshot(page, screenshotPath, deadline);
    }
  } catch (_) {
    state.reasonCodes.push("navigation-failed");
  } finally {
    await settleRoutes();
    if (screenshotPath && page && !existsSync(screenshotPath)) {
      await captureBrowserScreenshot(page, screenshotPath, deadline).catch(() => {});
      await settleRoutes();
    }
    await stopRoutes();
    await closeBrowserContext(context, state);
    await settleRoutes();
  }
  const result = finishScenario(state);
  state.frozen = true;
  return result;
}

async function runPageAndFragmentScenario({ browser, target, deploy, entrypoint, limits, deadline, browserBudget }) {
  const state = scenarioState("live-pages-and-fragments", { width: 1280, height: 800 });
  const htmlPaths = deploy.rows.filter((row) => /\.html?$/i.test(row.path)).map((row) => row.path);
  if (htmlPaths.length > limits.maxHtmlFiles) {
    state.coverageTruncated = true;
    state.reasonCodes.push("html-file-limit");
    const result = finishScenario(state);
    state.frozen = true;
    return result;
  }
  const { context, settleRoutes, stopRoutes } = await createBoundedContext(browser, target, deploy, limits, state, browserBudget, deadline);
  try {
    const page = await context.newPage();
    observePage(page, target, deploy, state);
    const fragments = [];
    for (const path of htmlPaths) {
      if (Date.now() >= deadline) {
        state.coverageTruncated = true;
        state.reasonCodes.push("browser-time-limit");
        break;
      }
      const pageUrl = routeForArchivePath(target, path, entrypoint);
      try {
        await navigateAndMeasure(page, pageUrl, state, limits, deadline, settleRoutes);
        state.htmlPages += 1;
        const hrefs = await page.locator("a[href*='#']").evaluateAll((anchors) => anchors.slice(0, 501).map((anchor) => anchor.getAttribute("href")));
        for (const href of hrefs) {
          if (!href || fragments.length >= limits.maxFragments) {
            if (href) {
              state.coverageTruncated = true;
              state.reasonCodes.push("fragment-limit");
            }
            break;
          }
          let resolved;
          try { resolved = new URL(href, pageUrl); } catch (_) { continue; }
          if (!resolved.hash || resolved.origin !== target.origin || !mapLiveRequestPath(resolved.href, target, deploy.paths)) continue;
          fragments.push({ url: resolved.href, sourcePath: path });
        }
      } catch (_) {
        state.reasonCodes.push("html-navigation-failed");
      }
    }
    for (const fragment of fragments) {
      if (Date.now() >= deadline) {
        state.coverageTruncated = true;
        state.reasonCodes.push("browser-time-limit");
        break;
      }
      try {
        await page.goto(fragment.url, { waitUntil: "load", timeout: Math.min(limits.navigationTimeoutMs, Math.max(1, deadline - Date.now())) });
        if (!await settleRoutes()) throw new Error("browser-time-limit");
        state.navigations += 1;
        state.fragments += 1;
        const present = await page.evaluate(() => {
          let id;
          try { id = decodeURIComponent(location.hash.slice(1)); } catch (_) { return false; }
          return Boolean(id && (document.getElementById(id) || document.getElementsByName(id).length));
        });
        if (!present) state.fragmentFailures += 1;
      } catch (_) {
        state.fragmentFailures += 1;
      }
    }
  } finally {
    await settleRoutes();
    await stopRoutes();
    await closeBrowserContext(context, state);
    await settleRoutes();
  }
  const result = finishScenario(state);
  state.frozen = true;
  return result;
}

export async function runLiveDeploymentBrowserProof({
  targetUrl,
  entries,
  source,
  entrypoint = "index.html",
  browserPath = null,
  outputDirectory,
  generatedAt = new Date().toISOString(),
  limits: suppliedLimits = {},
} = {}) {
  const target = normalizeLiveBrowserTarget(targetUrl);
  const deploy = normalizeEntries(entries, entrypoint);
  if (!source || !SHA256.test(source.archiveSha256 || "") || !Number.isSafeInteger(source.archiveBytes) || source.archiveBytes < 1
    || !SHA256_ID.test(source.deployContentId || "") || !SHA256_ID.test(source.publishManifestId || "") || !SHA256_ID.test(source.finalArchiveBrowserProofId || "")) {
    throw new Error("Live browser proof requires the validated archive, manifest, deploy-content, and final-browser identities");
  }
  const candidateEntries = new Map(deploy.rows.filter((entry) => !entry.path.startsWith("realitycheck-proof/")).map((entry) => [entry.path, entry.bytes]));
  if (await computeDeployContentId(candidateEntries, entrypoint) !== source.deployContentId) throw new Error("Live browser proof deploy entries do not match the source deploy content ID");
  const limits = configuredLimits(suppliedLimits);
  const deadline = Date.now() + limits.maxRunTimeMs;
  if (!outputDirectory) throw new Error("Live browser proof requires an output directory");
  const output = resolve(outputDirectory);
  mkdirSync(output, { recursive: true });
  const screenshotDirectory = join(output, "screenshots");
  mkdirSync(screenshotDirectory, { recursive: true });
  const desktopScreenshot = join(screenshotDirectory, "live-desktop.png");
  const mobileScreenshot = join(screenshotDirectory, "live-mobile-375.png");
  const { chromium } = loadPlaywright();
  const executablePath = findPublishBrowserExecutable(chromium, browserPath);
  if (!existsSync(executablePath)) throw new Error("The selected live-proof browser executable does not exist");
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--disable-background-networking", "--disable-component-update", "--disable-default-apps", "--disable-sync", "--metrics-recording-only", "--no-first-run"],
  });
  const browserVersion = browser.version();
  let scenarios;
  const browserBudget = { used: 0 };
  try {
    scenarios = [
      await runViewportScenario({ browser, target, deploy, entrypoint, id: "live-desktop", viewport: { width: 1440, height: 900 }, screenshotPath: desktopScreenshot, limits, deadline, browserBudget }),
      await runViewportScenario({ browser, target, deploy, entrypoint, id: "live-mobile-375", viewport: { width: 375, height: 812 }, screenshotPath: mobileScreenshot, limits, deadline, browserBudget }),
      await runPageAndFragmentScenario({ browser, target, deploy, entrypoint, limits, deadline, browserBudget }),
    ];
  } finally {
    let closing;
    try { closing = browser.close(); }
    catch (_) { closing = Promise.reject(_); }
    const outcome = await waitForLiveBrowserDeadline(closing, Date.now() + BROWSER_CLEANUP_GRACE_MS);
    if (!outcome.settled || outcome.error) throw new Error("Live deployment browser cleanup did not complete within its bounded grace period");
  }
  const passedCount = scenarios.filter((scenario) => scenario.status === "passed").length;
  const failedCount = scenarios.filter((scenario) => scenario.status === "failed").length;
  const incompleteCount = scenarios.filter((scenario) => scenario.status === "incomplete").length;
  const proofStatus = failedCount ? "failed" : incompleteCount ? "incomplete" : "passed";
  const screenshots = [
    ["desktop", "screenshots/live-desktop.png", desktopScreenshot, scenarios[0]],
    ["mobile-375", "screenshots/live-mobile-375.png", mobileScreenshot, scenarios[1]],
  ].filter(([, , path]) => existsSync(path)).map(([role, path, absolute, scenario]) => {
    const bytes = readFileSync(absolute);
    return {
      role,
      path,
      source: scenario.capsuleFallbackRequests > 0 ? "diagnostic-with-capsule-fallback" : "live-response-only",
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  });
  if (screenshots.length !== 2) throw new Error("Live deployment browser proof could not bind both required browser screenshots");
  const proof = {
    schemaVersion: "1",
    kind: "html-note-deployment-browser-proof",
    profile: "passive-static-live-v1",
    generatedAt,
    source: {
      archiveSha256: source.archiveSha256,
      archiveBytes: source.archiveBytes,
      deployContentId: source.deployContentId,
      publishManifestId: source.publishManifestId,
      finalArchiveBrowserProofId: source.finalArchiveBrowserProofId,
    },
    target: { origin: target.origin, basePath: target.basePath },
    browser: {
      family: "chromium", version: browserVersion, javascriptEnabled: false, cleanContextPerScenario: true,
      liveResponsesReverified: true, cookiesForwarded: false, authorizationForwarded: false, referrerForwarded: false,
    },
    limits: { ...limits },
    status: proofStatus,
    scenarios,
    summary: {
      total: scenarios.length,
      passed: passedCount,
      failed: failedCount,
      incomplete: incompleteCount,
    },
    screenshots,
  };
  proof.proofId = `sha256:${createHash("sha256").update(JSON.stringify(proof)).digest("hex")}`;
  return proof;
}

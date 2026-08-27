import { createHash } from "node:crypto";

import { validatePortableZipEntryPath } from "./note-zip.mjs";

const encoder = new TextEncoder();
const SHA256 = /^[a-f0-9]{64}$/;
const SHA256_ID = /^sha256:[a-f0-9]{64}$/;
const READY_STATUSES = new Set(["ready", "warnings"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RETRYABLE_STATUSES = new Set([404, 408, 425, 429]);
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

export const NOTE_DEPLOY_HTTP_STATUSES = Object.freeze([
  "exact-match",
  "transformed-review",
  "broken",
  "unverified",
]);

export const DEFAULT_NOTE_DEPLOY_VERIFY_LIMITS = Object.freeze({
  maxEntries: 1_000,
  maxEntryBytes: 32 * 1024 * 1024,
  maxExpectedBytes: 64 * 1024 * 1024,
  maxResponseBytes: 32 * 1024 * 1024,
  maxTotalResponseBytes: 192 * 1024 * 1024,
  maxPathBytes: 1_024,
  maxPathCharacters: 500,
  maxRedirects: 5,
  maxAttempts: 3,
  retryDelayMs: 500,
  requestTimeoutMs: 10_000,
  maxRunTimeMs: 120_000,
});

const LIMIT_CEILINGS = Object.freeze({
  maxEntries: 5_000,
  maxEntryBytes: 512 * 1024 * 1024,
  maxExpectedBytes: 512 * 1024 * 1024,
  maxResponseBytes: 512 * 1024 * 1024,
  maxTotalResponseBytes: 1024 * 1024 * 1024,
  maxPathBytes: 8 * 1024,
  maxPathCharacters: 500,
  maxRedirects: 10,
  maxAttempts: 5,
  retryDelayMs: 5_000,
  requestTimeoutMs: 60_000,
  maxRunTimeMs: 600_000,
});

class CoverageLimitError extends Error {
  constructor(code) {
    super(code);
    this.name = "CoverageLimitError";
    this.code = code;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function configuredLimits(input = {}) {
  if (!isRecord(input)) throw new TypeError("deployment verification limits must be an object");
  const limits = {};
  for (const [name, fallback] of Object.entries(DEFAULT_NOTE_DEPLOY_VERIFY_LIMITS)) {
    const value = input[name] ?? fallback;
    const permitsZero = name === "retryDelayMs";
    if (!Number.isSafeInteger(value) || value < (permitsZero ? 0 : 1) || value > LIMIT_CEILINGS[name]) {
      throw new RangeError(`${name} must be an integer from ${permitsZero ? 0 : 1} to ${LIMIT_CEILINGS[name]}`);
    }
    limits[name] = value;
  }
  return limits;
}

function normalizedIdentity(input) {
  if (!isRecord(input)) throw new TypeError("a validated publish identity is required");
  if (!READY_STATUSES.has(input.status) || input.publishReady !== true || input.finalArchiveBrowserProofPassed !== true) {
    throw new Error("live verification requires a publish-ready capsule with completed final-archive browser proof");
  }
  if (!isRecord(input.archive) || !SHA256.test(input.archive.sha256 || "") || !Number.isSafeInteger(input.archive.bytes) || input.archive.bytes <= 0 || input.archive.readBackVerified !== true) {
    throw new TypeError("publish identity requires read-back-verified archive SHA-256 and size metadata");
  }
  if (!isRecord(input.manifest) || !SHA256_ID.test(input.manifest.manifestId || "") || !SHA256_ID.test(input.manifest.deployContentId || "")) {
    throw new TypeError("publish identity requires manifest and deploy-content SHA-256 IDs");
  }
  if (!SHA256_ID.test(input.browserProofId || "")) throw new TypeError("publish identity requires a final-archive browser proof ID");
  const entrypoint = validatePortableZipEntryPath(input.entrypoint);
  if (entrypoint !== "index.html") throw new Error("live deployment verification requires the capsule root index.html entrypoint");
  if (!Array.isArray(input.entries) || input.entries.length === 0) throw new TypeError("publish identity requires declared archive entries");
  const seen = new Set();
  const seenNfc = new Map();
  const seenFolded = new Map();
  const entries = input.entries.map((entry) => {
    if (!isRecord(entry) || !Number.isSafeInteger(entry.size) || entry.size < 0 || !SHA256.test(entry.sha256 || "")) {
      throw new TypeError("declared archive entries require path, non-negative size, and SHA-256");
    }
    const path = validatePortableZipEntryPath(entry.path);
    if (seen.has(path)) throw new Error(`duplicate declared archive path: ${path}`);
    seen.add(path);
    const nfc = path.normalize("NFC");
    if (seenNfc.has(nfc)) throw new Error(`Unicode-normalized declared path collision: ${seenNfc.get(nfc)} and ${path}`);
    seenNfc.set(nfc, path);
    const folded = nfc.toUpperCase().toLowerCase();
    if (seenFolded.has(folded)) throw new Error(`case-folded declared path collision: ${seenFolded.get(folded)} and ${path}`);
    seenFolded.set(folded, path);
    return { path, size: entry.size, sha256: entry.sha256 };
  }).sort((left, right) => compareText(left.path, right.path));
  if (!entries.some((entry) => entry.path === entrypoint)) throw new Error("publish entrypoint is absent from the declared archive entries");
  return {
    status: input.status,
    publishReady: true,
    finalArchiveBrowserProofPassed: true,
    archive: { sha256: input.archive.sha256, bytes: input.archive.bytes, readBackVerified: true },
    manifest: { manifestId: input.manifest.manifestId, deployContentId: input.manifest.deployContentId },
    browserProofId: input.browserProofId,
    entrypoint,
    entries,
  };
}

function rawUrlPath(value) {
  const scheme = value.indexOf("://");
  const authorityStart = scheme + 3;
  const slash = value.indexOf("/", authorityStart);
  return slash < 0 ? "/" : value.slice(slash);
}

function validateEncodedPath(path, { requireTrailingSlash = false } = {}) {
  if (!path.startsWith("/") || path.includes("\\") || /%(?:2f|5c)/i.test(path)) throw new TypeError("deployment URL contains an unsafe encoded path");
  if (requireTrailingSlash && !path.endsWith("/")) throw new TypeError("deployment base URL must end with a slash");
  const interior = path.slice(1, requireTrailingSlash ? -1 : undefined);
  if (!interior) return;
  const segments = interior.split("/");
  if (segments.some((segment) => !segment)) throw new TypeError("deployment URL path contains an empty segment");
  for (const encoded of segments) {
    let segment;
    try { segment = decodeURIComponent(encoded); } catch (_) { throw new TypeError("deployment URL path contains invalid percent encoding"); }
    if (!segment || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\") || /[\p{Cc}\p{Cf}]/u.test(segment)) {
      throw new TypeError("deployment URL contains an unsafe decoded path segment");
    }
  }
}

function isLoopbackHostname(value) {
  let host = value.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map(Number);
  return octets.every((part) => part >= 0 && part <= 255) && octets[0] === 127;
}

/** Validate and normalize the only origin/base path that verification may contact. */
export function validateNoteDeploymentBaseUrl(value, { allowRemote = false } = {}) {
  if (typeof value !== "string" || !value || value !== value.trim()) throw new TypeError("deployment base URL must be a non-empty trimmed string");
  if (value.includes("?") || value.includes("#")) throw new TypeError("deployment base URL must not contain a query or fragment");
  const rawPath = rawUrlPath(value);
  validateEncodedPath(rawPath, { requireTrailingSlash: true });
  let url;
  try { url = new URL(value); } catch (_) { throw new TypeError("deployment base URL is invalid"); }
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new TypeError("deployment base URL must use http or https");
  if (url.username || url.password) throw new TypeError("deployment base URL must not contain credentials");
  if (url.search || url.hash) throw new TypeError("deployment base URL must not contain a query or fragment");
  validateEncodedPath(url.pathname, { requireTrailingSlash: true });
  if (url.pathname.length > DEFAULT_NOTE_DEPLOY_VERIFY_LIMITS.maxPathCharacters || encoder.encode(url.pathname).byteLength > DEFAULT_NOTE_DEPLOY_VERIFY_LIMITS.maxPathBytes) {
    throw new TypeError("deployment base URL path exceeds the live receipt path boundary");
  }
  const loopback = isLoopbackHostname(url.hostname);
  return {
    baseUrl: url.toString(),
    origin: url.origin,
    basePath: url.pathname,
    loopback,
    authorized: loopback || allowRemote === true,
  };
}

function encodeEntryPath(path) {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function entryUrl(target, path) {
  const url = new URL(`${target.origin}${target.basePath}${encodeEntryPath(path)}`);
  if (url.origin !== target.origin || !url.pathname.startsWith(target.basePath)) throw new Error("declared entry URL escaped the deployment base");
  validateEncodedPath(url.pathname);
  return url;
}

function relativeRequestPath(url, target) {
  if (url.pathname === target.basePath) return "/";
  return url.pathname.startsWith(target.basePath) ? url.pathname.slice(target.basePath.length) : null;
}

function safeMime(response) {
  const raw = response?.headers?.get?.("content-type");
  if (typeof raw !== "string") return null;
  const mediaType = raw.split(";", 1)[0].trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mediaType) ? mediaType : "invalid";
}

function redirectTarget(location, current, target) {
  if (typeof location !== "string" || !location || location.length > 2_048) return { allowed: false, reason: "redirect-location-invalid", url: null };
  let next;
  try { next = new URL(location, current); } catch (_) { return { allowed: false, reason: "redirect-location-invalid", url: null }; }
  if (next.username || next.password) return { allowed: false, reason: "redirect-credentials-blocked", url: null };
  if (next.search || next.hash) return { allowed: false, reason: "redirect-query-or-fragment-blocked", url: null };
  if (next.origin !== target.origin) return { allowed: false, reason: "redirect-left-origin", url: null };
  try { validateEncodedPath(next.pathname); } catch (_) { return { allowed: false, reason: "redirect-path-invalid", url: null }; }
  if (!next.pathname.startsWith(target.basePath)) return { allowed: false, reason: "redirect-left-base-path", url: null };
  return { allowed: true, reason: null, url: next };
}

function retryableStatus(status) {
  return RETRYABLE_STATUSES.has(status) || (status >= 500 && status <= 599);
}

async function discardBody(response) {
  try { await response?.body?.cancel?.(); } catch (_) {}
}

function timeoutError() {
  const error = new Error("deployment request timed out");
  error.name = "TimeoutError";
  return error;
}

function requestDeadline(timeoutMs, signal) {
  const controller = new AbortController();
  let rejectStop;
  const stopped = new Promise((_, reject) => { rejectStop = reject; });
  const abort = () => {
    controller.abort();
    rejectStop(Object.assign(new Error("deployment verification aborted"), { name: "AbortError" }));
  };
  if (signal?.aborted) abort();
  else signal?.addEventListener?.("abort", abort, { once: true });
  const timer = setTimeout(() => {
    controller.abort();
    rejectStop(timeoutError());
  }, timeoutMs);
  return {
    signal: controller.signal,
    race: (promise) => Promise.race([Promise.resolve(promise), stopped]),
    cancel() { controller.abort(); },
    close() {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", abort);
    },
  };
}

async function responseDigest(response, perResponseLimit, budget, signal = null) {
  const declared = response?.headers?.get?.("content-length");
  if (declared !== null && declared !== undefined && declared !== "") {
    const parsed = Number(declared);
    if (Number.isFinite(parsed) && parsed > perResponseLimit) throw new CoverageLimitError("response-size-limit");
  }
  const hash = createHash("sha256");
  let size = 0;
  const consume = (value) => {
    if (signal?.aborted) throw timeoutError();
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    size += bytes.byteLength;
    budget.used += bytes.byteLength;
    if (size > perResponseLimit) throw new CoverageLimitError("response-size-limit");
    if (budget.used > budget.max) throw new CoverageLimitError("total-response-bytes-limit");
    hash.update(bytes);
  };
  if (response?.body?.getReader) {
    const reader = response.body.getReader();
    try {
      while (true) {
        if (signal?.aborted) throw timeoutError();
        const { done, value } = await reader.read();
        if (done) break;
        consume(value);
      }
    } catch (error) {
      await reader.cancel(error).catch(() => {});
      throw error;
    }
  } else if (typeof response?.arrayBuffer === "function") {
    consume(new Uint8Array(await response.arrayBuffer()));
  } else throw new Error("deployment response body is unreadable");
  return { size, sha256: hash.digest("hex") };
}

async function probeOnce({ url, expected, target, fetchImpl, limits, budget, signal, deadline, now }) {
  let current = new URL(url);
  const visited = new Set();
  const redirects = [];
  for (let step = 0; ; step += 1) {
    const currentKey = current.toString();
    if (visited.has(currentKey)) return { outcome: "broken", reason: "redirect-loop", status: null, mime: null, actual: null, finalPath: relativeRequestPath(current, target), redirects, retryable: false };
    visited.add(currentKey);
    const remaining = deadline - now();
    if (remaining <= 0) return { outcome: "unverified", reason: "global-time-limit", status: null, mime: null, actual: null, finalPath: relativeRequestPath(current, target), redirects, retryable: false };
    const timer = requestDeadline(Math.min(limits.requestTimeoutMs, remaining), signal);
    let response;
    try {
      response = await timer.race(fetchImpl(current.toString(), {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: { accept: "*/*" },
        signal: timer.signal,
      }));
    } catch (error) {
      timer.close();
      const reason = error?.name === "TimeoutError" ? (now() >= deadline ? "global-time-limit" : "request-timeout") : error?.name === "AbortError" && signal?.aborted ? "verification-aborted" : "network-error";
      return { outcome: "unverified", reason, status: null, mime: null, actual: null, finalPath: relativeRequestPath(current, target), redirects, retryable: reason !== "verification-aborted" };
    }
    try {
      if (!response || !Number.isInteger(response.status)) {
        return { outcome: "unverified", reason: "invalid-fetch-response", status: null, mime: null, actual: null, finalPath: relativeRequestPath(current, target), redirects, retryable: true };
      }
      if (REDIRECT_STATUSES.has(response.status)) {
        const fromPath = relativeRequestPath(current, target);
        if (step >= limits.maxRedirects) {
          timer.cancel();
          void discardBody(response);
          redirects.push({ status: response.status, fromPath, toPath: null, decision: "blocked-limit" });
          return { outcome: "broken", reason: "redirect-limit", status: response.status, mime: safeMime(response), actual: null, finalPath: fromPath, redirects, retryable: false };
        }
        const decision = redirectTarget(response.headers?.get?.("location"), current, target);
        timer.cancel();
        void discardBody(response);
        if (!decision.allowed) {
          redirects.push({ status: response.status, fromPath, toPath: null, decision: decision.reason });
          return { outcome: "broken", reason: decision.reason, status: response.status, mime: safeMime(response), actual: null, finalPath: fromPath, redirects, retryable: false };
        }
        const toPath = relativeRequestPath(decision.url, target);
        redirects.push({ status: response.status, fromPath, toPath, decision: "followed" });
        current = decision.url;
        continue;
      }
      const mime = safeMime(response);
      const finalPath = relativeRequestPath(current, target);
      if (response.status !== 200) {
        timer.cancel();
        void discardBody(response);
        return { outcome: "broken", reason: "http-status", status: response.status, mime, actual: null, finalPath, redirects, retryable: retryableStatus(response.status) };
      }
      let actual;
      try { actual = await timer.race(responseDigest(response, limits.maxResponseBytes, budget, timer.signal)); }
      catch (error) {
        timer.cancel();
        void discardBody(response);
        if (error instanceof CoverageLimitError) return { outcome: "unverified", reason: error.code, status: response.status, mime, actual: null, finalPath, redirects, retryable: false };
        const reason = error?.name === "TimeoutError" ? (now() >= deadline ? "global-time-limit" : "request-timeout") : error?.name === "AbortError" && signal?.aborted ? "verification-aborted" : "response-read-error";
        return { outcome: "unverified", reason, status: response.status, mime, actual: null, finalPath, redirects, retryable: !new Set(["verification-aborted", "global-time-limit"]).has(reason) };
      }
      const exact = actual.size === expected.size && actual.sha256 === expected.sha256;
      return { outcome: exact ? "exact" : "transformed", reason: exact ? null : "response-bytes-differ", status: response.status, mime, actual, finalPath, redirects, retryable: !exact };
    } finally {
      timer.close();
    }
  }
}

async function probeWithRetry(input, { sleep, limits, deadline, now }) {
  let last;
  for (let attempt = 1; attempt <= limits.maxAttempts; attempt += 1) {
    if (now() >= deadline) return { outcome: "unverified", reason: "global-time-limit", status: null, mime: null, actual: null, finalPath: null, redirects: [], retryable: false, attempts: attempt - 1 };
    last = await probeOnce({ ...input, deadline, now });
    if (!last.retryable || attempt === limits.maxAttempts) return { ...last, attempts: attempt };
    if (now() + limits.retryDelayMs >= deadline) return { ...last, outcome: "unverified", reason: "global-time-limit", retryable: false, attempts: attempt };
    try {
      await sleep(limits.retryDelayMs);
    } catch (_) {
      return { ...last, outcome: "unverified", reason: "retry-delay-failed", retryable: false, attempts: attempt };
    }
  }
  return { ...last, attempts: limits.maxAttempts };
}

function preflightCoverage(identity, limits) {
  const reasons = [];
  if (identity.entries.length > limits.maxEntries) reasons.push("entry-count-limit");
  let expectedBytes = 0;
  for (const entry of identity.entries) {
    expectedBytes += entry.size;
    if (entry.size > limits.maxEntryBytes) reasons.push("entry-size-limit");
    if (entry.path !== ".nojekyll" && entry.size > limits.maxResponseBytes) reasons.push("response-size-limit");
    if (encoder.encode(entry.path).byteLength > limits.maxPathBytes) reasons.push("path-bytes-limit");
    if (entry.path.length > limits.maxPathCharacters) reasons.push("path-characters-limit");
  }
  if (expectedBytes > limits.maxExpectedBytes) reasons.push("expected-bytes-limit");
  return { expectedBytes, reasons: [...new Set(reasons)].sort(compareText) };
}

function emptyResult({ identity, target, limits, reason, preflight }) {
  const entries = identity.entries.map((entry) => entry.path === ".nojekyll"
    ? { path: entry.path, expected: { size: entry.size, sha256: entry.sha256 }, outcome: "skipped", reason: "platform-marker", attempts: 0, status: null, mime: null, actual: null, finalPath: null, redirects: [] }
    : { path: entry.path, expected: { size: entry.size, sha256: entry.sha256 }, outcome: "unverified", reason, attempts: 0, status: null, mime: null, actual: null, finalPath: null, redirects: [] });
  const checks = entries.filter((entry) => entry.outcome !== "skipped");
  const reasons = [...new Set([reason, ...preflight.reasons])].sort(compareText);
  return normalizedResult({
    identity, target, limits, preflight, entries,
    baseProbe: { path: "/", expectedEntry: identity.entrypoint, expected: null, outcome: "unverified", reason, attempts: 0, status: null, mime: null, actual: null, finalPath: null, redirects: [] },
    budgetUsed: 0,
    forcedReasons: reasons,
    expectedChecks: checks.length + 1,
  });
}

function normalizedResult({ identity, target, limits, preflight, baseProbe, entries, budgetUsed, forcedReasons = [], expectedChecks = null }) {
  const checks = [baseProbe, ...entries.filter((entry) => entry.outcome !== "skipped")];
  const counts = { exact: 0, transformed: 0, broken: 0, unverified: 0, skipped: entries.filter((entry) => entry.outcome === "skipped").length };
  for (const check of checks) if (Object.hasOwn(counts, check.outcome)) counts[check.outcome] += 1;
  const status = counts.unverified ? "unverified" : counts.broken ? "broken" : counts.transformed ? "transformed-review" : "exact-match";
  const reasons = [...new Set([
    ...forcedReasons,
    ...checks.map((check) => check.reason).filter(Boolean),
  ])].sort(compareText);
  const redirects = checks.reduce((sum, check) => sum + check.redirects.length, 0);
  const attempts = checks.reduce((sum, check) => sum + check.attempts, 0);
  const complete = counts.unverified === 0 && forcedReasons.length === 0;
  return {
    schemaVersion: "1",
    kind: "html-note-deployment-http-verification",
    status,
    target: { ...target },
    identity: {
      publishStatus: identity.status,
      archiveSha256: identity.archive.sha256,
      archiveBytes: identity.archive.bytes,
      manifestId: identity.manifest.manifestId,
      deployContentId: identity.manifest.deployContentId,
      browserProofId: identity.browserProofId,
      entrypoint: identity.entrypoint,
    },
    policy: {
      methods: ["GET"],
      sameOriginOnly: true,
      basePathOnly: true,
      credentials: "omit",
      redirects: "manual-bounded",
      responseBodiesRetained: false,
      ...limits,
    },
    summary: {
      declaredEntries: identity.entries.length,
      servableEntries: entries.length - counts.skipped,
      expectedChecks: expectedChecks ?? checks.length,
      completedChecks: counts.exact + counts.transformed + counts.broken,
      exact: counts.exact,
      transformed: counts.transformed,
      broken: counts.broken,
      unverified: counts.unverified,
      skipped: counts.skipped,
      redirects,
      attempts,
      declaredBytes: preflight.expectedBytes,
      decodedResponseBytes: budgetUsed,
    },
    coverage: { complete, ceilingExceeded: preflight.reasons.length > 0, reasons },
    baseProbe,
    entries,
  };
}

/**
 * Verify that a previously validated publish-ready capsule is reachable at one
 * exact HTTP(S) origin/base path. This function never writes files or retains
 * response bodies.
 */
export async function verifyNoteDeployment({
  baseUrl,
  allowRemote = false,
  identity: suppliedIdentity,
  limits: configured = {},
  fetchImpl = globalThis.fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = () => Date.now(),
  signal = null,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("deployment verification requires fetch");
  if (typeof sleep !== "function") throw new TypeError("deployment verification sleep adapter must be a function");
  if (typeof now !== "function") throw new TypeError("deployment verification clock must be a function");
  const limits = configuredLimits(configured);
  const identity = normalizedIdentity(suppliedIdentity);
  const target = validateNoteDeploymentBaseUrl(baseUrl, { allowRemote });
  const preflight = preflightCoverage(identity, limits);
  if (!target.authorized) return emptyResult({ identity, target, limits, reason: "remote-authorization-required", preflight });
  if (preflight.reasons.length) return emptyResult({ identity, target, limits, reason: "coverage-ceiling", preflight });

  const index = identity.entries.find((entry) => entry.path === identity.entrypoint);
  const budget = { used: 0, max: limits.maxTotalResponseBytes };
  const common = { target, fetchImpl, limits, budget, signal };
  const deadline = now() + limits.maxRunTimeMs;
  const baseProbe = {
    path: "/",
    expectedEntry: identity.entrypoint,
    expected: { size: index.size, sha256: index.sha256 },
    ...await probeWithRetry({ ...common, url: new URL(target.baseUrl), expected: index }, { sleep, limits, deadline, now }),
  };
  const entries = [];
  let stoppedReason = ["total-response-bytes-limit", "verification-aborted", "global-time-limit"].includes(baseProbe.reason) ? baseProbe.reason : null;
  for (const entry of identity.entries) {
    if (entry.path === ".nojekyll") {
      entries.push({ path: entry.path, expected: { size: entry.size, sha256: entry.sha256 }, outcome: "skipped", reason: "platform-marker", attempts: 0, status: null, mime: null, actual: null, finalPath: null, redirects: [] });
      continue;
    }
    if (stoppedReason) {
      entries.push({ path: entry.path, expected: { size: entry.size, sha256: entry.sha256 }, outcome: "unverified", reason: stoppedReason, attempts: 0, status: null, mime: null, actual: null, finalPath: null, redirects: [] });
      continue;
    }
    const checked = await probeWithRetry({ ...common, url: entryUrl(target, entry.path), expected: entry }, { sleep, limits, deadline, now });
    entries.push({ path: entry.path, expected: { size: entry.size, sha256: entry.sha256 }, ...checked });
    if (["total-response-bytes-limit", "verification-aborted", "global-time-limit"].includes(checked.reason)) stoppedReason = checked.reason;
  }
  return normalizedResult({ identity, target, limits, preflight, baseProbe, entries, budgetUsed: budget.used });
}

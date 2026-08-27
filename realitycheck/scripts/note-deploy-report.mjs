import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { TOOL_VERSION } from "./version.mjs";

export const NOTE_DEPLOY_STATUSES = Object.freeze([
  "live-match",
  "live-transformed-review",
  "live-broken",
  "unverified",
]);

export const NOTE_DEPLOY_FILE_ROLES = Object.freeze([
  "entry-html",
  "html",
  "stylesheet",
  "image",
  "font",
  "media",
  "document",
  "data",
  "platform-marker",
  "public-proof",
  "other",
]);

export const NOTE_DEPLOY_MIME_KINDS = Object.freeze([
  "html",
  "css",
  "image",
  "font",
  "media",
  "document",
  "data",
  "binary",
  "other",
]);

export const NOTE_DEPLOY_FILE_REASON_CODES = Object.freeze([
  "content-transformed",
  "http-error",
  "verification-limit",
  "request-blocked-by-policy",
  "request-failed",
  "redirect-outside-target",
  "redirect-policy-blocked",
  "unsupported-resource",
  "platform-marker",
]);

export const NOTE_DEPLOY_ARTIFACT_NAMES = Object.freeze({
  json: "deployment-receipt.json",
  markdown: "deployment-receipt.md",
  markdownZhCN: "deployment-receipt.zh-CN.md",
  html: "deployment-receipt.html",
});

const PROFILE = "passive-static-live-v1";
const SHA256_HEX = /^[a-f0-9]{64}$/;
const SHA256_ID = /^sha256:[a-f0-9]{64}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const MAX_FILES = 1_000;
const MAX_PATH_CHARACTERS = 500;
const MAX_EXPECTED_FILE_BYTES = 32 * 1024 * 1024;
const MAX_EXPECTED_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_FETCHED_FILE_BYTES = 32 * 1024 * 1024;
const MAX_FETCHED_TOTAL_BYTES = 192 * 1024 * 1024;
const MAX_ATTEMPTS = 10_000;
const MAX_REDIRECTS = 8;
const pathEncoder = new TextEncoder();
const FILE_STATES = new Set(["exact", "transformed", "missing", "skipped"]);
const FILE_ROLES = new Set(NOTE_DEPLOY_FILE_ROLES);
const MIME_KINDS = new Set(NOTE_DEPLOY_MIME_KINDS);
const FILE_REASON_CODES = new Set(NOTE_DEPLOY_FILE_REASON_CODES);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BROWSER_STATUSES = new Set(["passed", "failed", "incomplete"]);
const SCREENSHOT_SOURCES = new Set(["live-response-only", "diagnostic-with-capsule-fallback"]);
const TOP_LEVEL_REASON_CODES = new Set([
  "host-transformed-content",
  "live-resource-missing",
  "redirect-outside-target",
  "redirect-policy-blocked",
  "verification-coverage-incomplete",
  "verification-limit",
  "request-blocked-by-policy",
  "request-failed",
  "unsupported-resource",
  "browser-not-run",
  "browser-failed",
  "browser-incomplete",
  "target-not-https",
]);
const SUMMARY_KEYS = Object.freeze(["expected", "fetched", "matched", "transformed", "missing", "skipped"]);
const INPUT_KEYS = Object.freeze(["status", "source", "target", "verification", "summary", "files", "browser"]);
const RECEIPT_KEYS = Object.freeze([
  "schemaVersion",
  "toolVersion",
  "kind",
  "profile",
  "status",
  "source",
  "target",
  "verification",
  "summary",
  "files",
  "browser",
  "reasonCodes",
  "limitations",
  "receiptId",
]);

const LIMITATIONS = Object.freeze({
  pointInTimeOnly: true,
  publisherIdentityVerified: false,
  hostAccountOwnershipVerified: false,
  dnsOrTlsConfigurationCertified: false,
  responseBodiesStored: false,
  responseHeadersStored: false,
  cookiesStored: false,
  credentialsStored: false,
  factsOrCitationsVerified: false,
  malwareOrSecretsCertified: false,
  comprehensiveAccessibilityCertified: false,
  allBrowsersVerified: false,
  dynamicBehaviorVerified: false,
  deploymentPerformedByRealityCheck: false,
});

function limitationsFor(browser) {
  return {
    ...LIMITATIONS,
    browserScreenshotsStored: Boolean(browser?.proofId),
  };
}

const STATUS_COPY = Object.freeze({
  "live-match": {
    tone: "match",
    eyebrow: ["LIVE BYTES MATCH", "线上字节一致"],
    title: ["The complete live deployment matches the verified package", "完整线上部署与已验证文件包一致"],
    detail: [
      "Every expected file was fetched from the declared HTTPS base path, matched by size and SHA-256, and completed the bound passive-browser proof.",
      "已从声明的 HTTPS 基础路径获取每个期望文件，大小与 SHA-256 均一致，并完成已绑定的被动浏览器证明。",
    ],
  },
  "live-transformed-review": {
    tone: "review",
    eyebrow: ["LIVE · HOST TRANSFORMATION REVIEW", "线上可达 · 托管变换待复核"],
    title: ["The host changed one or more deployed bytes", "托管平台改变了一个或多个部署文件的字节"],
    detail: [
      "Coverage and browser proof completed, but the live response bytes differ from the verified package. Review CDN or host transformation before relying on the deployment.",
      "覆盖与浏览器证明已经完成，但线上响应字节与已验证文件包不同。依赖该部署前，请复核 CDN 或托管平台的变换。",
    ],
  },
  "live-broken": {
    tone: "broken",
    eyebrow: ["LIVE DEPLOYMENT BROKEN", "线上部署存在故障"],
    title: ["The deployed site does not satisfy the verified package", "线上站点不满足已验证文件包"],
    detail: [
      "A missing live resource, an out-of-bound redirect, or failed browser evidence directly contradicts a healthy deployment claim.",
      "线上资源缺失、跳转越界或浏览器证明失败，直接否定了部署正常的结论。",
    ],
  },
  unverified: {
    tone: "unverified",
    eyebrow: ["LIVE STATE UNVERIFIED", "线上状态未验证"],
    title: ["Evidence is incomplete; do not treat this as a deployment pass", "证据不完整；请勿视为部署通过"],
    detail: [
      "Some expected scope or required browser evidence was not completed. Existing matches are retained as observations, not promoted to a green result.",
      "部分期望范围或必需浏览器证据尚未完成。已有一致结果仅作为观测保留，不会被提升为绿色结论。",
    ],
  },
});

const STATE_COPY = Object.freeze({
  exact: ["Exact", "一致"],
  transformed: ["Transformed", "已变换"],
  missing: ["Missing", "缺失"],
  skipped: ["Skipped", "未核验"],
});

const SUMMARY_COPY = Object.freeze({
  expected: ["Expected", "期望"],
  fetched: ["Fetched", "已获取"],
  matched: ["Matched", "一致"],
  transformed: ["Transformed", "已变换"],
  missing: ["Missing", "缺失"],
  skipped: ["Skipped", "未核验"],
});

const BROWSER_STATUS_COPY = Object.freeze({
  passed: ["passed", "通过"],
  failed: ["failed", "失败"],
  incomplete: ["incomplete", "未完成"],
});

const REASON_COPY = Object.freeze({
  "host-transformed-content": ["The live host returned bytes different from the verified package.", "线上托管返回的字节与已验证文件包不同。"],
  "live-resource-missing": ["At least one expected live resource returned an HTTP error.", "至少一个期望线上资源返回 HTTP 错误。"],
  "redirect-outside-target": ["A redirect left the declared origin or base path and was not followed.", "跳转离开了声明的来源或基础路径，因此未继续跟随。"],
  "redirect-policy-blocked": ["A redirect was blocked by the bounded loop, location, or redirect-count policy.", "跳转被有界循环、位置或跳转次数策略阻止。"],
  "verification-coverage-incomplete": ["The expected deployment scope was not completely verified.", "期望部署范围未完成全部验证。"],
  "verification-limit": ["A bounded verification limit was reached.", "已达到有界验证限制。"],
  "request-blocked-by-policy": ["The live request was not authorized by the declared verification policy.", "线上请求未获得声明验证策略的授权。"],
  "request-failed": ["A request failed before a trustworthy live response was recorded.", "请求在记录可信线上响应前失败。"],
  "unsupported-resource": ["A resource could not be verified by the declared passive-static method.", "某个资源无法通过声明的被动静态方法验证。"],
  "browser-not-run": ["The required live passive-browser proof was not run.", "尚未运行必需的线上被动浏览器证明。"],
  "browser-failed": ["The bound live passive-browser proof failed.", "已绑定的线上被动浏览器证明失败。"],
  "browser-incomplete": ["The live passive-browser proof did not complete every scenario.", "线上被动浏览器证明未完成全部场景。"],
  "target-not-https": ["The target does not use HTTPS, so it cannot receive a verified public live-deployment decision.", "目标未使用 HTTPS，因此不能获得已验证的公开线上部署结论。"],
});

const LIMITATION_COPY = Object.freeze([
  ["This receipt is a point-in-time observation; the live host can change immediately afterward.", "本回执仅代表某一时间点的观测；线上托管内容随后即可变化。"],
  ["It does not verify publisher identity, account ownership, DNS, TLS configuration, or continued availability.", "它不验证发布者身份、账户所有权、DNS、TLS 配置或持续可用性。"],
  ["It stores no response body, raw response header, cookie, credential, or authorization value.", "它不存储响应正文、原始响应头、Cookie、凭据或授权值。"],
  ["It does not certify facts, citations, copyright, malware or secret absence, comprehensive accessibility, every browser, or dynamic behavior.", "它不认证事实、引用、版权、恶意软件或秘密缺失、完整可访问性、所有浏览器或动态行为。"],
  ["RealityCheck records the verification result; it does not perform or approve the deployment.", "RealityCheck 只记录验证结果，不执行或批准部署。"],
]);

function screenshotLimitationCopy(receipt) {
  if (!receipt.limitations.browserScreenshotsStored) {
    return ["No browser screenshot is bound because no completed browser proof is attached.", "由于未附加已完成的浏览器证明，因此没有绑定浏览器截图。"];
  }
  if (receipt.browser.screenshotSource === "diagnostic-with-capsule-fallback") {
    return [
      "Two local diagnostic screenshots are retained beside the browser proof. At least one capture scenario used verified-capsule fallback bytes after a live response could not be fully reverified, so it is not evidence of a fully live-response-only render; this receipt does not embed the images.",
      "浏览器证明旁会保留两张本地诊断截图。由于至少一个线上响应未能完成复核，其中至少一个截图场景使用了已验证 capsule 的回放字节，因此不能作为完全仅由线上响应渲染的证明；本回执不嵌入图片。",
    ];
  }
  return [
    "Two local diagnostic screenshots rendered only from reverified target responses are retained beside the browser proof; this receipt does not embed them.",
    "浏览器证明旁会保留两张仅由已复核目标响应渲染的本地诊断截图；本回执本身不嵌入图片。",
  ];
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new TypeError(`${label} contains missing or unsupported fields`);
}

function boundedInteger(value, label, maximum, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new TypeError(`${label} must be an integer from ${minimum} to ${maximum}`);
  return value;
}

function sha256Hex(value, label) {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) throw new TypeError(`${label} must be a 64-character lowercase SHA-256 hex value`);
  return value;
}

function sha256Id(value, label, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !SHA256_ID.test(value)) throw new TypeError(`${label} must be a lowercase sha256: identifier`);
  return value;
}

function canonicalTimestamp(value, label) {
  if (typeof value !== "string") throw new TypeError(`${label} must be a canonical ISO-8601 timestamp`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) throw new TypeError(`${label} must be a canonical ISO-8601 timestamp`);
  return value;
}

function canonicalOrigin(value) {
  if (typeof value !== "string" || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError("target.origin must be a bounded HTTP(S) origin");
  let parsed;
  try { parsed = new URL(value); } catch (_) { throw new TypeError("target.origin must be a canonical HTTP(S) origin"); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash || value !== parsed.origin) {
    throw new TypeError("target.origin must contain only a canonical HTTP(S) origin without credentials, path, query, or fragment");
  }
  return value;
}

function canonicalBasePath(value, origin) {
  if (typeof value !== "string" || !value.startsWith("/") || !value.endsWith("/") || value.length > MAX_PATH_CHARACTERS
    || /[\\?#\u0000-\u001f\u007f]/.test(value) || value.includes("//")) {
    throw new TypeError("target.basePath must be a bounded canonical absolute pathname ending in /");
  }
  let parsed;
  try { parsed = new URL(value, origin); } catch (_) { throw new TypeError("target.basePath must be a canonical URL pathname"); }
  if (parsed.origin !== origin || parsed.pathname !== value || parsed.search || parsed.hash) throw new TypeError("target.basePath must not escape or normalize away from the declared origin");
  const segments = value.split("/").filter(Boolean);
  if (segments.some((part) => part === "." || part === ".." || /%(?:00|2f|5c)/i.test(part))) throw new TypeError("target.basePath contains an unsafe path segment");
  return value;
}

function portablePath(value, label) {
  if (typeof value !== "string" || !value || value.length > MAX_PATH_CHARACTERS || value.startsWith("/") || /^[a-z]:/i.test(value)
    || value.includes("\\") || /[<>:"|?*\p{Cc}\p{Cf}]/u.test(value)) throw new TypeError(`${label} must be a bounded cross-platform relative path`);
  if (pathEncoder.encode(value).byteLength > 1024) throw new TypeError(`${label} exceeds the 1024-byte UTF-8 path boundary`);
  const segments = value.split("/");
  if (segments.some((part) => !part || part === "." || part === ".." || /[. ]$/.test(part)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new TypeError(`${label} contains an unsafe or non-portable segment`);
  return value.normalize("NFC");
}

function normalizedSource(value) {
  exactKeys(value, ["archiveSha256", "archiveBytes", "deployContentId", "publishManifestId", "finalArchiveBrowserProofId"], "source");
  return {
    archiveSha256: sha256Hex(value.archiveSha256, "source.archiveSha256"),
    archiveBytes: boundedInteger(value.archiveBytes, "source.archiveBytes", 64 * 1024 * 1024, 1),
    deployContentId: sha256Id(value.deployContentId, "source.deployContentId"),
    publishManifestId: sha256Id(value.publishManifestId, "source.publishManifestId"),
    finalArchiveBrowserProofId: sha256Id(value.finalArchiveBrowserProofId, "source.finalArchiveBrowserProofId"),
  };
}

function normalizedTarget(value) {
  exactKeys(value, ["origin", "basePath"], "target");
  const origin = canonicalOrigin(value.origin);
  return { origin, basePath: canonicalBasePath(value.basePath, origin) };
}

function normalizedRedirect(value, label) {
  exactKeys(value, ["status", "toOriginSame", "toBasePathSame"], label);
  if (!REDIRECT_STATUSES.has(value.status)) throw new TypeError(`${label}.status is not a supported redirect status`);
  if (typeof value.toOriginSame !== "boolean" || typeof value.toBasePathSame !== "boolean") throw new TypeError(`${label} redirect boundaries must be booleans`);
  if (!value.toOriginSame && value.toBasePathSame) throw new Error(`${label}.toBasePathSame cannot be true after leaving the target origin`);
  return { status: value.status, toOriginSame: value.toOriginSame, toBasePathSame: value.toBasePathSame };
}

function normalizedFile(value, index) {
  const label = `files[${index}]`;
  exactKeys(value, ["path", "role", "expectedSha256", "expectedBytes", "actualSha256", "actualBytes", "httpStatus", "mimeKind", "attempts", "redirects", "state", "reasonCode"], label);
  const path = portablePath(value.path, `${label}.path`);
  if (!FILE_ROLES.has(value.role)) throw new TypeError(`${label}.role is unsupported`);
  const publicProofPath = path.startsWith("realitycheck-proof/");
  if (publicProofPath !== (value.role === "public-proof")) throw new Error(`${label} public-proof role must exactly match the reserved realitycheck-proof/ subtree`);
  const platformMarkerPath = path === ".nojekyll";
  if (platformMarkerPath !== (value.role === "platform-marker")) throw new Error(`${label} platform-marker role is reserved for the root .nojekyll file`);
  const expectedSha256 = sha256Hex(value.expectedSha256, `${label}.expectedSha256`);
  const expectedBytes = boundedInteger(value.expectedBytes, `${label}.expectedBytes`, MAX_EXPECTED_FILE_BYTES);
  if (!FILE_STATES.has(value.state)) throw new TypeError(`${label}.state is unsupported`);
  if (value.reasonCode !== null && !FILE_REASON_CODES.has(value.reasonCode)) throw new TypeError(`${label}.reasonCode is unsupported`);
  const actualSha256 = value.actualSha256 === null ? null : sha256Hex(value.actualSha256, `${label}.actualSha256`);
  const actualBytes = value.actualBytes === null ? null : boundedInteger(value.actualBytes, `${label}.actualBytes`, MAX_FETCHED_FILE_BYTES);
  const httpStatus = value.httpStatus === null ? null : boundedInteger(value.httpStatus, `${label}.httpStatus`, 599, 100);
  const mimeKind = value.mimeKind === null ? null : value.mimeKind;
  if (mimeKind !== null && !MIME_KINDS.has(mimeKind)) throw new TypeError(`${label}.mimeKind is unsupported`);
  const attempts = boundedInteger(value.attempts, `${label}.attempts`, 10);
  if (!Array.isArray(value.redirects) || value.redirects.length > MAX_REDIRECTS) throw new TypeError(`${label}.redirects must be a bounded array`);
  const redirects = value.redirects.map((item, redirectIndex) => normalizedRedirect(item, `${label}.redirects[${redirectIndex}]`));
  const escapedTarget = redirects.some((item) => !item.toOriginSame || !item.toBasePathSame);

  if (value.state === "exact") {
    if (value.reasonCode !== null || actualSha256 !== expectedSha256 || actualBytes !== expectedBytes || httpStatus !== 200 || attempts < 1 || escapedTarget) {
      throw new Error(`${label} exact state contradicts its hash, size, response, redirect, or reason evidence`);
    }
  } else if (value.state === "transformed") {
    if (value.reasonCode !== "content-transformed" || actualSha256 === null || actualBytes === null || (actualSha256 === expectedSha256 && actualBytes === expectedBytes)
      || httpStatus !== 200 || attempts < 1 || escapedTarget) {
      throw new Error(`${label} transformed state requires a successful, in-bound response with changed bytes`);
    }
  } else if (value.state === "missing") {
    if (value.reasonCode !== "http-error" || actualSha256 !== null || actualBytes !== null || httpStatus === null || httpStatus === 200 || attempts < 1 || escapedTarget) {
      throw new Error(`${label} missing state requires a final in-bound HTTP error without retained response bytes`);
    }
  } else {
    if (!["verification-limit", "request-blocked-by-policy", "request-failed", "redirect-outside-target", "redirect-policy-blocked", "unsupported-resource", "platform-marker"].includes(value.reasonCode)
      || actualSha256 !== null || actualBytes !== null) {
      throw new Error(`${label} skipped state requires a controlled reason and no claimed live response bytes`);
    }
    if (value.reasonCode === "redirect-outside-target" && (!escapedTarget || attempts < 1 || (httpStatus !== null && !REDIRECT_STATUSES.has(httpStatus)))) throw new Error(`${label} redirect-outside-target reason requires a recorded out-of-bound redirect`);
    if (value.reasonCode === "redirect-policy-blocked" && (!redirects.length || attempts < 1 || escapedTarget || (httpStatus !== null && !REDIRECT_STATUSES.has(httpStatus)))) throw new Error(`${label} redirect-policy-blocked reason requires an in-bound recorded redirect`);
    if (!["redirect-outside-target"].includes(value.reasonCode) && escapedTarget) throw new Error(`${label} out-of-bound redirect requires redirect-outside-target reason`);
    if (["request-blocked-by-policy", "unsupported-resource", "platform-marker"].includes(value.reasonCode) && (attempts !== 0 || httpStatus !== null || mimeKind !== null)) throw new Error(`${label} pre-request skip reasons require zero attempts and no response facts`);
    if (value.reasonCode === "verification-limit" && httpStatus !== null && attempts < 1) throw new Error(`${label} post-response verification limit requires an attempt`);
    if (value.reasonCode === "platform-marker" && (value.role !== "platform-marker" || redirects.length)) throw new Error(`${label} platform-marker skip requires the controlled role and no request evidence`);
    if (value.reasonCode === "request-failed" && attempts < 1) throw new Error(`${label} request-failed reason requires at least one attempt`);
    if (httpStatus === null && mimeKind !== null) throw new Error(`${label} cannot retain a MIME kind without an HTTP response status`);
  }
  return { path, role: value.role, expectedSha256, expectedBytes, actualSha256, actualBytes, httpStatus, mimeKind, attempts, redirects, state: value.state, reasonCode: value.reasonCode };
}

function normalizedFiles(value) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_FILES) throw new TypeError(`files must contain 1 to ${MAX_FILES} entries`);
  const files = value.map(normalizedFile);
  const exact = new Set();
  const normalized = new Set();
  const folded = new Set();
  for (const file of files) {
    const nfc = file.path.normalize("NFC");
    const lower = nfc.toLowerCase();
    if (exact.has(file.path)) throw new Error(`files contains duplicate path: ${file.path}`);
    if (normalized.has(nfc) || folded.has(lower)) throw new Error(`files contains a Unicode-normalized or case-folded path collision: ${file.path}`);
    exact.add(file.path);
    normalized.add(nfc);
    folded.add(lower);
  }
  const entries = files.filter((file) => file.role === "entry-html");
  if (entries.length !== 1 || entries[0].path !== "index.html") throw new Error("files must contain exactly one entry-html role at index.html");
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return files;
}

function derivedSummary(files) {
  const partition = (state) => files.filter((file) => file.state === state);
  const expectedBytes = (items) => items.reduce((sum, file) => sum + file.expectedBytes, 0);
  const fetched = files.filter((file) => file.state === "exact" || file.state === "transformed");
  const summary = {
    expected: { files: files.length, bytes: expectedBytes(files) },
    fetched: { files: fetched.length, bytes: fetched.reduce((sum, file) => sum + file.actualBytes, 0) },
    matched: { files: partition("exact").length, bytes: expectedBytes(partition("exact")) },
    transformed: { files: partition("transformed").length, bytes: expectedBytes(partition("transformed")) },
    missing: { files: partition("missing").length, bytes: expectedBytes(partition("missing")) },
    skipped: { files: partition("skipped").length, bytes: expectedBytes(partition("skipped")) },
  };
  if (summary.expected.bytes > MAX_EXPECTED_TOTAL_BYTES) throw new Error(`expected deployment scope exceeds ${MAX_EXPECTED_TOTAL_BYTES} bytes`);
  if (summary.fetched.bytes > MAX_FETCHED_TOTAL_BYTES) throw new Error(`fetched deployment scope exceeds ${MAX_FETCHED_TOTAL_BYTES} bytes`);
  return summary;
}

function normalizedSummary(value, files) {
  exactKeys(value, SUMMARY_KEYS, "summary");
  const summary = Object.fromEntries(SUMMARY_KEYS.map((key) => {
    exactKeys(value[key], ["files", "bytes"], `summary.${key}`);
    return [key, {
      files: boundedInteger(value[key].files, `summary.${key}.files`, MAX_FILES),
      bytes: boundedInteger(value[key].bytes, `summary.${key}.bytes`, MAX_FETCHED_TOTAL_BYTES),
    }];
  }));
  const expected = derivedSummary(files);
  if (!isDeepStrictEqual(summary, expected)) throw new Error("summary counts or bytes do not bind the per-path evidence");
  return summary;
}

function computeDeployContentId(files) {
  const contract = {
    contract: "realitycheck-publish-deploy-content-v1",
    entrypoint: "index.html",
    entries: files.filter((file) => file.role !== "public-proof").map((file) => ({ path: file.path, size: file.expectedBytes, sha256: file.expectedSha256 })),
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(contract), "utf8").digest("hex")}`;
}

function normalizedVerification(value, files) {
  exactKeys(value, ["startedAt", "verifiedAt", "attempts", "coverageComplete"], "verification");
  const startedAt = canonicalTimestamp(value.startedAt, "verification.startedAt");
  const verifiedAt = canonicalTimestamp(value.verifiedAt, "verification.verifiedAt");
  if (Date.parse(verifiedAt) < Date.parse(startedAt)) throw new Error("verification.verifiedAt cannot precede startedAt");
  const attempts = boundedInteger(value.attempts, "verification.attempts", MAX_ATTEMPTS);
  const expectedAttempts = files.reduce((sum, file) => sum + file.attempts, 0);
  if (attempts !== expectedAttempts) throw new Error("verification.attempts does not bind the per-path attempt counts");
  if (typeof value.coverageComplete !== "boolean") throw new TypeError("verification.coverageComplete must be a boolean");
  const expectedComplete = files.every((file) => file.state !== "skipped" || file.reasonCode === "platform-marker");
  if (value.coverageComplete !== expectedComplete) throw new Error("verification.coverageComplete does not match skipped path evidence");
  return {
    startedAt,
    verifiedAt,
    attempts,
    coverageComplete: value.coverageComplete,
    freshness: {
      basis: "point-in-time-only",
      statementCode: "live-state-may-change-after-verification",
    },
  };
}

function normalizedBrowser(value) {
  if (value === null) return null;
  exactKeys(value, ["status", "scenarios", "screenshotSource", "proofId"], "browser");
  if (!BROWSER_STATUSES.has(value.status)) throw new TypeError("browser.status is unsupported");
  if (!SCREENSHOT_SOURCES.has(value.screenshotSource)) throw new TypeError("browser.screenshotSource is unsupported");
  exactKeys(value.scenarios, ["expected", "completed", "passed", "failed", "skipped"], "browser.scenarios");
  const scenarios = Object.fromEntries(Object.entries(value.scenarios).map(([key, count]) => [key, boundedInteger(count, `browser.scenarios.${key}`, 100)]));
  if (scenarios.expected < 1 || scenarios.completed !== scenarios.passed + scenarios.failed || scenarios.expected !== scenarios.completed + scenarios.skipped) {
    throw new Error("browser scenario counts are inconsistent");
  }
  const proofId = sha256Id(value.proofId, "browser.proofId", true);
  if (value.status === "passed" && (proofId === null || scenarios.passed !== scenarios.expected || scenarios.failed || scenarios.skipped)) {
    throw new Error("browser passed status requires a bound proof with every scenario passed");
  }
  if (value.status === "failed" && (proofId === null || scenarios.failed < 1)) throw new Error("browser failed status requires a bound proof with a failed scenario");
  if (value.status === "incomplete" && (proofId === null || scenarios.failed || !scenarios.skipped || scenarios.completed === scenarios.expected)) {
    throw new Error("browser incomplete status requires a bound proof with unfinished or skipped scenarios and no direct browser failure");
  }
  if (value.status === "passed" && value.screenshotSource !== "live-response-only") throw new Error("browser passed status cannot depend on capsule fallback screenshots");
  return { status: value.status, scenarios, screenshotSource: value.screenshotSource, proofId };
}

function derivedReasonCodes(files, verification, browser, target) {
  const reasons = new Set();
  for (const file of files) {
    if (file.state === "transformed") reasons.add("host-transformed-content");
    if (file.state === "missing") reasons.add("live-resource-missing");
    if (file.reasonCode === "redirect-outside-target") reasons.add("redirect-outside-target");
    if (file.reasonCode === "redirect-policy-blocked") reasons.add("redirect-policy-blocked");
    if (["verification-limit", "request-blocked-by-policy", "request-failed", "unsupported-resource"].includes(file.reasonCode)) reasons.add(file.reasonCode);
  }
  if (!verification.coverageComplete) reasons.add("verification-coverage-incomplete");
  if (browser === null) reasons.add("browser-not-run");
  else if (browser.status === "failed") reasons.add("browser-failed");
  else if (browser.status === "incomplete") reasons.add("browser-incomplete");
  if (!target.origin.startsWith("https://")) reasons.add("target-not-https");
  const ordered = [...reasons].sort();
  if (ordered.some((reason) => !TOP_LEVEL_REASON_CODES.has(reason))) throw new Error("derived an unsupported deployment reason code");
  return ordered;
}

function validateStatus(status, target, summary, verification, files, browser, reasonCodes) {
  if (!NOTE_DEPLOY_STATUSES.includes(status)) throw new TypeError(`status must be one of: ${NOTE_DEPLOY_STATUSES.join(", ")}`);
  const redirectBroken = reasonCodes.includes("redirect-outside-target") || reasonCodes.includes("redirect-policy-blocked");
  const browserFailed = browser?.status === "failed";
  const directBroken = summary.missing.files > 0 || redirectBroken || browserFailed;
  const secureTarget = target.origin.startsWith("https://");
  const proofIncomplete = !verification.coverageComplete || browser === null || browser?.status === "incomplete" || !secureTarget;
  const browserPassed = browser?.status === "passed";

  if (status === "live-match") {
    if (!secureTarget || directBroken || proofIncomplete || !browserPassed || summary.transformed.files || summary.missing.files
      || summary.matched.files + summary.skipped.files !== summary.expected.files || reasonCodes.length) {
      throw new Error("live-match contradicts coverage, HTTPS target, byte, redirect, browser, or reason evidence");
    }
  } else if (status === "live-transformed-review") {
    if (!secureTarget || directBroken || proofIncomplete || !browserPassed || summary.transformed.files < 1 || summary.missing.files
      || reasonCodes.some((reason) => reason !== "host-transformed-content")) {
      throw new Error("live-transformed-review requires complete HTTPS coverage, a passed browser proof, and only disclosed byte transformations");
    }
  } else if (status === "live-broken") {
    if (!directBroken) throw new Error("live-broken requires direct missing-resource, redirect-boundary, or failed-browser evidence");
  } else {
    if (directBroken || !proofIncomplete) throw new Error("unverified requires incomplete proof without direct live-broken evidence");
  }
  if (!files.length) throw new Error("deployment status requires at least one bound file");
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function normalizedInput(input, toolVersion = TOOL_VERSION) {
  exactKeys(input, INPUT_KEYS, "deployment receipt input");
  if (typeof toolVersion !== "string" || !SEMVER.test(toolVersion)) throw new TypeError("toolVersion must be semantic-version text");
  const source = normalizedSource(input.source);
  const target = normalizedTarget(input.target);
  const files = normalizedFiles(input.files);
  const calculatedContentId = computeDeployContentId(files);
  if (source.deployContentId !== calculatedContentId) throw new Error("source.deployContentId does not bind the expected per-path contract");
  const summary = normalizedSummary(input.summary, files);
  const verification = normalizedVerification(input.verification, files);
  const browser = normalizedBrowser(input.browser);
  const reasonCodes = derivedReasonCodes(files, verification, browser, target);
  validateStatus(input.status, target, summary, verification, files, browser, reasonCodes);
  return {
    schemaVersion: "1",
    toolVersion,
    kind: "html-note-deployment-receipt",
    profile: PROFILE,
    status: input.status,
    source,
    target,
    verification,
    summary,
    files,
    browser,
    reasonCodes,
    limitations: limitationsFor(browser),
  };
}

/** Build one canonical, privacy-bounded live deployment receipt. */
export function buildNoteDeploymentReceipt(input) {
  const contract = normalizedInput(input);
  return { ...contract, receiptId: digest(contract) };
}

/** Validate and normalize an already-persisted deployment receipt. */
export function validateNoteDeploymentReceipt(receipt) {
  exactKeys(receipt, RECEIPT_KEYS, "deployment receipt");
  if (receipt.schemaVersion !== "1" || receipt.kind !== "html-note-deployment-receipt" || receipt.profile !== PROFILE) throw new TypeError("deployment receipt identity fields are unsupported");
  exactKeys(receipt.verification, ["startedAt", "verifiedAt", "attempts", "coverageComplete", "freshness"], "verification");
  exactKeys(receipt.verification.freshness, ["basis", "statementCode"], "verification.freshness");
  if (receipt.verification.freshness.basis !== "point-in-time-only" || receipt.verification.freshness.statementCode !== "live-state-may-change-after-verification") {
    throw new Error("verification freshness wording is unsupported or altered");
  }
  exactKeys(receipt.limitations, [...Object.keys(LIMITATIONS), "browserScreenshotsStored"], "limitations");
  if (!isDeepStrictEqual(receipt.limitations, limitationsFor(receipt.browser))) throw new Error("deployment receipt limitations are unsupported or altered");
  if (!Array.isArray(receipt.reasonCodes) || new Set(receipt.reasonCodes).size !== receipt.reasonCodes.length
    || receipt.reasonCodes.some((reason) => !TOP_LEVEL_REASON_CODES.has(reason))) throw new TypeError("reasonCodes contains duplicate or unsupported values");
  const input = {
    status: receipt.status,
    source: receipt.source,
    target: receipt.target,
    verification: {
      startedAt: receipt.verification.startedAt,
      verifiedAt: receipt.verification.verifiedAt,
      attempts: receipt.verification.attempts,
      coverageComplete: receipt.verification.coverageComplete,
    },
    summary: receipt.summary,
    files: receipt.files,
    browser: receipt.browser,
  };
  const contract = normalizedInput(input, receipt.toolVersion);
  if (!isDeepStrictEqual(receipt.reasonCodes, contract.reasonCodes)) throw new Error("reasonCodes does not match the normalized deployment evidence");
  if (!isDeepStrictEqual({ ...receipt, receiptId: undefined }, { ...contract, receiptId: undefined })) throw new Error("deployment receipt contains altered or non-canonical fields");
  const expectedId = digest(contract);
  if (receipt.receiptId !== expectedId) throw new Error("receiptId does not bind the normalized deployment receipt");
  return { ...contract, receiptId: expectedId };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function escapeMarkdown(value) {
  return String(value ?? "").replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("`", "&#96;").replace(/[\r\n]+/g, " ");
}

function shortHash(value) {
  return value ? `${value.slice(0, 12)}…${value.slice(-8)}` : "—";
}

function localized([en, zhCN]) {
  return `<span class="i18n-en" lang="en">${escapeHtml(en)}</span><span class="i18n-zh" lang="zh-CN">${escapeHtml(zhCN)}</span>`;
}

function formatBytes(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function fileRow(file) {
  const redirects = file.redirects.length
    ? file.redirects.map((item) => `${item.status}:${item.toOriginSame ? "origin✓" : "origin×"}/${item.toBasePathSame ? "base✓" : "base×"}`).join(" · ")
    : "—";
  return `<tr data-state="${file.state}"><td><code title="${escapeHtml(file.path)}">${escapeHtml(file.path)}</code><small>${escapeHtml(file.role)}</small></td><td><b>${localized(STATE_COPY[file.state])}</b>${file.reasonCode ? `<small>${escapeHtml(file.reasonCode)}</small>` : ""}</td><td><code title="${file.expectedSha256}">${shortHash(file.expectedSha256)}</code><small>${formatBytes(file.expectedBytes)} B</small></td><td>${file.actualSha256 ? `<code title="${file.actualSha256}">${shortHash(file.actualSha256)}</code><small>${formatBytes(file.actualBytes)} B</small>` : "—"}</td><td>${file.httpStatus ?? "—"}<small>${escapeHtml(file.mimeKind || "—")}</small></td><td><small>${escapeHtml(redirects)}</small></td></tr>`;
}

/** Render deterministic, self-contained bilingual HTML from a validated receipt. */
export function renderNoteDeploymentReceiptHtml(inputReceipt) {
  const receipt = validateNoteDeploymentReceipt(inputReceipt);
  const copy = STATUS_COPY[receipt.status];
  const target = `${receipt.target.origin}${receipt.target.basePath}`;
  const reasons = receipt.reasonCodes.length
    ? `<ul>${receipt.reasonCodes.map((reason) => `<li><code>${reason}</code> ${localized(REASON_COPY[reason])}</li>`).join("")}</ul>`
    : `<p>${localized(["No exception or failure reason was recorded.", "未记录例外或失败原因。"])}</p>`;
  const browser = receipt.browser
    ? `${localized(["Browser", "浏览器"])}: <b>${localized(BROWSER_STATUS_COPY[receipt.browser.status])}</b> · ${receipt.browser.scenarios.passed}/${receipt.browser.scenarios.expected} ${localized(["scenarios passed", "个场景通过"])} · <code>${shortHash(receipt.browser.proofId)}</code>`
    : `${localized(["Browser proof was not run", "未运行浏览器证明"])}`;
  const rows = receipt.files.map(fileRow).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';script-src 'none';img-src 'none';connect-src 'none';font-src 'none';object-src 'none';base-uri 'none';form-action 'none'"><meta name="realitycheck-deployment-status" content="${receipt.status}"><meta name="realitycheck-deployment-receipt-id" content="${receipt.receiptId}"><meta name="realitycheck-deploy-content-id" content="${receipt.source.deployContentId}"><title>RealityCheck Deployment Receipt / 部署回执</title>
<style>
:root{--ink:#191c21;--muted:#656b76;--line:#dedbd4;--paper:#fff;--canvas:#f4f2ed;--green:#147257;--amber:#9b6200;--red:#b42318;--gray:#57606a;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--canvas)}*{box-sizing:border-box}body{margin:0}.lang-radio{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip-path:inset(50%)}.i18n-zh{display:none}#language-zh:checked~.report .i18n-en{display:none}#language-zh:checked~.report .i18n-zh{display:inline}.wrap{width:min(1120px,calc(100% - 32px));margin:auto}.top{color:#fff;background:#191b20}.top .wrap{min-height:62px;display:flex;align-items:center;gap:12px}.brand{font-weight:900}.brand span{color:#ff7552}.language{display:flex;gap:4px;margin-left:auto}.language label{display:inline-flex;min-height:32px;align-items:center;padding:0 10px;border:1px solid #454852;border-radius:7px;color:#c4c7ce;background:#25272d;font-weight:800;cursor:pointer}#language-en:checked~.report label[for=language-en],#language-zh:checked~.report label[for=language-zh]{color:#17191f;background:#fff}.hero{padding:48px 0 20px}.eyebrow{margin:0 0 8px;color:#d04c2a;font-size:10px;font-weight:900;letter-spacing:.13em}.hero h1{max-width:900px;margin:0;font-size:clamp(35px,6vw,61px);line-height:1;letter-spacing:-.05em}.hero p{max-width:820px;color:var(--muted);line-height:1.65}.decision{margin:14px 0;padding:22px;border:1px solid var(--line);border-left:6px solid var(--green);border-radius:14px;background:var(--paper)}.decision[data-tone=review]{border-left-color:var(--amber)}.decision[data-tone=broken]{border-left-color:var(--red)}.decision[data-tone=unverified]{border-left-color:var(--gray)}.decision h2{margin:5px 0 8px;font-size:28px}.decision p{margin:0;color:var(--muted);line-height:1.6}.metrics{display:grid;grid-template-columns:repeat(6,1fr);margin:18px 0;border:1px solid var(--line);border-radius:12px;background:var(--paper);overflow:hidden}.metrics div{padding:16px;border-left:1px solid var(--line)}.metrics div:first-child{border:0}.metrics strong{display:block;font-size:25px}.metrics span{color:var(--muted);font-size:10px}.panel{margin:16px 0;padding:18px;border:1px solid var(--line);border-radius:12px;background:var(--paper)}.panel h2{margin:0 0 10px;font-size:20px}.facts{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.fact{padding:12px;border:1px solid var(--line);border-radius:8px}.fact span,.fact small{display:block;color:var(--muted);font-size:10px}.fact code,.fact b{display:block;margin-top:6px;overflow-wrap:anywhere;font-size:12px}.reasons ul,.limits ul{margin:8px 0;padding-left:20px;color:var(--muted);line-height:1.7}.reasons code{color:var(--ink)}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:10px}table{width:100%;border-collapse:collapse;background:var(--paper);font-size:11px}th,td{padding:11px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}th{position:sticky;top:0;background:#f2f0eb;font-size:9px;text-transform:uppercase;letter-spacing:.08em}td code,td small{display:block;max-width:260px;overflow-wrap:anywhere}td small{margin-top:4px;color:var(--muted)}tr[data-state=transformed] td:first-child{border-left:4px solid var(--amber)}tr[data-state=missing] td:first-child{border-left:4px solid var(--red)}tr[data-state=skipped] td:first-child{border-left:4px solid var(--gray)}.footer{margin:24px 0 40px;color:var(--muted);font-size:11px;line-height:1.6}@media(max-width:760px){.metrics{grid-template-columns:repeat(2,1fr)}.metrics div:nth-child(odd){border-left:0}.facts{grid-template-columns:1fr}.hero{padding-top:34px}}
</style></head><body>
<input class="lang-radio" type="radio" name="report-language" id="language-en" checked><input class="lang-radio" type="radio" name="report-language" id="language-zh"><div class="report"><header class="top"><div class="wrap"><div class="brand">Reality<span>Check</span> / LIVE</div><div class="language" role="group" aria-label="Report language"><label for="language-en">EN</label><label for="language-zh">中文</label></div></div></header><main class="wrap">
<section class="hero"><p class="eyebrow">${localized(copy.eyebrow)}</p><h1>${localized(copy.title)}</h1><p>${localized(copy.detail)}</p></section>
<section class="decision" data-tone="${copy.tone}"><p class="eyebrow">${escapeHtml(receipt.status)}</p><h2><code>${escapeHtml(target)}</code></h2><p>${localized([`Verified at ${receipt.verification.verifiedAt}. This is a point-in-time observation; live bytes can change after this timestamp.`, `验证时间：${receipt.verification.verifiedAt}。这是时间点观测；线上字节可在此时间后发生变化。`])}</p></section>
<section class="metrics">${SUMMARY_KEYS.map((key) => `<div><strong>${receipt.summary[key].files}</strong><span>${localized([`${SUMMARY_COPY[key][0]} files`, `${SUMMARY_COPY[key][1]}文件`])}</span><small>${formatBytes(receipt.summary[key].bytes)} B</small></div>`).join("")}</section>
<p class="footer">${localized(["Fetched bytes count only successful exact or transformed responses. Matched, transformed, missing, and skipped byte totals describe expected package scope; error-response bodies are never read into this receipt.", "已获取字节只统计成功的一致或已变换响应。一致、已变换、缺失和未核验的字节总数描述期望文件包范围；错误响应正文绝不会读入本回执。"])}</p>
<section class="panel"><h2>${localized(["Bound identities and scope", "已绑定身份与范围"])}</h2><div class="facts"><div class="fact"><span>${localized(["Source archive SHA-256", "源归档 SHA-256"])}</span><code title="${receipt.source.archiveSha256}">${shortHash(receipt.source.archiveSha256)}</code><small>${formatBytes(receipt.source.archiveBytes)} B</small></div><div class="fact"><span>${localized(["Deploy content ID", "部署内容 ID"])}</span><code title="${receipt.source.deployContentId}">${shortHash(receipt.source.deployContentId)}</code></div><div class="fact"><span>${localized(["Publish manifest", "发布清单"])}</span><code title="${receipt.source.publishManifestId}">${shortHash(receipt.source.publishManifestId)}</code></div><div class="fact"><span>${localized(["Final-archive browser proof", "最终归档浏览器证明"])}</span><code title="${receipt.source.finalArchiveBrowserProofId}">${shortHash(receipt.source.finalArchiveBrowserProofId)}</code></div><div class="fact"><span>${localized(["Receipt ID", "回执 ID"])}</span><code title="${receipt.receiptId}">${shortHash(receipt.receiptId)}</code></div><div class="fact"><span>${localized(["Verification", "验证过程"])}</span><b>${receipt.verification.attempts} ${localized(["bounded attempts", "次有界尝试"])}</b><small>${escapeHtml(receipt.verification.startedAt)} → ${escapeHtml(receipt.verification.verifiedAt)}</small></div><div class="fact"><span>${localized(["Coverage", "覆盖范围"])}</span><b>${receipt.verification.coverageComplete ? localized(["Complete", "完整"]) : localized(["Incomplete", "不完整"])}</b></div><div class="fact"><span>${localized(["Passive browser", "被动浏览器"])}</span><div>${browser}</div></div></div></section>
<section class="panel reasons"><h2>${localized(["Decision reasons", "判断原因"])}</h2>${reasons}</section>
<section class="panel"><h2>${localized(["Per-path byte evidence", "逐路径字节证据"])}</h2><div class="table-wrap"><table><thead><tr><th>${localized(["Path / role", "路径 / 角色"])}</th><th>${localized(["State", "状态"])}</th><th>${localized(["Expected", "期望值"])}</th><th>${localized(["Fetched", "已获取"])}</th><th>HTTP / MIME</th><th>${localized(["Redirect facts", "跳转事实"])}</th></tr></thead><tbody>${rows}</tbody></table></div></section>
<section class="panel limits"><h2>${localized(["Explicit limitations", "明确边界"])}</h2><ul>${[...LIMITATION_COPY, screenshotLimitationCopy(receipt)].map((copyItem) => `<li>${localized(copyItem)}</li>`).join("")}</ul></section>
<p class="footer">RealityCheck · ${localized(["Evidence first. No response bodies, headers, cookies, or credentials are retained in this receipt.", "证据优先。本回执不保留响应正文、响应头、Cookie 或凭据。"])}</p></main></div></body></html>`;
}

function markdownStatus(receipt, zh) {
  const copy = STATUS_COPY[receipt.status];
  return zh ? copy.title[1] : copy.title[0];
}

/** Render one deterministic Markdown language from a validated receipt. */
export function renderNoteDeploymentReceiptMarkdown(inputReceipt, language = "en") {
  if (!["en", "zh-CN"].includes(language)) throw new TypeError("deployment receipt Markdown language must be en or zh-CN");
  const receipt = validateNoteDeploymentReceipt(inputReceipt);
  const zh = language === "zh-CN";
  const target = `${receipt.target.origin}${receipt.target.basePath}`;
  const lines = zh
    ? ["# RealityCheck 线上部署回执", "", `> **${markdownStatus(receipt, true)}**`, "", `- 状态：\`${receipt.status}\``, `- 目标：\`${escapeMarkdown(target)}\``, `- 验证时间：\`${receipt.verification.verifiedAt}\``, "- 新鲜度：仅代表上述时间点；线上内容随后即可变化。", `- 覆盖：${receipt.verification.coverageComplete ? "完整" : "不完整"}`, `- 浏览器证明：${receipt.browser ? receipt.browser.status : "未运行"}`, ""]
    : ["# RealityCheck live deployment receipt", "", `> **${markdownStatus(receipt, false)}**`, "", `- Status: \`${receipt.status}\``, `- Target: \`${escapeMarkdown(target)}\``, `- Verified at: \`${receipt.verification.verifiedAt}\``, "- Freshness: point-in-time only; live content may change immediately afterward.", `- Coverage: ${receipt.verification.coverageComplete ? "complete" : "incomplete"}`, `- Browser proof: ${receipt.browser ? receipt.browser.status : "not run"}`, ""];
  lines.push(zh ? "## 绑定身份" : "## Bound identities", "",
    `- ${zh ? "源归档 SHA-256" : "Source archive SHA-256"}: \`${receipt.source.archiveSha256}\``,
    `- ${zh ? "源归档字节" : "Source archive bytes"}: \`${receipt.source.archiveBytes}\``,
    `- ${zh ? "部署内容 ID" : "Deploy content ID"}: \`${receipt.source.deployContentId}\``,
    `- ${zh ? "发布清单 ID" : "Publish manifest ID"}: \`${receipt.source.publishManifestId}\``,
    `- ${zh ? "最终归档浏览器证明 ID" : "Final-archive browser proof ID"}: \`${receipt.source.finalArchiveBrowserProofId}\``,
    `- ${zh ? "回执 ID" : "Receipt ID"}: \`${receipt.receiptId}\``, "",
    zh ? "## 汇总" : "## Summary", "",
    `| ${zh ? "类别" : "Category"} | ${zh ? "文件" : "Files"} | ${zh ? "字节" : "Bytes"} |`,
    "| --- | ---: | ---: |",
    ...SUMMARY_KEYS.map((key) => `| ${zh ? SUMMARY_COPY[key][1] : SUMMARY_COPY[key][0]} | ${receipt.summary[key].files} | ${receipt.summary[key].bytes} |`), "",
    zh ? "已获取字节只统计成功的一致或已变换响应；其余状态的字节表示受影响的期望文件包范围。错误响应正文不写入回执。" : "Fetched bytes count only successful exact or transformed responses; other state bytes describe affected expected-package scope. Error-response bodies are not written to the receipt.", "",
    zh ? "## 判断原因" : "## Decision reasons", "");
  if (receipt.reasonCodes.length) {
    for (const reason of receipt.reasonCodes) lines.push(`- \`${reason}\` — ${zh ? REASON_COPY[reason][1] : REASON_COPY[reason][0]}`);
  } else lines.push(zh ? "- 未记录例外或失败原因。" : "- No exception or failure reason was recorded.");
  lines.push("", zh ? "## 逐路径证据" : "## Per-path evidence", "",
    `| ${zh ? "路径" : "Path"} | ${zh ? "状态" : "State"} | ${zh ? "期望 SHA-256 / 字节" : "Expected SHA-256 / bytes"} | ${zh ? "实际 SHA-256 / 字节" : "Actual SHA-256 / bytes"} | HTTP | MIME |`,
    "| --- | --- | --- | --- | ---: | --- |",
    ...receipt.files.map((file) => `| \`${escapeMarkdown(file.path)}\` | ${zh ? `${file.state} / ${STATE_COPY[file.state][1]}` : `${file.state} / ${STATE_COPY[file.state][0]}`} | \`${file.expectedSha256}\` / ${file.expectedBytes} | ${file.actualSha256 ? `\`${file.actualSha256}\` / ${file.actualBytes}` : "—"} | ${file.httpStatus ?? "—"} | ${file.mimeKind || "—"} |`),
    "", zh ? "## 明确边界" : "## Explicit limitations", "");
  for (const item of [...LIMITATION_COPY, screenshotLimitationCopy(receipt)]) lines.push(`- ${zh ? item[1] : item[0]}`);
  return `${lines.join("\n")}\n`;
}

/** Build all deterministic deployment-receipt bytes without writing files. */
export function buildNoteDeploymentArtifacts(input) {
  const receipt = buildNoteDeploymentReceipt(input);
  return {
    receipt,
    artifactNames: { ...NOTE_DEPLOY_ARTIFACT_NAMES },
    receiptJson: `${JSON.stringify(receipt, null, 2)}\n`,
    markdown: renderNoteDeploymentReceiptMarkdown(receipt, "en"),
    markdownZhCN: renderNoteDeploymentReceiptMarkdown(receipt, "zh-CN"),
    reportHtml: renderNoteDeploymentReceiptHtml(receipt),
  };
}

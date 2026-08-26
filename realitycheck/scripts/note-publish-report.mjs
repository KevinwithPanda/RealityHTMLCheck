import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { TOOL_VERSION } from "./version.mjs";

export const NOTE_PUBLISH_STATUSES = Object.freeze([
  "ready",
  "warnings",
  "browser-proof-required",
  "working-copy",
]);

const PROFILE = "passive-static-v1";
const PLATFORM_POLICY_CHECKED_AT = "2026-08-27";
const PLATFORM_POLICY_SOURCES = Object.freeze({
  netlifyDrop: "https://docs.netlify.com/start/quickstarts/netlify-drop-quickstart/",
  cloudflarePagesDirectUpload: "https://developers.cloudflare.com/pages/get-started/direct-upload/",
  githubPages: "https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site",
});
const PLATFORM_KEYS = Object.freeze(Object.keys(PLATFORM_POLICY_SOURCES));
const PLATFORM_STATES = new Set(["pass", "review", "block"]);
const SHA256_ID = /^sha256:[a-f0-9]{64}$/;
const TOP_LEVEL_KEYS = new Set([
  "generatedAt",
  "deployContentId",
  "browserProofId",
  "status",
  "platformDecisions",
  "findingsSummary",
]);
const FINDING_KEYS = Object.freeze(["errors", "warnings", "advice", "unverified"]);
const KNOWN_REASONS = new Set([
  "required-gate-failed",
  "netlify-total-recommendation",
  "netlify-file-recommendation",
  "cloudflare-file-count",
  "cloudflare-file-size",
  "cloudflare-direct-upload-cannot-switch-to-git",
  "github-pages-zip-requires-extraction-or-action",
]);
const PROCEDURAL_REASONS = new Set(["cloudflare-direct-upload-cannot-switch-to-git", "github-pages-zip-requires-extraction-or-action"]);
const ADVISORY_REASONS = new Set([
  ...PROCEDURAL_REASONS,
  "netlify-total-recommendation",
  "netlify-file-recommendation",
]);

const STATUS_COPY = Object.freeze({
  ready: {
    eyebrow: ["VERIFIED LOCALLY · READY TO UPLOAD", "已完成本地验证 · 可上传"],
    title: ["No local blockers for the selected hosts", "所选托管平台未发现本地阻断"],
    detail: [
      "The exact deploy content and passive browser proof are bound below. The site has not been uploaded or deployed.",
      "下方已绑定精确发布内容与被动浏览器证明；网站尚未上传或部署。",
    ],
    tone: "ready",
  },
  warnings: {
    eyebrow: ["VERIFIED LOCALLY · WARNINGS DISCLOSED", "已完成本地验证 · 提醒已披露"],
    title: ["Upload only after reviewing the disclosed warnings", "复核已披露提醒后再上传"],
    detail: [
      "Required local browser gates completed, but non-blocking findings or host-specific recommendations remain visible.",
      "必需的本地浏览器门禁已经完成，但仍保留非阻断问题或特定平台建议。",
    ],
    tone: "warnings",
  },
  "browser-proof-required": {
    eyebrow: ["STATIC PREFLIGHT ONLY", "仅完成静态预检"],
    title: ["Local browser proof is still required", "仍需完成本地浏览器证明"],
    detail: [
      "The deploy content is bound, but no completed passive browser proof is attached. This is not a publish-ready decision.",
      "发布内容已经绑定，但尚未附加完成的被动浏览器证明；这不是可发布结论。",
    ],
    tone: "proof-required",
  },
  "working-copy": {
    eyebrow: ["WORKING COPY ONLY · DO NOT PUBLISH", "仅限工作副本 · 请勿发布"],
    title: ["Publication blockers remain", "仍存在发布阻断"],
    detail: [
      "Keep this copy for repair and recheck. Its proof records the blockers; it does not authorize or recommend publication.",
      "请保留此副本用于修复和复检。证明只记录阻断，不授权或建议发布。",
    ],
    tone: "working-copy",
  },
});

const PLATFORM_COPY = Object.freeze({
  netlifyDrop: {
    label: ["Netlify Drop", "Netlify Drop"],
    detail: ["Direct folder or ZIP upload preflight", "文件夹或 ZIP 直接上传预检"],
  },
  cloudflarePagesDirectUpload: {
    label: ["Cloudflare Pages Direct Upload", "Cloudflare Pages 直接上传"],
    detail: ["Dashboard ZIP/folder upload preflight", "控制台 ZIP/文件夹上传预检"],
  },
  githubPages: {
    label: ["GitHub Pages", "GitHub Pages"],
    detail: ["Extract into a publishing source or deploy a directory with Actions", "解压到发布源，或通过 Actions 部署目录"],
  },
});

const PLATFORM_STATE_COPY = Object.freeze({
  pass: ["UPLOAD PREFLIGHT PASSED", "上传预检通过"],
  review: ["REVIEW REQUIRED", "需要复核"],
  block: ["BLOCKED", "已阻断"],
});

const REASON_COPY = Object.freeze({
  "required-gate-failed": [
    "A required local publish gate has not passed.",
    "一项必需的本地发布门禁尚未通过。",
  ],
  "netlify-total-recommendation": [
    "The deploy exceeds Netlify Drop's recommended total size; use the CLI or review upload reliability.",
    "发布内容超过 Netlify Drop 建议的总大小；请改用 CLI 或复核上传可靠性。",
  ],
  "netlify-file-recommendation": [
    "At least one file exceeds Netlify Drop's recommended per-file size; use the CLI or review upload reliability.",
    "至少一个文件超过 Netlify Drop 建议的单文件大小；请改用 CLI 或复核上传可靠性。",
  ],
  "cloudflare-file-count": [
    "The package exceeds the Cloudflare Pages dashboard file-count limit.",
    "文件包超过 Cloudflare Pages 控制台的文件数量限制。",
  ],
  "cloudflare-file-size": [
    "At least one asset exceeds the Cloudflare Pages per-file size limit.",
    "至少一个资源超过 Cloudflare Pages 的单文件大小限制。",
  ],
  "cloudflare-direct-upload-cannot-switch-to-git": [
    "A Cloudflare Pages Direct Upload project cannot later be switched to Git integration; choose the project type deliberately.",
    "Cloudflare Pages 直接上传项目之后不能切换为 Git 集成；请有意选择项目类型。",
  ],
  "github-pages-zip-requires-extraction-or-action": [
    "GitHub Pages does not publish this ZIP directly; extract it into the configured source root or deploy the directory with Actions.",
    "GitHub Pages 不会直接发布此 ZIP；请将其解压到已配置的发布源根目录，或通过 Actions 部署该目录。",
  ],
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new TypeError(`${label} contains missing or unsupported fields`);
}

function sha256Id(value, label, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !SHA256_ID.test(value)) throw new TypeError(`${label} must be a lowercase sha256: identifier`);
  return value;
}

function normalizedTimestamp(value) {
  if (typeof value !== "string") throw new TypeError("generatedAt must be an ISO-8601 timestamp");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) throw new TypeError("generatedAt must be a canonical ISO-8601 timestamp");
  return value;
}

function normalizedFindings(value) {
  exactKeys(value, FINDING_KEYS, "findingsSummary");
  return Object.fromEntries(FINDING_KEYS.map((key) => {
    const count = value[key];
    if (!Number.isSafeInteger(count) || count < 0 || count > 1_000_000) throw new TypeError(`findingsSummary.${key} must be a bounded non-negative integer`);
    return [key, count];
  }));
}

function normalizedPlatforms(value) {
  exactKeys(value, PLATFORM_KEYS, "platformDecisions");
  return Object.fromEntries(PLATFORM_KEYS.map((key) => {
    const decision = value[key];
    exactKeys(decision, ["status", "reasons"], `platformDecisions.${key}`);
    if (!PLATFORM_STATES.has(decision.status)) throw new TypeError(`platformDecisions.${key}.status is invalid`);
    if (!Array.isArray(decision.reasons)) throw new TypeError(`platformDecisions.${key}.reasons must be an array`);
    const reasons = [...new Set(decision.reasons)];
    if (reasons.some((reason) => typeof reason !== "string" || !KNOWN_REASONS.has(reason))) throw new TypeError(`platformDecisions.${key} contains an unsupported reason code`);
    reasons.sort();
    if (decision.status === "pass" && reasons.length) throw new TypeError(`platformDecisions.${key} cannot attach reasons to a pass`);
    if (decision.status !== "pass" && !reasons.length) throw new TypeError(`platformDecisions.${key} requires at least one reason`);
    return [key, { status: decision.status, reasons }];
  }));
}

function platformFacts(platforms) {
  const decisions = Object.values(platforms);
  return {
    blocked: decisions.some((decision) => decision.status === "block"),
    substantiveReview: decisions.some((decision) => decision.status === "review" && decision.reasons.some((reason) => !PROCEDURAL_REASONS.has(reason))),
    nonProofBlocker: decisions.some((decision) => decision.status === "block" && decision.reasons.some((reason) => reason !== "required-gate-failed" && !ADVISORY_REASONS.has(reason))),
  };
}

function validateStatus(status, browserProofId, findings, platforms) {
  if (!NOTE_PUBLISH_STATUSES.includes(status)) throw new TypeError(`status must be one of: ${NOTE_PUBLISH_STATUSES.join(", ")}`);
  const facts = platformFacts(platforms);
  const findingTotal = findings.errors + findings.warnings + findings.advice + findings.unverified;
  if (status === "ready") {
    if (!browserProofId || facts.blocked || facts.substantiveReview || findingTotal !== 0) throw new Error("ready status contradicts the supplied proof, platform, or finding evidence");
  } else if (status === "warnings") {
    if (!browserProofId || facts.blocked || findings.errors || findings.unverified || (!findings.warnings && !findings.advice && !facts.substantiveReview)) {
      throw new Error("warnings status contradicts the supplied proof, platform, or finding evidence");
    }
  } else if (status === "browser-proof-required") {
    if (browserProofId || findings.errors || findings.unverified || facts.nonProofBlocker) {
      throw new Error("browser-proof-required status contradicts the supplied proof, platform, or finding evidence");
    }
  } else if (!findings.errors && !findings.unverified && !facts.nonProofBlocker && !(browserProofId && facts.blocked)) {
    throw new Error("working-copy status requires a disclosed blocker or failed bound browser proof");
  }
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function manifestContract(input) {
  exactKeys(input, TOP_LEVEL_KEYS, "publish report input");
  const generatedAt = normalizedTimestamp(input.generatedAt);
  const deployContentId = sha256Id(input.deployContentId, "deployContentId");
  const browserProofId = sha256Id(input.browserProofId, "browserProofId", true);
  const findingsSummary = normalizedFindings(input.findingsSummary);
  const platformDecisions = normalizedPlatforms(input.platformDecisions);
  validateStatus(input.status, browserProofId, findingsSummary, platformDecisions);
  return {
    schemaVersion: "1",
    toolVersion: TOOL_VERSION,
    kind: "html-note-publish-proof",
    profile: PROFILE,
    generatedAt,
    status: input.status,
    deployContentId,
    browserProofId,
    findingsSummary,
    platformPolicy: {
      checkedAt: PLATFORM_POLICY_CHECKED_AT,
      sources: { ...PLATFORM_POLICY_SOURCES },
    },
    platformDecisions,
    artifacts: {
      entry: "../index.html",
      report: "report.html",
      manifest: "manifest.json",
      browserProof: browserProofId === null ? null : "browser-proof.json",
    },
    boundaries: {
      sourceUploaded: false,
      sourceTextIncluded: false,
      absoluteLocalPathsIncluded: false,
      automaticDeployment: false,
      remoteHostVerified: false,
      javascriptExecuted: false,
      externalRequestsAllowed: false,
      browserProofPresent: browserProofId !== null,
    },
  };
}

/**
 * Build the public, source-free manifest for one note publish handoff.
 * Input is intentionally closed: hashes, one status enum, controlled platform
 * reason codes, and bounded counts are the only caller-provided public data.
 */
export function buildNotePublishManifest(input) {
  const contract = manifestContract(input);
  return { ...contract, manifestId: digest(contract) };
}

function validateManifest(manifest) {
  if (!isRecord(manifest)) throw new TypeError("publish manifest must be an object");
  const { manifestId, ...candidate } = manifest;
  const rebuilt = buildNotePublishManifest({
    generatedAt: candidate.generatedAt,
    deployContentId: candidate.deployContentId,
    browserProofId: candidate.browserProofId,
    status: candidate.status,
    platformDecisions: candidate.platformDecisions,
    findingsSummary: candidate.findingsSummary,
  });
  const { manifestId: rebuiltId, ...rebuiltCandidate } = rebuilt;
  if (!isDeepStrictEqual(candidate, rebuiltCandidate)) {
    throw new Error("publish manifest contains unsupported or altered public fields");
  }
  if (manifestId !== rebuiltId) throw new Error("publish manifest ID does not match its normalized content");
  return rebuilt;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function shortId(value) {
  return value ? `${value.slice(0, 19)}…${value.slice(-8)}` : "—";
}

function localizedText([en, zhCN]) {
  return `<span class="i18n-en" lang="en">${escapeHtml(en)}</span><span class="i18n-zh" lang="zh-CN">${escapeHtml(zhCN)}</span>`;
}

function platformCard(key, decision) {
  const copy = PLATFORM_COPY[key];
  const state = PLATFORM_STATE_COPY[decision.status];
  const reasons = decision.reasons.length
    ? `<ul>${decision.reasons.map((reason) => `<li>${localizedText(REASON_COPY[reason])}</li>`).join("")}</ul>`
    : `<p class="no-reasons">${localizedText(["No documented upload-preflight issue was recorded.", "未记录已知的上传预检问题。"])}</p>`;
  return `<article class="platform" data-state="${decision.status}"><div class="platform-top"><div><h3>${localizedText(copy.label)}</h3><p>${localizedText(copy.detail)}</p></div><span>${localizedText(state)}</span></div>${reasons}</article>`;
}

/** Render a bilingual, self-contained report from a validated public manifest. */
export function renderNotePublishReport(inputManifest) {
  const manifest = validateManifest(inputManifest);
  const copy = STATUS_COPY[manifest.status];
  const browserProof = manifest.browserProofId
    ? `<code title="${manifest.browserProofId}">${shortId(manifest.browserProofId)}</code>`
    : `<span>${localizedText(["Not attached", "尚未附加"])}</span>`;
  const platformCards = PLATFORM_KEYS.map((key) => platformCard(key, manifest.platformDecisions[key])).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';script-src 'none';img-src 'none';connect-src 'none';font-src 'none';object-src 'none';base-uri 'none';form-action 'none'"><meta name="realitycheck-publish-status" content="${manifest.status}"><meta name="realitycheck-deploy-content-id" content="${manifest.deployContentId}"><meta name="realitycheck-browser-proof-id" content="${manifest.browserProofId || ""}"><meta name="realitycheck-publish-manifest-id" content="${manifest.manifestId}"><title>RealityCheck Publish Proof / 发布证明</title>
<style>
:root{--ink:#1b1d22;--muted:#656b76;--line:#dedbd4;--paper:#fff;--canvas:#f4f2ed;--green:#147257;--amber:#9b6200;--red:#b42318;--blue:#315f8d;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--canvas)}*{box-sizing:border-box}body{margin:0}.lang-radio{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}.i18n-zh{display:none}#language-zh:checked~.report .i18n-en{display:none}#language-zh:checked~.report .i18n-zh{display:inline}.wrap{width:min(1020px,calc(100% - 32px));margin:auto}.top{color:#fff;background:#191b20}.top .wrap{min-height:62px;display:flex;align-items:center;gap:12px}.brand{font-weight:900}.brand span{color:#ff7552}.subtitle{color:#b9bdc6;font-size:11px}.language{display:flex;gap:4px;margin-left:auto}.language label{display:inline-flex;min-height:32px;align-items:center;padding:0 10px;border:1px solid #444750;border-radius:7px;color:#b9bdc6;background:#23252b;font-weight:850;cursor:pointer}#language-en:checked~.report label[for=language-en],#language-zh:checked~.report label[for=language-zh]{color:#17191f;background:#fff}#language-en:focus-visible~.report label[for=language-en],#language-zh:focus-visible~.report label[for=language-zh]{outline:3px solid #8bbcff;outline-offset:2px}.hero{padding:56px 0 24px}.eyebrow{margin:0 0 9px;color:#d04c2a;font-size:10px;font-weight:900;letter-spacing:.13em}.hero h1{max-width:820px;margin:0;font-size:clamp(38px,7vw,67px);line-height:.96;letter-spacing:-.055em}.hero>p:last-child{max-width:760px;color:var(--muted);font-size:14px;line-height:1.65}.decision{margin:12px 0 18px;padding:23px;border:1px solid var(--line);border-left:6px solid var(--green);border-radius:14px;background:var(--paper)}.decision[data-tone=warnings],.decision[data-tone=proof-required]{border-left-color:var(--amber)}.decision[data-tone=working-copy]{border-left-color:var(--red)}.decision h2{margin:5px 0 8px;font-size:28px;letter-spacing:-.035em}.decision p{max-width:780px;margin:0;color:var(--muted);line-height:1.6}.metrics{display:grid;grid-template-columns:repeat(4,1fr);margin:18px 0;border:1px solid var(--line);border-radius:13px;background:var(--paper);overflow:hidden}.metrics div{padding:18px;border-left:1px solid var(--line)}.metrics div:first-child{border:0}.metrics strong{display:block;font-size:28px}.metrics span{color:var(--muted);font-size:10px}.section{margin:18px 0}.section-head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:10px}.section-head h2{margin:0;font-size:22px}.section-head p{max-width:560px;margin:0;color:var(--muted);font-size:11px;line-height:1.5}.identities{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.identity{padding:17px;border:1px solid var(--line);border-radius:11px;background:var(--paper)}.identity>span{display:block;color:var(--muted);font-size:10px}.identity code,.identity b{display:block;margin-top:8px;overflow-wrap:anywhere;font:800 11px ui-monospace,SFMono-Regular,Consolas,monospace}.platforms{display:grid;gap:9px}.platform{padding:18px;border:1px solid var(--line);border-left:5px solid var(--green);border-radius:11px;background:var(--paper)}.platform[data-state=review]{border-left-color:var(--amber)}.platform[data-state=block]{border-left-color:var(--red)}.platform-top{display:flex;align-items:start;justify-content:space-between;gap:16px}.platform h3{margin:0 0 4px}.platform p{margin:0;color:var(--muted);font-size:11px;line-height:1.5}.platform-top>span{flex:none;padding:5px 7px;border-radius:5px;color:#fff;background:var(--green);font-size:9px;font-weight:900}.platform[data-state=review] .platform-top>span{background:var(--amber)}.platform[data-state=block] .platform-top>span{background:var(--red)}.platform ul{margin:14px 0 0;padding-left:20px;color:var(--muted);font-size:12px;line-height:1.6}.boundary{margin:24px 0;padding:19px;border-radius:12px;color:#fff;background:#25272d}.boundary h2{margin:0 0 8px;font-size:19px}.boundary p{margin:7px 0;color:#d4d6dc;font-size:12px;line-height:1.6}.boundary b{color:#fff}.actions{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:20px 0 42px}.actions a{display:inline-flex;min-height:42px;align-items:center;padding:0 14px;border-radius:8px;color:#fff;background:#202127;font-size:12px;font-weight:850;text-decoration:none}.actions time{color:var(--muted);font-size:10px}@media(max-width:720px){.metrics{grid-template-columns:1fr 1fr}.metrics div:nth-child(3){border-left:0;border-top:1px solid var(--line)}.metrics div:nth-child(4){border-top:1px solid var(--line)}.identities{grid-template-columns:1fr}.section-head,.platform-top,.actions{align-items:start;flex-direction:column}}@media print{.top,.actions a{display:none}.wrap{width:100%}.decision,.identity,.platform,.boundary{break-inside:avoid}}
</style></head><body><input class="lang-radio" type="radio" name="report-language" id="language-en" checked><input class="lang-radio" type="radio" name="report-language" id="language-zh"><div class="report"><header class="top"><div class="wrap"><div class="brand">Reality<span>Check</span> / PUBLISH</div><span class="subtitle">${localizedText(["Public source-free verification summary", "可公开、无源码的验证摘要"])}</span><div class="language" role="group" aria-label="Language / 语言"><label for="language-en" lang="en">EN</label><label for="language-zh" lang="zh-CN">中文</label></div></div></header>
<main class="wrap"><section class="hero"><p class="eyebrow">${localizedText(["VERIFIED PUBLISH HANDOFF", "已验证的发布交付"])}</p><h1>${localizedText(["Know what is ready before anything becomes public.", "在内容公开之前，先明确哪些已经就绪。"])}</h1><p>${localizedText(["This summary contains bounded identities, counts, and reason codes—never source text or absolute machine paths.", "本摘要只包含受限身份、计数和原因代码，绝不包含源码或本机绝对路径。"])}</p></section>
<section class="decision" data-tone="${copy.tone}"><span class="eyebrow">${localizedText(copy.eyebrow)}</span><h2>${localizedText(copy.title)}</h2><p>${localizedText(copy.detail)}</p></section>
<section class="metrics" aria-label="Finding summary / 问题汇总"><div><strong>${manifest.findingsSummary.errors}</strong><span>${localizedText(["errors", "错误"])}</span></div><div><strong>${manifest.findingsSummary.warnings}</strong><span>${localizedText(["warnings", "警告"])}</span></div><div><strong>${manifest.findingsSummary.advice}</strong><span>${localizedText(["advice", "建议"])}</span></div><div><strong>${manifest.findingsSummary.unverified}</strong><span>${localizedText(["unverified", "未验证"])}</span></div></section>
<section class="section"><div class="section-head"><h2>${localizedText(["Bound identities", "已绑定身份"])}</h2><p>${localizedText(["These identifiers bind the deploy content, browser evidence when present, and this normalized public manifest separately.", "这些标识分别绑定发布内容、存在时的浏览器证据，以及此规范化公开清单。"])}</p></div><div class="identities"><article class="identity"><span>${localizedText(["Deploy content", "发布内容"])}</span><code title="${manifest.deployContentId}">${shortId(manifest.deployContentId)}</code></article><article class="identity"><span>${localizedText(["Passive browser proof", "被动浏览器证明"])}</span>${browserProof}</article><article class="identity"><span>${localizedText(["Public manifest", "公开清单"])}</span><code title="${manifest.manifestId}">${shortId(manifest.manifestId)}</code></article></div></section>
<section class="section"><div class="section-head"><h2>${localizedText(["Host-specific decisions", "各托管平台结论"])}</h2><p>${localizedText(["A pass means only that the documented local upload preflight passed. It is not evidence of a completed vendor deployment.", "通过仅表示已满足有记录的本地上传预检，不证明托管平台已完成部署。"])}</p></div><div class="platforms">${platformCards}</div></section>
<section class="boundary"><h2>${localizedText(["Proof boundary", "证明边界"])}</h2><p>${localizedText(["RealityCheck did not upload or deploy this site. It did not verify an account, quota, domain, CDN, secret absence, malware absence, factual accuracy, copyright permission, comprehensive accessibility, SEO, every browser, dynamic JavaScript, forms, functions, or true PWA offline availability.", "RealityCheck 没有上传或部署此网站，也没有验证账号、额度、域名、CDN、绝无秘密、绝无恶意代码、事实准确性、版权许可、完整可访问性、SEO、所有浏览器、动态 JavaScript、表单、函数或真正的 PWA 离线可用性。"])}</p><p>${localizedText(["The passive profile keeps JavaScript disabled and external requests blocked. A bound browser proof covers only its declared loopback and exact-package replay scenarios; skipped, unsupported, or undiscovered behavior is not a pass.", "被动配置会禁用 JavaScript 并阻止外部请求。已绑定的浏览器证明只覆盖其中声明的 loopback 与精确文件包重放场景；跳过、不支持或未发现的行为不能算通过。"])}</p><p><b>${localizedText(["Public artifact:", "公开产物："])}</b> <span>${localizedText(["this report intentionally retains no source text or absolute local path, but anyone who can open the deployed proof can see these status counts and cryptographic identifiers.", "本报告刻意不保留源码或本机绝对路径，但任何能打开已部署证明的人都能看到这些状态计数和加密标识。"])}</span></p></section>
<div class="actions"><a href="../index.html">${localizedText(["Open packaged entry →", "打开文件包入口 →"])}</a><time datetime="${manifest.generatedAt}">${manifest.generatedAt}</time></div></main></div></body></html>`;
}

/** Build both public publish-proof artifacts from the same normalized input. */
export function buildNotePublishArtifacts(input) {
  const manifest = buildNotePublishManifest(input);
  return { manifest, reportHtml: renderNotePublishReport(manifest) };
}

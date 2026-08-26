#!/usr/bin/env node

import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateArtifactFiles } from "./artifact-validator.mjs";

const STATUS = Object.freeze({
  ready: { en: "READY TO UPLOAD", zhCN: "可上传" },
  warnings: { en: "READY · WARNINGS DISCLOSED", zhCN: "可上传 · 已披露提醒" },
  "browser-proof-required": { en: "BROWSER PROOF REQUIRED", zhCN: "仍需浏览器证明" },
  "working-copy": { en: "WORKING COPY ONLY", zhCN: "仅限工作副本" },
});

const PLATFORM = Object.freeze({
  netlifyDrop: { en: "Netlify Drop", zhCN: "Netlify Drop" },
  cloudflarePagesDirectUpload: { en: "Cloudflare Pages Direct Upload", zhCN: "Cloudflare Pages 直接上传" },
  githubPages: { en: "GitHub Pages", zhCN: "GitHub Pages" },
});

const PLATFORM_STATUS = Object.freeze({
  pass: { en: "PASS", zhCN: "通过" },
  review: { en: "REVIEW", zhCN: "复核" },
  block: { en: "BLOCK", zhCN: "阻断" },
});

const REASON = Object.freeze({
  "required-gate-failed": { en: "a required local publish gate did not pass", zhCN: "必需的本地发布门禁未通过" },
  "netlify-total-recommendation": { en: "review Netlify's recommended total upload size", zhCN: "请复核 Netlify 建议的上传总大小" },
  "netlify-file-recommendation": { en: "review Netlify's recommended per-file size", zhCN: "请复核 Netlify 建议的单文件大小" },
  "cloudflare-file-count": { en: "Cloudflare dashboard file-count limit exceeded", zhCN: "超过 Cloudflare 控制台文件数限制" },
  "cloudflare-file-size": { en: "Cloudflare per-file size limit exceeded", zhCN: "超过 Cloudflare 单文件大小限制" },
  "cloudflare-direct-upload-cannot-switch-to-git": { en: "a Direct Upload project cannot later switch to Git integration", zhCN: "Direct Upload 项目之后不能切换为 Git 集成" },
  "github-pages-zip-requires-extraction-or-action": { en: "extract the ZIP into a publishing source or deploy its directory with Actions", zhCN: "需把 ZIP 解压到发布源，或用 Actions 部署目录" },
});

function inlineCode(value) {
  return `\`${String(value ?? "").replaceAll("`", "ˋ").replace(/[\r\n]/g, " ")}\``;
}

function shortId(value) {
  return typeof value === "string" && value.length > 36 ? `${value.slice(0, 23)}…${value.slice(-8)}` : value;
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** Render a bounded GitHub Job Summary from an already validated receipt. */
export function buildNotePublishGitHubSummary(receipt, manifest, { language = "en", artifactUpload = true } = {}) {
  if (!receipt || receipt.kind !== "html-note-publish-receipt" || !STATUS[receipt.status]) throw new TypeError("A supported publish receipt is required");
  if (!manifest || manifest.kind !== "html-note-publish-proof" || manifest.manifestId === undefined) throw new TypeError("The receipt's public publish manifest is required");
  if (!new Set(["en", "zh-CN"]).has(language)) throw new TypeError("language must be en or zh-CN");
  if (typeof artifactUpload !== "boolean") throw new TypeError("artifactUpload must be boolean");
  const zh = language === "zh-CN";
  const local = (value) => zh ? value.zhCN : value.en;
  const findings = manifest.findingsSummary || {};
  const lines = [
    zh ? "## RealityCheck 可验证发布判断" : "## RealityCheck verified publish decision",
    "",
    `**${local(STATUS[receipt.status])}**`,
    "",
    zh
      ? (receipt.publishReady ? "最终发布 ZIP 已完成本地门禁；文件尚未部署。" : "当前文件只能用于修复与复检，不应部署。")
      : (receipt.publishReady ? "The final publish ZIP completed its local gates; it has not been deployed." : "This file is for repair and recheck only; do not deploy it."),
    "",
    `- ${zh ? "文件" : "File"}: ${inlineCode(receipt.archive.filename)}`,
    `- ${zh ? "容器 SHA-256" : "Container SHA-256"}: ${inlineCode(receipt.archive.sha256)}`,
    `- ${zh ? "发布内容身份" : "Deploy content ID"}: ${inlineCode(shortId(receipt.deployContentId))}`,
    `- ${zh ? "最终 ZIP 浏览器证明" : "Final-ZIP browser proof"}: **${receipt.finalArchiveBrowserProofPassed ? (zh ? "通过" : "PASS") : (zh ? "未通过" : "NOT PASSED")}**`,
    `- ${zh ? "问题计数" : "Finding counts"}: ${count(findings.errors)} ${zh ? "错误" : "errors"} · ${count(findings.warnings)} ${zh ? "警告" : "warnings"} · ${count(findings.advice)} ${zh ? "建议" : "advice"} · ${count(findings.unverified)} ${zh ? "未验证" : "unverified"}`,
    "",
    zh ? "### 托管平台预检" : "### Host-specific preflight",
    "",
    `| ${zh ? "平台" : "Host"} | ${zh ? "结论" : "Decision"} | ${zh ? "说明" : "Notes"} |`,
    "| --- | --- | --- |",
  ];
  for (const key of ["netlifyDrop", "cloudflarePagesDirectUpload", "githubPages"]) {
    const decision = receipt.platformDecisions?.[key];
    if (!decision || !PLATFORM_STATUS[decision.status]) throw new TypeError(`Unsupported platform decision: ${key}`);
    const notes = decision.reasons.length ? decision.reasons.map((reason) => local(REASON[reason] || { en: reason, zhCN: reason })).join("; ") : (zh ? "未记录本地阻断" : "No local blocker recorded");
    lines.push(`| ${local(PLATFORM[key])} | **${local(PLATFORM_STATUS[decision.status])}** | ${notes.replaceAll("|", "\\|")} |`);
  }
  lines.push(
    "",
    zh ? "### 数据与部署边界" : "### Data and deployment boundary",
    "",
    artifactUpload
      ? (zh ? "- 此工作流会把**完整 HTML、图片、样式和附件**上传到 GitHub Actions Artifact 存储；请按仓库可见性与保留策略复核后再启用。" : "- This workflow uploads the **complete HTML, images, styles, and attachments** to GitHub Actions Artifact storage; review repository visibility and retention before enabling it.")
      : (zh ? "- `upload-artifact: false`：本次未请求上传 GitHub Artifact；文件只存在于当前 runner。" : "- `upload-artifact: false`: no GitHub Artifact upload was requested; files remain only on the current runner."),
    zh ? "- RealityCheck 没有部署网站，也没有验证账号、域名、CDN、事实、版权、完整无障碍/SEO、所有浏览器或后端行为。" : "- RealityCheck did not deploy the site or verify accounts, domains, CDN behavior, facts, copyright, comprehensive accessibility/SEO, every browser, or backend behavior.",
    zh ? "- Action 证明的是 receipt 中声明的被动 Chromium 场景；跳过、截断或失败绝不会算通过。" : "- The Action proves only the passive Chromium scenarios declared by the receipt; skipped, truncated, or failed coverage is never a pass.",
    "",
  );
  return lines.join("\n");
}

function parseArguments(argv) {
  const options = { receipt: null, output: null, language: "en", artifactUpload: true };
  const args = [...argv];
  while (args.length) {
    const item = args.shift();
    if (item === "--language" || item === "--output" || item === "--artifact-upload") {
      const value = args.shift();
      if (value === undefined || value === "") throw new Error(`${item} requires a value`);
      if (item === "--language") options.language = value;
      else if (item === "--output") options.output = value;
      else if (new Set(["true", "false"]).has(value)) options.artifactUpload = value === "true";
      else throw new Error("--artifact-upload must be true or false");
    } else if (item.startsWith("--")) throw new Error(`Unknown option: ${item}`);
    else if (options.receipt) throw new Error(`Unexpected argument: ${item}`);
    else options.receipt = item;
  }
  if (!options.receipt || !options.output) throw new Error("Usage: note-publish-github-summary.mjs <receipt.json> --output <summary.md> [--language en|zh-CN] [--artifact-upload true|false]");
  return options;
}

export function run(argv) {
  const options = parseArguments(argv);
  const receiptPath = resolve(options.receipt);
  if (!existsSync(receiptPath)) throw new Error(`Receipt does not exist: ${options.receipt}`);
  const stat = lstatSync(receiptPath);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 1024 * 1024) throw new Error("Receipt must be a bounded regular JSON file");
  const [validation] = validateArtifactFiles([receiptPath]);
  if (!validation?.valid) throw new Error(`Receipt validation failed: ${validation?.errors.join("; ") || "unknown error"}`);
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  const stem = receipt.archive.filename.slice(0, -4);
  const manifestPath = resolve(dirname(receiptPath), `${stem}.manifest.json`);
  if (!existsSync(manifestPath) || lstatSync(manifestPath).isSymbolicLink() || !lstatSync(manifestPath).isFile()) throw new Error("The receipt's public manifest is missing or unsafe");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const markdown = `${buildNotePublishGitHubSummary(receipt, manifest, options)}\n`;
  const output = resolve(options.output);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, markdown, "utf8");
  console.log(output);
  return 0;
}

const direct = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)); }
})();
if (direct) {
  try { process.exitCode = run(process.argv.slice(2)); }
  catch (error) { console.error(`RealityCheck publish summary error: ${error.message}`); process.exitCode = 2; }
}

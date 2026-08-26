#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LEVEL_ORDER = Object.freeze({ error: 0, warning: 1, advice: 2 });

function text(value, limit = 500) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function markdown(value) {
  return text(value).replace(/([\\`*_{}\[\]()#+.!|>~-])/g, "\\$1");
}

function inlineCode(value) {
  return text(value).replaceAll("`", "ˋ");
}

function commandValue(value, property = false) {
  let escaped = text(value, 1000).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  if (property) escaped = escaped.replaceAll(":", "%3A").replaceAll(",", "%2C");
  return escaped;
}

function localized(value, language) {
  if (!value || typeof value !== "object") return "";
  return language === "zh-CN" ? value.zhCN : value.en;
}

function validateBundle(bundle) {
  if (!bundle || bundle.kind !== "html-note-check-bundle") throw new Error("Expected a RealityCheck HTML note report bundle");
  if (!bundle.summary || !Number.isFinite(bundle.summary.score) || !bundle.summary.counts) throw new Error("The HTML note report summary is incomplete");
  if (!Array.isArray(bundle.reports)) throw new Error("The HTML note report has no file reports");
  return bundle;
}

export function buildNoteGitHubSummary(bundle, language = "en") {
  validateBundle(bundle);
  if (!new Set(["en", "zh-CN"]).has(language)) throw new Error("language must be en or zh-CN");
  const zh = language === "zh-CN";
  const { summary } = bundle;
  const counts = summary.counts;
  const decision = summary.status === "needs-fix"
    ? (zh ? "暂不建议分享" : "Do not share yet")
    : summary.status === "review"
      ? (zh ? "分享前请复核" : "Review before sharing")
      : (zh ? "未发现阻断项" : "No blocking issues found");
  const findings = bundle.reports
    .flatMap((report) => (report.findings || []).map((finding) => ({ report, finding })))
    .sort((left, right) => (LEVEL_ORDER[left.finding.level] ?? 9) - (LEVEL_ORDER[right.finding.level] ?? 9)
      || left.report.path.localeCompare(right.report.path)
      || left.finding.id.localeCompare(right.finding.id));
  const lines = [
    zh ? "# RealityCheck HTML 笔记门禁" : "# RealityCheck HTML note gate",
    "",
    `**${decision}** · ${summary.score}/100`,
    "",
    zh
      ? `已静态检查 ${summary.files} 个 HTML 文件；文件夹分数采用最低文件分，未执行笔记脚本。RealityCheck 没有上传源笔记；启用 artifact 时，工作流会保存含有限证据摘录的生成报告。`
      : `Statically checked ${summary.files} HTML file(s). Folder readiness uses the lowest file score and note scripts were not executed. RealityCheck did not upload source notes; when artifacts are enabled, this workflow stores the generated report with bounded evidence excerpts.`,
    "",
    `| ${zh ? "错误" : "Errors"} | ${zh ? "警告" : "Warnings"} | ${zh ? "建议" : "Advice"} | ${zh ? "安全副本修复" : "Safe-copy fixes"} |`,
    "| ---: | ---: | ---: | ---: |",
    `| ${counts.error ?? 0} | ${counts.warning ?? 0} | ${counts.advice ?? 0} | ${counts.autoFixable ?? 0} |`,
    "",
  ];
  if (findings.length) {
    lines.push(zh ? "## 优先处理" : "## Prioritized findings", "");
    for (const { report, finding } of findings.slice(0, 20)) {
      const location = finding.evidence?.[0];
      const where = location ? `${location.path}:${location.line}` : report.path;
      lines.push(`- **${markdown(finding.level.toUpperCase())} · ${markdown(finding.id)}** — ${markdown(localized(finding.title, language))}  `);
      lines.push(`  \`${inlineCode(where)}\` · ${markdown(localized(finding.remediation, language))}`);
    }
    if (findings.length > 20) lines.push("", zh ? `其余 ${findings.length - 20} 项请查看上传的完整报告。` : `${findings.length - 20} additional finding(s) are available in the uploaded report.`);
  } else {
    lines.push(zh ? "启用的确定性规则没有发现问题。" : "The enabled deterministic rules found no problems.");
  }
  lines.push("", zh ? "下载本任务的 RealityCheck artifact，打开 `latest.html` 查看可切换中英文的完整报告。" : "Download this job's RealityCheck artifact and open `latest.html` for the complete bilingual report.", "");
  return `${lines.join("\n")}\n`;
}

export function buildNoteWorkflowAnnotations(bundle, language = "en", maxAnnotations = 20, sourceRoot = "") {
  validateBundle(bundle);
  if (!Number.isInteger(maxAnnotations) || maxAnnotations < 1 || maxAnnotations > 50) throw new Error("maxAnnotations must be an integer from 1 to 50");
  const normalizedRoot = text(sourceRoot, 300).replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (normalizedRoot.startsWith("/") || /^[A-Za-z]:\//.test(normalizedRoot) || normalizedRoot.split("/").includes("..")) throw new Error("sourceRoot must be a safe relative path");
  const annotations = [];
  const candidates = bundle.reports
    .flatMap((report) => (report.findings || []).map((finding) => ({ report, finding })))
    .filter(({ finding }) => finding.level === "error" || finding.level === "warning")
    .sort((left, right) => LEVEL_ORDER[left.finding.level] - LEVEL_ORDER[right.finding.level]);
  for (const { report, finding } of candidates.slice(0, maxAnnotations)) {
    const evidence = finding.evidence?.[0];
    const reportPath = text(evidence?.path || report.path, 300).replaceAll("\\", "/");
    const rawPath = normalizedRoot && normalizedRoot !== "." ? `${normalizedRoot}/${reportPath}` : reportPath;
    const safePath = rawPath && !rawPath.startsWith("/") && !/^[A-Za-z]:\//.test(rawPath) && !rawPath.split("/").includes("..") ? rawPath : "";
    const line = Number.isInteger(evidence?.line) && evidence.line > 0 ? evidence.line : null;
    const properties = [];
    if (safePath) properties.push(`file=${commandValue(safePath, true)}`);
    if (line) properties.push(`line=${line}`);
    properties.push(`title=${commandValue(`RealityCheck ${finding.id}`, true)}`);
    const message = `${localized(finding.title, language)} — ${localized(finding.summary, language)}`;
    annotations.push(`::${finding.level === "error" ? "error" : "warning"} ${properties.join(",")}::${commandValue(message)}`);
  }
  return annotations;
}

function parseArguments(argv) {
  const args = [...argv];
  const options = { report: null, output: null, language: "en", maxAnnotations: 20, sourceRoot: "" };
  while (args.length) {
    const item = args.shift();
    if (item === "--output" || item === "--language" || item === "--max-annotations" || item === "--source-root") {
      const value = args.shift();
      if (!value) throw new Error(`${item} requires a value`);
      if (item === "--output") options.output = value;
      if (item === "--language") options.language = value;
      if (item === "--max-annotations") options.maxAnnotations = Number(value);
      if (item === "--source-root") options.sourceRoot = value;
      continue;
    }
    if (item.startsWith("--")) throw new Error(`Unknown option: ${item}`);
    if (options.report) throw new Error(`Unexpected argument: ${item}`);
    options.report = item;
  }
  if (!options.report || !options.output) throw new Error("Usage: note-github-summary.mjs REPORT.json --output summary.md [--language en|zh-CN] [--max-annotations 1-50] [--source-root PATH]");
  return options;
}

export function run(argv) {
  const options = parseArguments(argv);
  const reportPath = resolve(options.report);
  if (!existsSync(reportPath)) throw new Error(`Report does not exist: ${options.report}`);
  const bundle = validateBundle(JSON.parse(readFileSync(reportPath, "utf8")));
  const output = resolve(options.output);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, buildNoteGitHubSummary(bundle, options.language), "utf8");
  for (const annotation of buildNoteWorkflowAnnotations(bundle, options.language, options.maxAnnotations, options.sourceRoot)) console.log(annotation);
  console.log(`note github summary: ${output}`);
  return 0;
}

const direct = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (direct) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (error) {
    console.error(`RealityCheck note summary error: ${error.message}`);
    process.exitCode = 2;
  }
}

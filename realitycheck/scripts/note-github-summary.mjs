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
  if (bundle.comparison !== undefined) {
    if (!bundle.comparison || bundle.comparison.kind !== "html-note-check-comparison") throw new Error("The HTML note comparison is invalid");
    for (const state of ["new", "resolved", "worsened", "persistent", "unverified"]) {
      if (!Array.isArray(bundle.comparison[state])) throw new Error(`The HTML note comparison ${state} list is invalid`);
    }
  }
  return bundle;
}

function bundleFindings(bundle) {
  return [
    ...bundle.reports.flatMap((report) => (report.findings || []).map((finding) => ({ scope: "html-file", report, finding }))),
    ...(bundle.packageFindings || []).map((finding) => ({ scope: "package", report: null, finding })),
  ];
}

function comparisonFindings(bundle) {
  if (!bundle.comparison) return null;
  return ["new", "worsened", "unverified"].flatMap((state) => bundle.comparison[state].map((item) => ({
    scope: item.scope?.kind === "package" ? "package" : "html-file",
    report: item.scope?.kind === "html" ? { path: item.scope.path } : null,
    finding: item.after || item.before,
    state,
    reason: item.reason,
  })));
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
  const comparison = bundle.comparison || null;
  const htmlSelection = bundle.selection?.html || { excludePatterns: [], excludedCount: 0 };
  const findings = (comparisonFindings(bundle) || bundleFindings(bundle))
    .sort((left, right) => (LEVEL_ORDER[left.finding.level] ?? 9) - (LEVEL_ORDER[right.finding.level] ?? 9)
      || String(left.finding.evidence?.[0]?.path || left.report?.path || "").localeCompare(String(right.finding.evidence?.[0]?.path || right.report?.path || ""))
      || left.finding.id.localeCompare(right.finding.id));
  const lines = [
    zh ? "# RealityCheck HTML 笔记门禁" : "# RealityCheck HTML note gate",
    "",
    comparison
      ? `**${comparison.gate?.failed ? (zh ? "回归门禁未通过" : "Regression gate failed") : (zh ? "回归门禁已通过" : "Regression gate passed")}** · ${zh ? "当前就绪度" : "current readiness"} ${summary.score}/100`
      : `**${decision}** · ${summary.score}/100`,
    "",
    zh
      ? `已静态检查 ${summary.files} 个 HTML 文件；文件夹分数采用最低 HTML 文件分${bundle.packageFindings?.length ? "并计入文件包依赖问题" : ""}，未执行笔记脚本。RealityCheck 没有上传源笔记；启用 artifact 时，工作流会保存含有限证据摘录的生成报告。`
      : `Statically checked ${summary.files} HTML file(s). Folder readiness uses the lowest HTML file score${bundle.packageFindings?.length ? " adjusted by package dependency findings" : ""} and note scripts were not executed. RealityCheck did not upload source notes; when artifacts are enabled, this workflow stores the generated report with bounded evidence excerpts.`,
    "",
    `| ${zh ? "错误" : "Errors"} | ${zh ? "警告" : "Warnings"} | ${zh ? "建议" : "Advice"} | ${zh ? "安全副本修复" : "Safe-copy fixes"} |`,
    "| ---: | ---: | ---: | ---: |",
    `| ${counts.error ?? 0} | ${counts.warning ?? 0} | ${counts.advice ?? 0} | ${counts.autoFixable ?? 0} |`,
    "",
  ];
  if (htmlSelection.excludePatterns.length) {
    const visiblePatterns = htmlSelection.excludePatterns.slice(0, 10).map((pattern) => `\`${inlineCode(pattern)}\``).join(", ");
    const remainder = Math.max(0, htmlSelection.excludePatterns.length - 10);
    const visibleFiles = (htmlSelection.excludedFiles || []).slice(0, 10).map((path) => `\`${inlineCode(path)}\``).join(", ");
    const fileRemainder = Math.max(0, Number(htmlSelection.excludedCount || 0) - Math.min(10, (htmlSelection.excludedFiles || []).length));
    lines.push(zh
      ? `HTML 排除：${htmlSelection.excludePatterns.length} 条规则从逐文件检查中排除 ${htmlSelection.excludedCount} 个文件；这些文件仍是已知文件包条目和跨笔记目标，但不会运行其自身的逐文件规则。规则：${visiblePatterns}${remainder ? `（另有 ${remainder} 条）` : ""}`
      : `HTML exclusions: ${htmlSelection.excludePatterns.length} pattern(s) excluded ${htmlSelection.excludedCount} file(s) from per-file checks. They remain known package entries and cross-note targets, but their own per-file rules are not run. Patterns: ${visiblePatterns}${remainder ? ` (${remainder} more)` : ""}`, "");
    lines.push(zh
      ? `命中路径预览：${visibleFiles || "无"}${fileRemainder ? `（另有 ${fileRemainder} 个，完整清单见报告 JSON）` : "（完整清单见报告 JSON）"}`
      : `Matched path preview: ${visibleFiles || "none"}${fileRemainder ? ` (${fileRemainder} more; complete list in report JSON)` : " (complete list in report JSON)"}`, "");
  }
  if (comparison) {
    lines.push(zh ? "## 相较基线" : "## Changes since baseline", "");
    lines.push(`| ${zh ? "新增" : "New"} | ${zh ? "已解决" : "Resolved"} | ${zh ? "恶化" : "Worsened"} | ${zh ? "仍存在" : "Persistent"} | ${zh ? "未核验" : "Unverified"} |`);
    lines.push("| ---: | ---: | ---: | ---: | ---: |");
    lines.push(`| ${comparison.counts.new ?? 0} | ${comparison.counts.resolved ?? 0} | ${comparison.counts.worsened ?? 0} | ${comparison.counts.persistent ?? 0} | ${comparison.counts.unverified ?? 0} |`, "");
    lines.push(zh
      ? `门禁只评估新增、恶化和未核验回归，并保留 \`${comparison.gate?.failOn || "never"}\` 级别语义；${comparison.counts.persistent ?? 0} 项基线已知问题不会让任务永久失败。`
      : `The gate evaluates only new, worsened, and unverified regressions at the \`${comparison.gate?.failOn || "never"}\` threshold. ${comparison.counts.persistent ?? 0} persistent baseline finding(s) do not keep the job red.`, "");
    for (const warning of comparison.warnings || []) lines.push(`> ${markdown(localized(warning.message, language))}`, "");
  }
  if (findings.length) {
    lines.push(comparison ? (zh ? "## 需要处理的回归" : "## Regressions to address") : (zh ? "## 优先处理" : "## Prioritized findings"), "");
    for (const { scope, report, finding, state } of findings.slice(0, 20)) {
      const location = finding.evidence?.[0];
      const where = location ? `${location.path}:${location.line}` : scope === "package" ? (zh ? "文件包依赖" : "package dependencies") : report.path;
      const stateLabel = state ? `${state.toUpperCase()} · ` : "";
      lines.push(`- **${markdown(stateLabel + finding.level.toUpperCase())} · ${markdown(finding.id)}** — ${markdown(localized(finding.title, language))}  `);
      lines.push(`  \`${inlineCode(where)}\` · ${markdown(localized(finding.remediation, language))}`);
    }
    if (findings.length > 20) lines.push("", zh ? `其余 ${findings.length - 20} 项请查看上传的完整报告。` : `${findings.length - 20} additional finding(s) are available in the uploaded report.`);
  } else {
    lines.push(comparison
      ? (zh ? "没有新增、恶化或未核验的门禁回归；持续存在的基线问题不会重复生成注释。" : "No new, worsened, or unverified gating regressions were found; persistent baseline debt is not re-annotated.")
      : (zh ? "启用的确定性规则没有发现问题。" : "The enabled deterministic rules found no problems."));
  }
  lines.push("", comparison
    ? (zh ? "下载本任务的 RealityCheck artifact，打开 `comparison.html` 查看可切换中英文的差异证据，或打开 `latest.html` 查看当前完整报告。" : "Download this job's RealityCheck artifact and open `comparison.html` for bilingual change evidence or `latest.html` for the complete current report.")
    : (zh ? "下载本任务的 RealityCheck artifact，打开 `latest.html` 查看可切换中英文的完整报告。" : "Download this job's RealityCheck artifact and open `latest.html` for the complete bilingual report."), "");
  return `${lines.join("\n")}\n`;
}

export function buildNoteWorkflowAnnotations(bundle, language = "en", maxAnnotations = 20, sourceRoot = "") {
  validateBundle(bundle);
  if (!Number.isInteger(maxAnnotations) || maxAnnotations < 1 || maxAnnotations > 50) throw new Error("maxAnnotations must be an integer from 1 to 50");
  const normalizedRoot = text(sourceRoot, 300).replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (normalizedRoot.startsWith("/") || /^[A-Za-z]:\//.test(normalizedRoot) || normalizedRoot.split("/").includes("..")) throw new Error("sourceRoot must be a safe relative path");
  const annotations = [];
  const candidates = (comparisonFindings(bundle) || bundleFindings(bundle))
    .filter(({ finding }) => finding.level === "error" || finding.level === "warning")
    .sort((left, right) => LEVEL_ORDER[left.finding.level] - LEVEL_ORDER[right.finding.level]);
  for (const { report, finding, state } of candidates.slice(0, maxAnnotations)) {
    const evidence = finding.evidence?.[0];
    const reportPath = text(evidence?.path || report?.path || "", 300).replaceAll("\\", "/");
    const rawPath = reportPath && normalizedRoot && normalizedRoot !== "." ? `${normalizedRoot}/${reportPath}` : reportPath;
    const safePath = rawPath && !rawPath.startsWith("/") && !/^[A-Za-z]:\//.test(rawPath) && !rawPath.split("/").includes("..") ? rawPath : "";
    const line = Number.isInteger(evidence?.line) && evidence.line > 0 ? evidence.line : null;
    const properties = [];
    // Unverified comparisons may only retain a baseline location whose file is
    // absent or whose current package coverage is incomplete. Never turn that
    // stale evidence into a current-file GitHub annotation.
    const missingScope = state === "unverified";
    if (safePath && !missingScope) properties.push(`file=${commandValue(safePath, true)}`);
    if (line && !missingScope) properties.push(`line=${line}`);
    properties.push(`title=${commandValue(`RealityCheck${state ? ` ${state}` : ""} ${finding.id}`, true)}`);
    const message = `${state ? `${state.toUpperCase()}: ` : ""}${localized(finding.title, language)} — ${localized(finding.summary, language)}`;
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

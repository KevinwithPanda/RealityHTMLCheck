import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";

import { validateArtifactFiles } from "./artifact-validator.mjs";

const SEVERITY_ORDER = { critical: 0, major: 1, minor: 2, info: 3 };

function compact(value, maximum = 500) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, maximum);
}

function safeTarget(value) {
  try {
    const url = new URL(value);
    return compact(`${url.origin}${url.pathname}`, 240);
  } catch (_) {
    return "[invalid target]";
  }
}

function markdownCell(value) {
  return compact(value, 500)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "\\|");
}

function workflowData(value) {
  return compact(value, 1_000).replaceAll("::", ": :").replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function workflowProperty(value) {
  return workflowData(compact(value, 120)).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

export function workflowAnnotation(level, title, message) {
  if (!new Set(["error", "warning", "notice"]).has(level)) throw new Error(`Unsupported GitHub annotation level: ${level}`);
  return `::${level} title=${workflowProperty(title)}::${workflowData(message)}`;
}

function findingLanguage(finding, language) {
  if (language !== "zh-CN") return { title: finding.title, remediation: finding.remediation?.summary };
  const translated = finding.translations?.["zh-CN"] || {};
  return {
    title: translated.title || finding.title,
    remediation: translated.remediation?.summary || finding.remediation?.summary,
  };
}

function latestReports(records) {
  const selected = new Map();
  for (const record of records) {
    const key = record.report.target.requestedUrl;
    const current = selected.get(key);
    const timestamp = Date.parse(record.report.run.finishedAt || record.report.run.startedAt) || 0;
    const currentTimestamp = current ? Date.parse(current.report.run.finishedAt || current.report.run.startedAt) || 0 : -1;
    if (!current || timestamp > currentTimestamp || (timestamp === currentTimestamp && record.report.run.id > current.report.run.id)) selected.set(key, record);
  }
  return [...selected.values()].sort((left, right) => safeTarget(left.report.target.requestedUrl).localeCompare(safeTarget(right.report.target.requestedUrl)));
}

function annotationLevel(finding) {
  if (finding.confidence === "low" || finding.severity === "info") return "notice";
  if (finding.severity === "critical" || finding.severity === "major") return "error";
  return "warning";
}

function labels(language) {
  return language === "zh-CN" ? {
    heading: "RealityCheck 拉取请求摘要",
    lead: "仅汇总每个精确目标的最新有效报告；查询参数不会写入摘要或注释。",
    validated: "有效报告",
    targets: "最新目标",
    passing: "通过",
    failing: "失败",
    average: "平均评分",
    active: "有效问题",
    waived: "已豁免",
    annotations: "工作流注释",
    truncated: "因上限省略",
    reportHeading: "最新目标状态",
    state: "状态",
    score: "评分",
    target: "目标",
    findings: "有效 / 豁免",
    pass: "通过",
    fail: "失败",
    findingHeading: "优先问题",
    level: "注释",
    severity: "严重度",
    finding: "问题",
    owner: "负责人",
    proof: "验证要求",
    unassigned: "未分配",
    rerun: "复跑",
    none: "最新报告没有有效问题。",
    footer: "截图、测量值、修复任务和完整复测条件保留在上传的 RealityCheck 证据包中。",
  } : {
    heading: "RealityCheck pull-request summary",
    lead: "Only the latest valid report for each exact target is summarized; query values never enter summaries or annotations.",
    validated: "Validated reports",
    targets: "Latest targets",
    passing: "Passing",
    failing: "Failing",
    average: "Average score",
    active: "Active findings",
    waived: "Waived",
    annotations: "Workflow annotations",
    truncated: "Omitted by limit",
    reportHeading: "Latest target status",
    state: "State",
    score: "Score",
    target: "Target",
    findings: "Active / waived",
    pass: "PASS",
    fail: "FAIL",
    findingHeading: "Prioritized findings",
    level: "Annotation",
    severity: "Severity",
    finding: "Finding",
    owner: "Owner",
    proof: "Required proof",
    unassigned: "Unassigned",
    rerun: "rerun",
    none: "No active findings remain in the latest reports.",
    footer: "Screenshots, measurements, fix tasks, and complete retest conditions remain in the uploaded RealityCheck evidence bundle.",
  };
}

export function buildGitHubSummaryFromReports(records, { maxAnnotations = 20, language = "en" } = {}) {
  if (!Number.isInteger(maxAnnotations) || maxAnnotations < 1 || maxAnnotations > 50) throw new Error("maxAnnotations must be an integer from 1 to 50");
  if (!new Set(["en", "zh-CN"]).has(language)) throw new Error("language must be en or zh-CN");
  if (!Array.isArray(records) || !records.length) throw new Error("At least one validated page report is required");
  const latest = latestReports(records);
  const findingMap = new Map();
  let waived = 0;
  for (const record of latest) {
    for (const finding of record.report.findings) {
      if (finding.waiver) {
        waived += 1;
        continue;
      }
      const key = `${record.report.target.requestedUrl}\u0000${finding.fingerprint}`;
      if (!findingMap.has(key)) findingMap.set(key, { record, finding });
    }
  }
  const findings = [...findingMap.values()].sort((left, right) => {
    const severity = SEVERITY_ORDER[left.finding.severity] - SEVERITY_ORDER[right.finding.severity];
    if (severity) return severity;
    const confidence = { high: 0, medium: 1, low: 2 }[left.finding.confidence] - { high: 0, medium: 1, low: 2 }[right.finding.confidence];
    return confidence || left.finding.id.localeCompare(right.finding.id);
  });
  const candidates = [];
  for (const record of latest.filter(({ report }) => report.threshold.met)) {
    for (const violation of record.report.threshold.violations || []) {
      candidates.push({
        level: "error",
        title: `RealityCheck gate · ${compact(violation.code, 60)}`,
        message: `${safeTarget(record.report.target.requestedUrl)} scored ${record.report.score.overall}/100; ${compact(violation.code, 80)} measured ${violation.actual}, expected ${violation.expected}.`,
      });
    }
  }
  for (const item of findings) {
    const localized = findingLanguage(item.finding, language);
    candidates.push({
      level: annotationLevel(item.finding),
      title: `RealityCheck ${item.finding.severity.toUpperCase()} · ${compact(item.finding.ruleId, 70)}`,
      message: `${item.finding.id}: ${compact(localized.title, 300)}. Target ${safeTarget(item.record.report.target.requestedUrl)}; scenario ${compact(item.finding.scenarioId, 80)}; fix: ${compact(localized.remediation, 320)}.`,
      finding: item,
    });
  }
  if (!candidates.length) candidates.push({ level: "notice", title: "RealityCheck passed", message: `${latest.length} latest target report(s) passed with no active findings.` });
  const selectedCandidates = candidates.slice(0, maxAnnotations);
  const annotations = selectedCandidates.map((item) => workflowAnnotation(item.level, item.title, item.message));
  const scores = latest.map(({ report }) => report.score.overall);
  const failed = latest.filter(({ report }) => report.threshold.met).length;
  const summary = {
    validatedReports: records.length,
    latestTargets: latest.length,
    passingTargets: latest.length - failed,
    failingTargets: failed,
    averageScore: Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length),
    activeFindings: findings.length,
    waivedFindings: waived,
    annotations: annotations.length,
    truncatedAnnotations: Math.max(0, candidates.length - annotations.length),
  };
  const copy = labels(language);
  const lines = [
    `## ${copy.heading}`,
    "",
    copy.lead,
    "",
    `- ${copy.validated}: **${summary.validatedReports}** · ${copy.targets}: **${summary.latestTargets}** · ${copy.passing}: **${summary.passingTargets}** · ${copy.failing}: **${summary.failingTargets}**`,
    `- ${copy.average}: **${summary.averageScore}/100** · ${copy.active}: **${summary.activeFindings}** · ${copy.waived}: **${summary.waivedFindings}**`,
    `- ${copy.annotations}: **${summary.annotations}** · ${copy.truncated}: **${summary.truncatedAnnotations}**`,
    "",
    `### ${copy.reportHeading}`,
    "",
    `| ${copy.state} | ${copy.score} | ${copy.target} | ${copy.findings} |`,
    "| --- | ---: | --- | ---: |",
    ...latest.slice(0, 50).map(({ report }) => {
      const active = report.findings.filter((finding) => !finding.waiver).length;
      const reportWaived = report.findings.length - active;
      return `| ${report.threshold.met ? `❌ ${copy.fail}` : `✅ ${copy.pass}`} | ${report.score.overall}/100 | ${markdownCell(safeTarget(report.target.requestedUrl))} | ${active} / ${reportWaived} |`;
    }),
    "",
    `### ${copy.findingHeading}`,
    "",
  ];
  if (!findings.length) lines.push(copy.none, "");
  else {
    lines.push(`| ${copy.level} | ${copy.severity} | ${copy.finding} | ${copy.target} | ${copy.owner} | ${copy.proof} |`, "| --- | --- | --- | --- | --- | --- |");
    for (const item of findings.slice(0, maxAnnotations)) {
      const localized = findingLanguage(item.finding, language);
      const level = annotationLevel(item.finding);
      const owner = item.finding.ownership?.name || copy.unassigned;
      lines.push(`| ${level} | ${item.finding.severity} | **${markdownCell(item.finding.id)}** ${markdownCell(localized.title)} | ${markdownCell(safeTarget(item.record.report.target.requestedUrl))} | ${markdownCell(owner)} | ${copy.rerun} ${markdownCell(item.finding.scenarioId)} |`);
    }
    lines.push("");
  }
  lines.push(`_${copy.footer}_`, "");
  return { summary, annotations, markdown: `${lines.join("\n")}\n` };
}

export function buildGitHubSummary(inputPaths, options = {}) {
  const results = validateArtifactFiles(inputPaths);
  const invalid = results.filter((result) => !result.valid);
  if (invalid.length) {
    const first = invalid[0];
    throw new Error(`Cannot summarize invalid evidence ${relative(process.cwd(), first.path) || basename(first.path)}: ${first.errors.join("; ")}`);
  }
  const records = results.filter((result) => result.kind === "report").map((result) => ({ path: result.path, report: JSON.parse(readFileSync(result.path, "utf8")) }));
  if (!records.length) throw new Error("No validated page report.json artifacts were found");
  return buildGitHubSummaryFromReports(records, options);
}

export function writeGitHubSummary(result, outputPath) {
  const destination = resolve(outputPath);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, result.markdown, "utf8");
  return destination;
}

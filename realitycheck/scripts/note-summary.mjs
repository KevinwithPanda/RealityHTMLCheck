const LEVEL_WEIGHT = Object.freeze({ error: 7, warning: 2, advice: 1 });

function emptyCounts() {
  return { error: 0, warning: 0, advice: 0, autoFixable: 0 };
}

function normalizedAffectedCount(finding) {
  const value = Number(finding?.affectedCount ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Summarize cross-file and stylesheet findings without assigning them to an HTML file. */
export function summarizePackageFindings(findings = []) {
  if (!Array.isArray(findings)) throw new TypeError("findings must be an array");
  const counts = emptyCounts();
  let scoreDeduction = 0;
  for (const finding of findings) {
    const affectedCount = normalizedAffectedCount(finding);
    if (Object.hasOwn(counts, finding?.level)) counts[finding.level] += affectedCount;
    if (finding?.safeFix) counts.autoFixable += 1;
    scoreDeduction += (LEVEL_WEIGHT[finding?.level] ?? 0) * Math.min(affectedCount, 3);
  }
  return {
    findings: findings.length,
    affected: counts.error + counts.warning + counts.advice,
    scoreDeduction,
    status: counts.error ? "needs-fix" : counts.warning ? "review" : "ready",
    counts,
  };
}

/**
 * Build the shared decision summary used by the browser checker and CLI.
 * A folder is only as ready as its least-ready HTML file; averaging would let
 * many clean notes hide one broken note. Package findings then reduce that
 * baseline without pretending that CSS or cross-note evidence belongs to one
 * arbitrary HTML file.
 */
export function summarizeNoteReports(reports, packageInput = []) {
  if (!Array.isArray(reports)) throw new TypeError("reports must be an array");
  const packageSummary = Array.isArray(packageInput) ? summarizePackageFindings(packageInput) : packageInput;
  if (!packageSummary || typeof packageSummary !== "object" || !packageSummary.counts) throw new TypeError("package summary must contain counts");
  const counts = emptyCounts();
  for (const report of reports) {
    for (const key of Object.keys(counts)) counts[key] += Number(report?.counts?.[key] ?? 0);
  }
  for (const key of Object.keys(counts)) counts[key] += Number(packageSummary.counts[key] ?? 0);
  const lowestFileScore = reports.length ? Math.min(...reports.map((report) => Number(report.score))) : 0;
  const packageDeduction = Math.max(0, Number(packageSummary.scoreDeduction) || 0);
  const score = lowestFileScore - packageDeduction;
  const status = counts.error ? "needs-fix" : counts.warning ? "review" : "ready";
  return {
    files: reports.length,
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
    scoreBasis: "lowest-file",
    lowestFileScore: Number.isFinite(lowestFileScore) ? Math.max(0, Math.min(100, Math.round(lowestFileScore))) : 0,
    packageDeduction,
    status,
    counts,
  };
}

/** Build a repair handoff for dependency evidence without naming an arbitrary HTML file. */
export function buildPackageRepairTask(findings, language = "zh-CN") {
  if (!Array.isArray(findings)) throw new TypeError("findings must be an array");
  const zh = language === "zh-CN";
  const active = findings.filter((finding) => finding.level !== "advice");
  const lines = zh
    ? ["请修复所选 HTML 笔记文件包中的以下依赖问题。证据可能位于 CSS 或互相链接的 HTML 文件中；请按证据路径修改，不要假定问题属于第一个 HTML。保留原始内容含义，并先备份或生成差异。", ""]
    : ["Repair the following package-level dependencies in the selected HTML note folder. Evidence may point to CSS or linked HTML files; edit the evidence path rather than assuming the first HTML file owns the problem. Preserve the original meaning and create a backup or diff first.", ""];
  for (const finding of active) {
    lines.push(`- [${finding.id}] ${zh ? finding.title.zhCN : finding.title.en}`);
    lines.push(`  ${zh ? "建议" : "Remediation"}: ${zh ? finding.remediation.zhCN : finding.remediation.en}`);
    for (const item of (finding.evidence || []).slice(0, 3)) lines.push(`  ${item.path}:${item.line} — ${item.excerpt}`);
  }
  lines.push("");
  lines.push(zh ? "完成后重新检查整个文件夹，并确认相关依赖问题消失且没有新增问题。" : "Rerun the check on the whole folder and confirm the dependency findings are gone with no new problems.");
  return lines.join("\n");
}

export function noteDecision(status) {
  if (status === "needs-fix") return {
    tone: "blocked",
    label: { en: "SHARING DECISION", zhCN: "分享判断" },
    title: { en: "Do not share yet", zhCN: "暂不建议分享" },
    detail: {
      en: "At least one deterministic error remains. Fix the first affected item below, then check again.",
      zhCN: "仍有至少一项确定性错误。请先修复下方最前面的受影响项，再重新检查。",
    },
  };
  if (status === "review") return {
    tone: "review",
    label: { en: "SHARING DECISION", zhCN: "分享判断" },
    title: { en: "Review before sharing", zhCN: "分享前请复核" },
    detail: {
      en: "No deterministic error was found, but one or more warnings still need human judgment.",
      zhCN: "本次未发现确定性错误，但仍有一项或多项警告需要人工判断。",
    },
  };
  return {
    tone: "ready",
    label: { en: "SHARING DECISION", zhCN: "分享判断" },
    title: { en: "No blockers found", zhCN: "本次检查未发现阻断项" },
    detail: {
      en: "The enabled rules found no errors or warnings. Factual accuracy and intended meaning still need human review.",
      zhCN: "启用的规则未发现错误或警告；事实准确性与原意仍需人工确认。",
    },
  };
}

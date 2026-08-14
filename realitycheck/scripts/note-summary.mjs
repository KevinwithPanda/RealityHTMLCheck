/**
 * Build the shared decision summary used by the browser checker and CLI.
 * A folder is only as ready as its least-ready HTML file; averaging would let
 * many clean notes hide one broken note.
 */
export function summarizeNoteReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError("reports must be an array");
  const counts = { error: 0, warning: 0, advice: 0, autoFixable: 0 };
  for (const report of reports) {
    for (const key of Object.keys(counts)) counts[key] += Number(report?.counts?.[key] ?? 0);
  }
  const score = reports.length ? Math.min(...reports.map((report) => Number(report.score))) : 0;
  const status = counts.error ? "needs-fix" : counts.warning ? "review" : "ready";
  return {
    files: reports.length,
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
    scoreBasis: "lowest-file",
    status,
    counts,
  };
}

export function noteDecision(status) {
  if (status === "needs-fix") return {
    tone: "blocked",
    label: { en: "SHARING DECISION", zhCN: "分享判断" },
    title: { en: "Do not share yet", zhCN: "暂不建议分享" },
    detail: {
      en: "At least one deterministic error remains. Fix the first affected file below, then check again.",
      zhCN: "仍有至少一项确定性错误。请先修复下方最前面的受影响文件，再重新检查。",
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

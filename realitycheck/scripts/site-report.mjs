import { mkdirSync, writeFileSync } from "node:fs";
import { TOOL_VERSION } from "./version.mjs";

function html(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function markdown(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function severityCounts(findings = []) {
  const counts = { critical: 0, major: 0, minor: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] = (counts[finding.severity] || 0) + 1;
  return counts;
}

function scenarioStatusCounts(scenarios = []) {
  const counts = { passed: 0, "completed-with-findings": 0, skipped: 0, unsupported: 0, failed: 0 };
  for (const scenario of scenarios) counts[scenario.status] = (counts[scenario.status] || 0) + 1;
  return counts;
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    if (url.search) url.search = "?redacted";
    url.hash = "";
    return url.toString();
  } catch (_) {
    return "[invalid URL]";
  }
}

export function sanitizeOperationalError(value) {
  return String(value ?? "Unknown page audit failure")
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => safeUrl(url))
    .replace(/\b[A-Za-z]:\\[^\s"'<>]+/g, "[local path]")
    .replace(/\/(?:Users|home)\/[^\s"'<>]+/g, "[local path]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted token]")
    .slice(0, 500);
}

export function buildSiteReport({ id, baseUrl, mode, failOn, startedAt, finishedAt, pages, discovery }) {
  const completed = pages.filter((page) => page.status === "completed");
  const failed = pages.filter((page) => page.status === "failed");
  const scores = completed.map((page) => page.report.score.overall);
  const counts = { critical: 0, major: 0, minor: 0, info: 0 };
  let passedScenarios = 0;
  let coveredScenarios = 0;
  let waivedFindings = 0;
  let gateViolations = 0;
  for (const page of completed) {
    const pageCounts = severityCounts(page.report.findings);
    for (const severity of Object.keys(counts)) counts[severity] += pageCounts[severity];
    waivedFindings += page.report.findings.filter((finding) => finding.waiver && finding.classification !== "resolved").length;
    gateViolations += page.report.threshold.violations?.length || 0;
    for (const scenario of page.report.scenarios) {
      if (["passed", "completed-with-findings"].includes(scenario.status)) coveredScenarios += 1;
      if (scenario.status === "passed") passedScenarios += 1;
    }
  }
  const gateFailed = failed.length > 0 || completed.some((page) => page.report.threshold.met);
  const policyFingerprints = [...new Set(completed.map((page) => page.report.config?.policyFingerprint).filter(Boolean))];
  return {
    schemaVersion: "1",
    toolVersion: TOOL_VERSION,
    kind: "site-audit",
    ...(policyFingerprints.length === 1 ? { policyFingerprint: policyFingerprints[0] } : {}),
    id,
    baseUrl: safeUrl(baseUrl),
    mode,
    failOn,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, new Date(finishedAt) - new Date(startedAt)),
    discovery,
    summary: {
      pagesRequested: pages.length,
      pagesCompleted: completed.length,
      pagesFailed: failed.length,
      averageScore: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0,
      minimumScore: scores.length ? Math.min(...scores) : 0,
      gateFailed,
      findings: counts,
      waivedFindings,
      gateViolations,
      scenariosCovered: coveredScenarios,
      scenariosPassed: passedScenarios,
    },
    pages: pages.map((page) => {
      if (page.status === "failed") return { url: safeUrl(page.url), status: page.status, error: sanitizeOperationalError(page.error) };
      const report = page.report;
      return {
        url: report.target.requestedUrl,
        finalUrl: report.target.finalUrl,
        title: report.target.title,
        status: "completed",
        score: report.score.overall,
        gateFailed: report.threshold.met,
        gateViolations: report.threshold.violations || [],
        findings: severityCounts(report.findings),
        waivedFindings: report.findings.filter((finding) => finding.waiver && finding.classification !== "resolved").length,
        owners: [...new Set(report.findings.map((finding) => finding.ownership?.name).filter(Boolean))].sort(),
        scenarioCounts: scenarioStatusCounts(report.scenarios),
        scenarioStatuses: Object.fromEntries(report.scenarios.map((scenario) => [scenario.id, scenario.status])),
        findingDetails: report.findings.filter((finding) => finding.classification !== "resolved").map((finding) => ({
          id: finding.id,
          fingerprint: finding.fingerprint,
          ruleId: finding.ruleId,
          scenarioId: finding.scenarioId,
          severity: finding.severity,
          confidence: finding.confidence,
          title: finding.title,
          translations: finding.translations ? { "zh-CN": { title: finding.translations["zh-CN"]?.title || finding.title } } : undefined,
          waiver: finding.waiver,
          ownership: finding.ownership,
        })),
        reportPath: page.reportPath,
      };
    }),
  };
}

export function renderSiteMarkdown(site, outputPath) {
  const lines = [
    "# RealityCheck site audit",
    "",
    `- Base URL: ${markdown(site.baseUrl)}`,
    `- Mode: ${site.mode}`,
    `- Quality gate: ${site.summary.gateFailed ? "FAILED" : "PASSED"} at ${site.failOn}`,
    `- Pages: ${site.summary.pagesCompleted} completed / ${site.summary.pagesFailed} failed`,
    `- Score: ${site.summary.averageScore} average / ${site.summary.minimumScore} minimum`,
    `- Findings: ${site.summary.findings.critical} critical, ${site.summary.findings.major} major, ${site.summary.findings.minor} minor`,
    "",
    "| Page | Score | Gate | Reasons | Coverage | Critical | Major | Minor | Waived | Report |",
    "|---|---:|---|---:|---:|---:|---:|---:|---:|---|",
  ];
  for (const page of site.pages) {
    if (page.status === "failed") {
      lines.push(`| ${markdown(page.url)} | — | ERROR | — | — | — | — | — | — | ${markdown(page.error)} |`);
      continue;
    }
    const href = page.reportPath;
    const covered = page.scenarioCounts.passed + page.scenarioCounts["completed-with-findings"];
    const total = Object.values(page.scenarioCounts).reduce((sum, count) => sum + count, 0);
    lines.push(`| ${markdown(page.title || page.url)} | ${page.score} | ${page.gateFailed ? "FAILED" : "PASSED"} | ${page.gateViolations?.length || 0} | ${covered}/${total} | ${page.findings.critical} | ${page.findings.major} | ${page.findings.minor} | ${page.waivedFindings || 0} | [Open](${href}) |`);
  }
  if (site.discovery.warnings.length) {
    lines.push("", "## Discovery warnings", "", ...site.discovery.warnings.map((warning) => `- ${markdown(warning)}`));
  }
  return `${lines.join("\n")}\n`;
}

export function renderSiteHtml(site, outputPath) {
  const pageCards = site.pages.map((page) => {
    if (page.status === "failed") return `
      <article class="page-card failed" data-state="failed">
        <div class="page-top"><span class="status bad" data-en="Could not audit" data-zh="无法核查">Could not audit</span></div>
        <h3>${html(page.url)}</h3><p class="error">${html(page.error)}</p>
      </article>`;
    const href = page.reportPath;
    const covered = page.scenarioCounts.passed + page.scenarioCounts["completed-with-findings"];
    const total = Object.values(page.scenarioCounts).reduce((sum, count) => sum + count, 0);
    const owners = page.owners?.length ? `<p class="owners"><span data-en="Accountable" data-zh="负责团队">Accountable</span>: ${page.owners.map(html).join(", ")}</p>` : "";
    return `
      <article class="page-card" data-state="${page.gateFailed ? "failed" : "passed"}" data-score="${page.score}">
        <div class="page-top">
          <span class="score ${page.score >= 90 ? "good" : page.score >= 75 ? "warn" : "bad"}">${page.score}</span>
          <span class="status ${page.gateFailed ? "bad" : "good"}" data-en="${page.gateFailed ? "Gate failed" : "Gate passed"}" data-zh="${page.gateFailed ? "门禁失败" : "门禁通过"}">${page.gateFailed ? "Gate failed" : "Gate passed"}</span>
        </div>
        <h3>${html(page.title || "Untitled page")}</h3>
        <p class="url">${html(page.url)}</p>
        ${owners}
        <div class="finding-counts">
          <span><b>${covered}/${total}</b> <span data-en="Covered" data-zh="已覆盖">Covered</span></span><span><b>${page.findings.critical}</b> <span data-en="Critical" data-zh="严重">Critical</span></span><span><b>${page.findings.major}</b> <span data-en="Major" data-zh="主要">Major</span></span><span><b>${page.findings.minor}</b> <span data-en="Minor" data-zh="次要">Minor</span></span><span><b>${page.waivedFindings || 0}</b> <span data-en="Waived" data-zh="已豁免">Waived</span></span><span><b>${page.gateViolations?.length || 0}</b> <span data-en="Gate reasons" data-zh="门禁原因">Gate reasons</span></span>
        </div>
        <a class="open-report" href="${html(href)}" data-en="Open evidence report →" data-zh="打开证据报告 →">Open evidence report →</a>
      </article>`;
  }).join("");
  const warnings = site.discovery.warnings.map((warning) => `<li>${html(warning)}</li>`).join("");
  const gateClass = site.summary.gateFailed ? "bad" : "good";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>RealityCheck site audit</title><style>
:root{color-scheme:light;--ink:#17181c;--muted:#696b73;--line:#e5e0d7;--paper:#fffdfa;--canvas:#f4f1eb;--accent:#ff5c35;--good:#13795b;--bad:#bd2840;--warn:#a25b00;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;color:var(--ink);background:var(--canvas)}.topbar{color:#fff;background:#17181c}.topbar-inner,.container{width:min(1180px,calc(100% - 40px));margin:auto}.topbar-inner{min-height:68px;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{font-weight:850;letter-spacing:-.02em}.language{display:flex;padding:3px;border:1px solid #3d3e45;border-radius:9px}.language button{border:0;border-radius:6px;padding:6px 10px;color:#b8bac2;background:transparent;font:700 12px inherit;cursor:pointer}.language button[aria-pressed=true]{color:#17181c;background:#fff}.hero{padding:56px 0 35px}.eyebrow{color:var(--accent);font-size:12px;font-weight:850;letter-spacing:.12em;text-transform:uppercase}h1{max-width:820px;margin:10px 0 15px;font-size:clamp(36px,6vw,68px);line-height:.98;letter-spacing:-.055em}.lede{max-width:780px;color:var(--muted);line-height:1.65}.gate{display:inline-flex;margin-top:18px;padding:8px 12px;border:1px solid var(--line);border-radius:999px;background:var(--paper);font-size:12px;font-weight:800}.gate.good{color:var(--good)}.gate.bad{color:var(--bad)}.stats{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:48px}.stat{padding:18px;border:1px solid var(--line);border-radius:15px;background:var(--paper)}.stat span{display:block;color:var(--muted);font-size:11px;font-weight:760;text-transform:uppercase}.stat b{display:block;margin-top:8px;font-size:28px;letter-spacing:-.04em}.toolbar{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:16px}.toolbar h2{margin:0;font-size:28px}.filters{display:flex;gap:7px}.filters button{border:1px solid var(--line);border-radius:8px;padding:7px 10px;background:var(--paper);font:700 12px inherit;cursor:pointer}.filters button[aria-pressed=true]{color:#fff;background:#25262b}.pages{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.page-card{min-width:0;padding:22px;border:1px solid var(--line);border-radius:18px;background:var(--paper);box-shadow:0 10px 28px rgb(42 35 25 / 4%)}.page-card[hidden]{display:none}.page-card.failed{border-color:#efbcc5}.page-top{display:flex;align-items:center;justify-content:space-between;gap:12px}.score{width:54px;height:54px;display:grid;place-items:center;border-radius:50%;color:#fff;background:#777;font-size:21px;font-weight:850}.score.good{background:var(--good)}.score.warn{background:var(--warn)}.score.bad{background:var(--bad)}.status{padding:6px 9px;border-radius:999px;background:#eee;font-size:10px;font-weight:850;text-transform:uppercase}.status.good{color:var(--good);background:#e4f4ee}.status.bad{color:var(--bad);background:#ffe5ea}.page-card h3{margin:18px 0 7px;font-size:21px}.url{margin:0;color:var(--muted);font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.finding-counts{display:flex;flex-wrap:wrap;gap:8px 17px;margin:20px 0;color:var(--muted);font-size:12px}.finding-counts b{color:var(--ink)}.open-report{display:inline-flex;color:#1f2025;font-size:13px;font-weight:800;text-underline-offset:3px}.error{color:var(--bad);line-height:1.55}.warnings{margin:44px 0;padding:22px;border:1px solid var(--line);border-radius:15px;background:var(--paper)}.warnings h2{margin-top:0}.warnings li{margin:7px 0;color:var(--muted);line-height:1.5}.metadata{padding:32px 0 50px;color:var(--muted);font:11px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}@media(max-width:850px){.stats{grid-template-columns:repeat(3,1fr)}.pages{grid-template-columns:1fr}}@media(max-width:560px){.topbar-inner,.container{width:min(100% - 24px,1180px)}.hero{padding-top:38px}.stats{grid-template-columns:repeat(2,1fr)}.toolbar{align-items:start;flex-direction:column}.page-card{padding:18px}}
</style></head><body><header class="topbar"><div class="topbar-inner"><div class="brand">RealityCheck / SITE AUDIT</div><div class="language" aria-label="Report language"><button type="button" data-language="en" aria-pressed="true">EN</button><button type="button" data-language="zh" aria-pressed="false">中文</button></div></div></header>
<main class="container"><section class="hero"><p class="eyebrow" data-en="PROJECT-WIDE EVIDENCE" data-zh="项目级证据">PROJECT-WIDE EVIDENCE</p><h1 data-en="Which page will break your release?" data-zh="哪一个页面会拖垮这次发布？">Which page will break your release?</h1><p class="lede" data-en="Every page below was opened in a real browser and received its own isolated scenario evidence." data-zh="下面每个页面都在真实浏览器中打开，并获得各自独立的场景证据。">Every page below was opened in a real browser and received its own isolated scenario evidence.</p><span class="gate ${gateClass}" data-en="Quality gate ${site.summary.gateFailed ? "FAILED" : "PASSED"} · ${html(site.failOn)}" data-zh="质量门禁${site.summary.gateFailed ? "失败" : "通过"} · ${html(site.failOn)}">Quality gate ${site.summary.gateFailed ? "FAILED" : "PASSED"} · ${html(site.failOn)}</span></section>
<section class="stats" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))"><div class="stat"><span data-en="Pages" data-zh="页面">Pages</span><b>${site.summary.pagesCompleted}/${site.summary.pagesRequested}</b></div><div class="stat"><span data-en="Average" data-zh="平均分">Average</span><b>${site.summary.averageScore}</b></div><div class="stat"><span data-en="Minimum" data-zh="最低分">Minimum</span><b>${site.summary.minimumScore}</b></div><div class="stat"><span data-en="Critical" data-zh="严重">Critical</span><b>${site.summary.findings.critical}</b></div><div class="stat"><span data-en="Major" data-zh="主要">Major</span><b>${site.summary.findings.major}</b></div><div class="stat"><span data-en="Minor" data-zh="次要">Minor</span><b>${site.summary.findings.minor}</b></div><div class="stat"><span data-en="Waived" data-zh="已豁免">Waived</span><b>${site.summary.waivedFindings || 0}</b></div><div class="stat"><span data-en="Gate reasons" data-zh="门禁原因">Gate reasons</span><b>${site.summary.gateViolations || 0}</b></div></section>
<section><div class="toolbar"><div><p class="eyebrow" data-en="PAGE RESULTS" data-zh="页面结果">PAGE RESULTS</p><h2 data-en="Evidence by route" data-zh="逐路由证据">Evidence by route</h2></div><div class="filters" aria-label="Filter pages"><button type="button" data-filter="all" aria-pressed="true" data-en="All" data-zh="全部">All</button><button type="button" data-filter="failed" aria-pressed="false" data-en="Needs work" data-zh="需修复">Needs work</button><button type="button" data-filter="passed" aria-pressed="false" data-en="Passed" data-zh="已通过">Passed</button></div></div><div class="pages">${pageCards}</div></section>
${warnings ? `<section class="warnings"><h2 data-en="Discovery warnings" data-zh="发现过程警告">Discovery warnings</h2><ul>${warnings}</ul></section>` : ""}
<footer class="metadata">Run ${html(site.id)} · ${html(site.mode)} · ${html(site.startedAt)} → ${html(site.finishedAt)}<br>${html(site.baseUrl)}</footer></main>
<script>(()=>{const setLanguage=lang=>{document.documentElement.lang=lang==='zh'?'zh-CN':'en';document.querySelectorAll('[data-en][data-zh]').forEach(el=>{el.textContent=el.dataset[lang]});document.querySelectorAll('[data-language]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.language===lang)))};document.querySelectorAll('[data-language]').forEach(button=>button.addEventListener('click',()=>setLanguage(button.dataset.language)));document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{const filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));document.querySelectorAll('.page-card').forEach(card=>card.hidden=filter!=='all'&&card.dataset.state!==filter)}))})();</script></body></html>`;
}

export function writeSiteReport(site, outputDirectory) {
  mkdirSync(outputDirectory, { recursive: true });
  const jsonPath = `${outputDirectory}/site-report.json`;
  const markdownPath = `${outputDirectory}/site-report.md`;
  const htmlPath = `${outputDirectory}/site-report.html`;
  writeFileSync(jsonPath, `${JSON.stringify(site, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, renderSiteMarkdown(site, markdownPath), "utf8");
  writeFileSync(htmlPath, renderSiteHtml(site, htmlPath), "utf8");
  return { jsonPath, markdownPath, htmlPath };
}

const SEVERITY_RANK = { info: 0, minor: 1, major: 2, critical: 3 };
const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 };

function pageKey(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch (_) {
    return url;
  }
}

function findingMeetsThreshold(finding, failOn) {
  return failOn !== "never" && !finding.waiver && finding.confidence !== "low" && SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[failOn];
}

function comparisonFinding(page, finding, previous = null) {
  const value = {
    page: page.url,
    pageTitle: page.title,
    id: finding.id,
    fingerprint: finding.fingerprint,
    ruleId: finding.ruleId,
    scenarioId: finding.scenarioId,
    severity: finding.severity,
    confidence: finding.confidence,
    title: finding.title,
  };
  if (finding.translations) value.translations = finding.translations;
  if (finding.waiver) value.waiver = finding.waiver;
  if (finding.ownership) value.ownership = finding.ownership;
  if (previous) {
    value.previousSeverity = previous.severity;
    value.previousConfidence = previous.confidence;
  }
  return value;
}

export function compareSiteReports(before, after, { regressionsOnly = false, failOn = after.failOn, maxBaselineAgeDays = null, requireSamePolicy = false } = {}) {
  if (pageKey(before.baseUrl) !== pageKey(after.baseUrl)) throw new Error("Site reports must use the same base URL path");
  const beforePages = new Map(before.pages.map((page) => [pageKey(page.url), page]));
  const afterPages = new Map(after.pages.map((page) => [pageKey(page.url), page]));
  const resolved = [];
  const remaining = [];
  const worsened = [];
  const added = [];
  const unverified = [];
  const failedPages = after.pages.filter((page) => page.status === "failed").map((page) => ({ url: page.url, error: page.error }));
  for (const [key, page] of afterPages) {
    if (page.status !== "completed") continue;
    const beforePage = beforePages.get(key);
    const afterFindings = new Map((page.findingDetails || []).map((finding) => [finding.fingerprint, finding]));
    if (!beforePage || beforePage.status !== "completed") {
      for (const finding of afterFindings.values()) added.push(comparisonFinding(page, finding));
      continue;
    }
    const beforeFindings = new Map((beforePage.findingDetails || []).map((finding) => [finding.fingerprint, finding]));
    const completedScenarios = new Set(Object.entries(page.scenarioStatuses || {}).filter(([, status]) => ["passed", "completed-with-findings"].includes(status)).map(([id]) => id));
    for (const [fingerprint, beforeFinding] of beforeFindings) {
      const afterFinding = afterFindings.get(fingerprint);
      if (!afterFinding) {
        const item = comparisonFinding(beforePage, beforeFinding);
        if (completedScenarios.has(beforeFinding.scenarioId)) resolved.push(item);
        else unverified.push(item);
        continue;
      }
      const isWorse = SEVERITY_RANK[afterFinding.severity] > SEVERITY_RANK[beforeFinding.severity]
        || CONFIDENCE_RANK[afterFinding.confidence] > CONFIDENCE_RANK[beforeFinding.confidence];
      if (isWorse) worsened.push(comparisonFinding(page, afterFinding, beforeFinding));
      else remaining.push(comparisonFinding(page, afterFinding));
    }
    for (const [fingerprint, afterFinding] of afterFindings) {
      if (!beforeFindings.has(fingerprint)) added.push(comparisonFinding(page, afterFinding));
    }
  }
  const removedPages = [...beforePages.entries()].filter(([key]) => !afterPages.has(key)).map(([, page]) => ({ url: page.url, title: page.title || "" }));
  const newPages = [...afterPages.entries()].filter(([key]) => !beforePages.has(key)).map(([, page]) => ({ url: page.url, title: page.title || "", status: page.status }));
  const regressionCandidates = [...added, ...worsened, ...unverified];
  const activeCandidates = regressionsOnly ? regressionCandidates : [...(after.pages.flatMap((page) => page.findingDetails || [])), ...unverified];
  const policyViolations = after.pages.flatMap((page) => (page.gateViolations || [])
    .filter((violation) => violation.code !== "severity-threshold")
    .map((violation) => ({ page: page.url, ...violation })));
  let baselineAgeDays = null;
  if (maxBaselineAgeDays !== null) {
    baselineAgeDays = Math.round(Math.max(0, (new Date(after.startedAt) - new Date(before.finishedAt)) / 86_400_000) * 10) / 10;
    if (baselineAgeDays > maxBaselineAgeDays) policyViolations.push({ page: after.baseUrl, code: "baseline-age", actual: baselineAgeDays, expected: maxBaselineAgeDays });
  }
  if (requireSamePolicy && (!before.policyFingerprint || !after.policyFingerprint || before.policyFingerprint !== after.policyFingerprint)) {
    policyViolations.push({ page: after.baseUrl, code: "policy-drift", actual: 1, expected: 0 });
  }
  const gateFailed = failedPages.length > 0 || policyViolations.length > 0 || activeCandidates.some((finding) => findingMeetsThreshold(finding, failOn));
  return {
    schemaVersion: "1",
    toolVersion: after.toolVersion,
    kind: "site-verification",
    before: {
      id: before.id,
      averageScore: before.summary.averageScore,
      minimumScore: before.summary.minimumScore,
      startedAt: before.startedAt,
      finishedAt: before.finishedAt,
      mode: before.mode,
      toolVersion: before.toolVersion,
      ...(before.policyFingerprint ? { policyFingerprint: before.policyFingerprint } : {}),
    },
    after: {
      id: after.id,
      averageScore: after.summary.averageScore,
      minimumScore: after.summary.minimumScore,
      startedAt: after.startedAt,
      finishedAt: after.finishedAt,
      mode: after.mode,
      toolVersion: after.toolVersion,
      ...(after.policyFingerprint ? { policyFingerprint: after.policyFingerprint } : {}),
    },
    scoreDelta: after.summary.averageScore - before.summary.averageScore,
    counts: { resolved: resolved.length, remaining: remaining.length, worsened: worsened.length, new: added.length, unverified: unverified.length, failedPages: failedPages.length, newPages: newPages.length, removedPages: removedPages.length },
    resolved,
    remaining,
    worsened,
    new: added,
    unverified,
    failedPages,
    newPages,
    removedPages,
    policyViolations,
    threshold: {
      failOn,
      scope: regressionsOnly ? "regressions-only" : "all-active-findings",
      met: gateFailed,
      ...(baselineAgeDays !== null ? { baselineAgeDays, maximumBaselineAgeDays: maxBaselineAgeDays } : {}),
      ...(requireSamePolicy ? { beforePolicyFingerprint: before.policyFingerprint || null, afterPolicyFingerprint: after.policyFingerprint || null } : {}),
    },
  };
}

export function renderSiteVerificationMarkdown(value) {
  const lines = [
    "# RealityCheck site verification",
    "",
    `- Average score: ${value.before.averageScore}/100 → ${value.after.averageScore}/100 (${value.scoreDelta >= 0 ? "+" : ""}${value.scoreDelta})`,
    `- Minimum score: ${value.before.minimumScore}/100 → ${value.after.minimumScore}/100`,
    `- Gate: ${value.threshold.met ? "FAILED" : "PASSED"} · ${value.threshold.scope} · ${value.threshold.failOn}`,
    `- Detector context: ${value.before.mode || "unknown"} / ${value.before.toolVersion || "unknown"} → ${value.after.mode || "unknown"} / ${value.after.toolVersion || "unknown"}`,
    ...(value.threshold.baselineAgeDays !== undefined ? [`- Baseline age: ${value.threshold.baselineAgeDays} day(s) · maximum ${value.threshold.maximumBaselineAgeDays}`] : []),
    `- Resolved: ${value.counts.resolved} · Remaining: ${value.counts.remaining} · Worsened: ${value.counts.worsened} · New: ${value.counts.new} · Unverified: ${value.counts.unverified}`,
    "",
  ];
  if (value.policyViolations?.length) {
    lines.push("## Release policy violations", "", ...value.policyViolations.map((item) => `- ${markdown(item.page)} · ${item.code}: ${item.actual} vs ${item.expected}`), "");
  }
  for (const [key, label] of [["worsened", "Worsened"], ["new", "New regressions"], ["unverified", "Unverified"], ["resolved", "Resolved"]]) {
    lines.push(`## ${label}`, "");
    if (!value[key].length) lines.push("- None");
    else for (const item of value[key]) lines.push(`- **${item.id}** · ${item.severity} · ${markdown(item.page)} — ${markdown(item.title)}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function renderSiteVerificationHtml(value) {
  const sections = [["worsened", "Worsened", "恶化"], ["new", "New regressions", "新增回归"], ["unverified", "Unverified", "未验证"], ["resolved", "Resolved", "已解决"]].map(([key, en, zh]) => {
    const items = value[key].map((item) => `<li><code>${html(item.id)}</code><div><strong>${html(item.title)}</strong><small>${html(item.page)} · ${html(item.severity)} · ${html(item.scenarioId)}</small></div></li>`).join("") || `<p class="none" data-en="None" data-zh="无">None</p>`;
    return `<section><h2 data-en="${html(en)}" data-zh="${html(zh)}">${html(en)}</h2>${items.startsWith("<li") ? `<ul>${items}</ul>` : items}</section>`;
  }).join("");
  const policyItems = (value.policyViolations || []).map((item) => `<li><code>${html(item.code)}</code><div><strong>${html(item.actual)} vs ${html(item.expected)}</strong><small>${html(item.page)}</small></div></li>`).join("");
  const policySection = policyItems ? `<section><h2 data-en="Release policy violations" data-zh="发布策略违规">Release policy violations</h2><ul>${policyItems}</ul></section>` : "";
  const passed = !value.threshold.met;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>RealityCheck site verification</title><style>:root{color-scheme:light;--ink:#17181d;--muted:#686c75;--line:#e4dfd7;--paper:#fffdfa;--canvas:#f4f1eb;--accent:#ff5c35;--good:#13795b;--bad:#c72c41;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;color:var(--ink);background:var(--canvas)}header,main{width:min(980px,calc(100% - 32px));margin:auto}header{min-height:68px;display:flex;align-items:center;justify-content:space-between}.brand{font-weight:850}.languages{display:flex;padding:3px;border:1px solid var(--line);border-radius:9px;background:#fff}button{border:0;border-radius:6px;padding:6px 10px;background:transparent;font:700 12px inherit;cursor:pointer}button[aria-pressed=true]{color:#fff;background:#25262b}.hero{padding:45px;border-radius:23px;color:#fff;background:#15161b}.eyebrow{margin:0 0 10px;color:#ff9b82;font-size:12px;font-weight:850;letter-spacing:.1em}h1{margin:0;font-size:clamp(35px,7vw,66px);letter-spacing:-.055em}.score{display:flex;flex-wrap:wrap;align-items:baseline;gap:12px 20px;margin-top:20px}.score strong{font-size:clamp(25px,5vw,42px)}.gate{margin-inline-start:auto;color:${passed ? "#8ff0bd" : "#ffb19d"};font-weight:850}.metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:16px 0}.metric,section{border:1px solid var(--line);border-radius:15px;background:var(--paper)}.metric{padding:17px}.metric b{display:block;font-size:29px}.metric span{color:var(--muted);font-size:11px}section{margin:11px 0;padding:21px}section h2{margin-top:0}ul{display:grid;gap:8px;margin:0;padding:0;list-style:none}li{display:grid;grid-template-columns:auto 1fr;gap:12px;padding:12px;border-radius:10px;background:#f5f3ef}li div{display:grid;gap:4px;min-width:0}code{color:#9d341d;font-size:11px}small,.none{color:var(--muted);overflow-wrap:anywhere}.note{margin:18px 0 40px;color:#565b68;line-height:1.5}@media(max-width:680px){.hero{padding:28px}.metrics{grid-template-columns:repeat(2,1fr)}.gate{width:100%;margin:0}li{grid-template-columns:1fr}}</style></head><body><header><div class="brand">RealityCheck / SITE PROOF</div><div class="languages"><button data-language="en" aria-pressed="true">EN</button><button data-language="zh" aria-pressed="false">中文</button></div></header><main><div class="hero"><p class="eyebrow" data-en="PROJECT-WIDE BEFORE / AFTER" data-zh="项目级修复前后">PROJECT-WIDE BEFORE / AFTER</p><h1 data-en="Did the whole site get safer?" data-zh="整个站点真的更可靠吗？">Did the whole site get safer?</h1><div class="score"><strong>${value.before.averageScore}/100 → ${value.after.averageScore}/100</strong><span>${value.scoreDelta >= 0 ? "+" : ""}${value.scoreDelta}</span><span class="gate" data-en="${passed ? "PASSED" : "FAILED"} · ${html(value.threshold.scope)}" data-zh="${passed ? "通过" : "失败"} · ${html(value.threshold.scope)}">${passed ? "PASSED" : "FAILED"} · ${html(value.threshold.scope)}</span></div></div><div class="metrics"><div class="metric"><b>${value.counts.resolved}</b><span data-en="Resolved" data-zh="已解决">Resolved</span></div><div class="metric"><b>${value.counts.remaining}</b><span data-en="Remaining" data-zh="仍存在">Remaining</span></div><div class="metric"><b>${value.counts.worsened}</b><span data-en="Worsened" data-zh="恶化">Worsened</span></div><div class="metric"><b>${value.counts.new}</b><span data-en="New" data-zh="新增">New</span></div><div class="metric"><b>${value.counts.unverified}</b><span data-en="Unverified" data-zh="未验证">Unverified</span></div></div>${policySection}${sections}<p class="note" data-en="Site-level proof matches findings by stable fingerprint and page path. A missing finding is resolved only when its proving scenario completed." data-zh="站点级证明按稳定指纹和页面路径匹配问题；只有证明场景成功完成后，缺失的问题才算已解决。">Site-level proof matches findings by stable fingerprint and page path. A missing finding is resolved only when its proving scenario completed.</p></main><script>(()=>{const apply=language=>{document.documentElement.lang=language==='zh'?'zh-CN':'en';document.querySelectorAll('[data-en][data-zh]').forEach(node=>node.textContent=language==='zh'?node.dataset.zh:node.dataset.en);document.querySelectorAll('[data-language]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.language===language)))};document.querySelectorAll('[data-language]').forEach(button=>button.addEventListener('click',()=>apply(button.dataset.language)));apply(navigator.language.toLowerCase().startsWith('zh')?'zh':'en')})();</script></body></html>`;
}

export function writeSiteVerification(value, outputDirectory) {
  const jsonPath = `${outputDirectory}/site-verification.json`;
  const markdownPath = `${outputDirectory}/site-verification.md`;
  const htmlPath = `${outputDirectory}/site-verification.html`;
  writeFileSync(jsonPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, renderSiteVerificationMarkdown(value), "utf8");
  writeFileSync(htmlPath, renderSiteVerificationHtml(value), "utf8");
  return { jsonPath, markdownPath, htmlPath };
}

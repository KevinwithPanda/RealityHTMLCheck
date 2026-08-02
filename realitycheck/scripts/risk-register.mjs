import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { validateArtifactFiles } from "./artifact-validator.mjs";
import { TOOL_VERSION } from "./version.mjs";

const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "__pycache__"]);
const STATE_RANK = { open: 0, unverified: 1, waived: 2, resolved: 3 };
const SEVERITY_RANK = { critical: 0, major: 1, minor: 2, info: 3 };

function html(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function portablePath(fromDirectory, target) {
  return relative(fromDirectory, target).split(sep).join("/") || basename(target);
}

function collectReports(inputPaths, outputDirectory) {
  const reports = new Set();
  const output = resolve(outputDirectory);
  const visit = (candidate) => {
    const path = resolve(candidate);
    if (!existsSync(path)) throw new Error(`${path}: risk-register source does not exist`);
    const stats = statSync(path);
    if (stats.isFile()) {
      if (basename(path) !== "report.json") throw new Error(`${path}: expected report.json or a directory`);
      reports.add(path);
      return;
    }
    if (!stats.isDirectory()) throw new Error(`${path}: expected report.json or a directory`);
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name) && resolve(child) !== output) visit(child);
      else if (entry.isFile() && entry.name === "report.json") reports.add(resolve(child));
    }
  };
  for (const input of inputPaths) visit(input);
  return [...reports].sort();
}

function targetOf(report) {
  return report.target.finalUrl || report.target.requestedUrl;
}

function activeFindings(report) {
  return report.findings.filter((finding) => finding.classification !== "resolved");
}

function stableRiskId(target, fingerprint) {
  return `RISK-${createHash("sha256").update(`${target}\0${fingerprint}`).digest("hex").slice(0, 10).toUpperCase()}`;
}

function ageDays(firstSeen, now) {
  return Math.max(0, Math.floor((now.getTime() - new Date(firstSeen).getTime()) / 86_400_000));
}

export function buildRiskRegister(inputPaths, outputDirectory, { now = new Date(), maxOpenAgeDays = null, maxOpenRisks = null, maxRecurringRisks = null } = {}) {
  if (!inputPaths.length) throw new Error("risk-register requires at least one report file or directory");
  if (maxOpenAgeDays !== null && (!Number.isInteger(maxOpenAgeDays) || maxOpenAgeDays < 0 || maxOpenAgeDays > 3650)) throw new Error("maxOpenAgeDays must be an integer from 0 to 3650");
  if (maxOpenRisks !== null && (!Number.isInteger(maxOpenRisks) || maxOpenRisks < 0 || maxOpenRisks > 100000)) throw new Error("maxOpenRisks must be an integer from 0 to 100000");
  if (maxRecurringRisks !== null && (!Number.isInteger(maxRecurringRisks) || maxRecurringRisks < 0 || maxRecurringRisks > 100000)) throw new Error("maxRecurringRisks must be an integer from 0 to 100000");
  const output = resolve(outputDirectory);
  const files = collectReports(inputPaths, output);
  if (!files.length) throw new Error("no page reports were found for the risk register");
  const validation = validateArtifactFiles(files);
  const validPaths = new Set(validation.filter((item) => item.valid && item.kind === "report").map((item) => item.path));
  const warnings = validation.filter((item) => !item.valid || item.kind !== "report").map((item) => `${portablePath(output, item.path)} was skipped because it is not a valid page report.`);
  const reports = files.filter((path) => validPaths.has(path)).map((path) => ({ path, value: JSON.parse(readFileSync(path, "utf8")) }));
  if (!reports.length) throw new Error("no valid page reports were available for the risk register");
  reports.sort((left, right) => left.value.run.startedAt.localeCompare(right.value.run.startedAt) || left.value.run.id.localeCompare(right.value.run.id));

  const reportsByTarget = new Map();
  const observations = new Map();
  for (const report of reports) {
    const target = targetOf(report.value);
    if (!reportsByTarget.has(target)) reportsByTarget.set(target, []);
    reportsByTarget.get(target).push(report);
    for (const finding of activeFindings(report.value)) {
      const key = `${target}\0${finding.fingerprint}`;
      if (!observations.has(key)) observations.set(key, []);
      observations.get(key).push({ report, finding });
    }
  }

  const entries = [];
  for (const [key, history] of observations) {
    const separator = key.indexOf("\0");
    const target = key.slice(0, separator);
    const fingerprint = key.slice(separator + 1);
    const latestReport = reportsByTarget.get(target).at(-1);
    const first = history[0];
    const last = history.at(-1);
    const current = activeFindings(latestReport.value).find((finding) => finding.fingerprint === fingerprint);
    const latestScenario = latestReport.value.scenarios.find((scenario) => scenario.id === last.finding.scenarioId);
    const observedPolicy = last.report.value.config?.policyFingerprint;
    const latestPolicy = latestReport.value.config?.policyFingerprint;
    const policyConsistent = observedPolicy || latestPolicy ? Boolean(observedPolicy && latestPolicy && observedPolicy === latestPolicy) : true;
    const scenarioCompleted = ["passed", "completed-with-findings"].includes(latestScenario?.status);
    const state = current
      ? (current.waiver ? "waived" : "open")
      : (scenarioCompleted && policyConsistent ? "resolved" : "unverified");
    const representative = current || last.finding;
    const evidenceReport = current ? latestReport : last.report;
    entries.push({
      id: stableRiskId(target, fingerprint),
      fingerprint,
      target,
      state,
      severity: representative.severity,
      confidence: representative.confidence,
      ruleId: representative.ruleId,
      scenarioId: representative.scenarioId,
      title: representative.title,
      ...(representative.translations?.["zh-CN"]?.title ? { titleZh: representative.translations["zh-CN"].title } : {}),
      firstSeen: first.report.value.run.startedAt,
      lastSeen: last.report.value.run.startedAt,
      latestRunId: latestReport.value.run.id,
      occurrences: history.length,
      ageDays: ageDays(first.report.value.run.startedAt, state === "resolved" ? new Date(latestReport.value.run.startedAt) : now),
      ...(!current && state === "unverified" ? { unverifiedReason: scenarioCompleted ? "policy-drift" : "scenario-incomplete" } : {}),
      ...(representative.ownership ? { ownership: representative.ownership } : {}),
      ...(representative.waiver ? { waiver: representative.waiver } : {}),
      latestReportPath: portablePath(output, latestReport.path.replace(/report\.json$/i, "report.html")),
      evidencePath: `${portablePath(output, evidenceReport.path.replace(/report\.json$/i, "report.html"))}#${encodeURIComponent(representative.id)}`,
    });
  }
  for (const entry of entries) entry.overdue = entry.state === "open" && maxOpenAgeDays !== null && entry.ageDays > maxOpenAgeDays;
  entries.sort((left, right) => STATE_RANK[left.state] - STATE_RANK[right.state] || SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] || right.ageDays - left.ageDays || left.id.localeCompare(right.id));
  const recurring = entries.filter((item) => item.occurrences > 1).length;
  const open = entries.filter((item) => item.state === "open").length;
  const oldestOpenAgeDays = Math.max(0, ...entries.filter((item) => item.state === "open").map((item) => item.ageDays));
  const violations = [];
  if (maxOpenAgeDays !== null && oldestOpenAgeDays > maxOpenAgeDays) violations.push({ code: "open-risk-age", actual: oldestOpenAgeDays, expected: maxOpenAgeDays });
  if (maxOpenRisks !== null && open > maxOpenRisks) violations.push({ code: "open-risk-count", actual: open, expected: maxOpenRisks });
  if (maxRecurringRisks !== null && recurring > maxRecurringRisks) violations.push({ code: "recurring-risk-count", actual: recurring, expected: maxRecurringRisks });
  return {
    schemaVersion: "1",
    toolVersion: TOOL_VERSION,
    kind: "risk-register",
    generatedAt: now.toISOString(),
    summary: {
      risks: entries.length,
      open,
      recurring,
      overdue: entries.filter((item) => item.overdue).length,
      waived: entries.filter((item) => item.state === "waived").length,
      resolved: entries.filter((item) => item.state === "resolved").length,
      unverified: entries.filter((item) => item.state === "unverified").length,
      targets: reportsByTarget.size,
      runs: reports.length,
    },
    policy: {
      maxOpenAgeDays,
      maxOpenRisks,
      maxRecurringRisks,
      gateFailed: violations.length > 0,
      violations,
    },
    entries,
    warnings,
  };
}

function csvCell(value) {
  let text = String(value ?? "").replaceAll("\r", " ").replaceAll("\n", " ");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function renderRiskRegisterCsv(register) {
  const columns = ["id", "state", "severity", "confidence", "owner", "title", "target", "ruleId", "scenarioId", "firstSeen", "lastSeen", "ageDays", "overdue", "occurrences", "latestRunId", "evidencePath"];
  const rows = register.entries.map((item) => [item.id, item.state, item.severity, item.confidence, item.ownership?.name || "", item.title, item.target, item.ruleId, item.scenarioId, item.firstSeen, item.lastSeen, item.ageDays, item.overdue, item.occurrences, item.latestRunId, item.evidencePath]);
  return `\uFEFF${[columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function markdown(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\r", " ").replaceAll("\n", " ");
}

export function renderRiskRegisterMarkdown(register) {
  const lines = [
    "# RealityCheck risk register",
    "",
    `Risks: **${register.summary.risks}** · Open: **${register.summary.open}** · Recurring: **${register.summary.recurring}** · Overdue: **${register.summary.overdue}** · Waived: **${register.summary.waived}** · Resolved: **${register.summary.resolved}** · Unverified: **${register.summary.unverified}**`,
    `Targets: **${register.summary.targets}** · Runs: **${register.summary.runs}**`,
    "",
  ];
  if (register.policy.gateFailed) lines.push(`Risk policy: **FAILED** · ${register.policy.violations.map((item) => `${item.code} ${item.actual}/${item.expected}`).join(" · ")}`, "");
  lines.push("| State | Severity | Risk | Owner | Occurrences | First seen |", "| --- | --- | --- | --- | ---: | --- |");
  for (const item of register.entries.slice(0, 50)) {
    lines.push(`| ${item.state} | ${item.severity} | [${markdown(item.title)}](${item.evidencePath}) | ${markdown(item.ownership?.name || "—")} | ${item.occurrences} | ${item.firstSeen} |`);
  }
  if (register.entries.length > 50) lines.push("", `_Showing 50 of ${register.entries.length} risks. Open risk-register.html for the complete register._`);
  if (register.warnings.length) lines.push("", `Warnings: **${register.warnings.length}** report(s) were skipped.`);
  return `${lines.join("\n")}\n`;
}

export function renderRiskRegisterHtml(register) {
  const cards = register.entries.map((item) => `<article class="risk" data-state="${item.state}" data-recurring="${item.occurrences > 1}" data-overdue="${item.overdue}"><div class="risk-top"><span class="id">${html(item.id)}</span><span class="state ${item.state}" data-en="${item.state}" data-zh="${({ open: "开放", waived: "已豁免", resolved: "已解决", unverified: "未验证" })[item.state]}">${item.state}</span></div><h2 data-en="${html(item.title)}" data-zh="${html(item.titleZh || item.title)}">${html(item.title)}</h2><p class="target">${html(item.target)}</p><div class="meta"><span><b>${html(item.severity)}</b> severity</span><span><b>${item.occurrences}</b> <span data-en="occurrences" data-zh="出现次数">occurrences</span></span>${item.occurrences > 1 ? `<span><b data-en="Recurring" data-zh="反复出现">Recurring</b></span>` : ""}${item.overdue ? `<span><b data-en="Overdue" data-zh="已逾期">Overdue</b></span>` : ""}<span><b>${item.ageDays}</b> <span data-en="age days" data-zh="累计天数">age days</span></span>${item.ownership ? `<span><b data-en="Owner" data-zh="负责团队">Owner</b> · ${html(item.ownership.name)}</span>` : ""}${item.unverifiedReason ? `<span><b data-en="Unverified because" data-zh="未验证原因">Unverified because</b> · <span data-en="${item.unverifiedReason === "policy-drift" ? "detector policy drifted" : "proving scenario did not complete"}" data-zh="${item.unverifiedReason === "policy-drift" ? "检测策略已漂移" : "证明场景未完成"}">${item.unverifiedReason}</span></span>` : ""}</div><div class="actions"><a class="primary" href="${html(item.evidencePath)}" data-en="Open evidence →" data-zh="打开证据 →">Open evidence →</a><a href="${html(item.latestReportPath)}" data-en="Latest run" data-zh="最新运行">Latest run</a></div></article>`).join("");
  const rendered = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';script-src 'unsafe-inline';base-uri 'none';form-action 'none'"><title>RealityCheck risk register</title><style>
:root{color-scheme:light;--ink:#18191d;--muted:#686b74;--line:#e3dfd7;--paper:#fffdfa;--canvas:#f3f0ea;--orange:#ff5c35;--good:#13795b;--bad:#bd2840;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;color:var(--ink);background:var(--canvas)}.top{color:#fff;background:#17181c}.top-inner,.shell{width:min(1160px,calc(100% - 40px));margin:auto}.top-inner{min-height:70px;display:flex;align-items:center;justify-content:space-between;gap:18px}.brand{font-weight:900}.brand span{color:#ff8b70}.languages{display:flex;padding:3px;border:1px solid #41434a;border-radius:9px}.languages button{border:0;border-radius:6px;padding:7px 10px;color:#b9bbc3;background:transparent;font:750 12px inherit;cursor:pointer}.languages button[aria-pressed=true]{color:#17181c;background:#fff}.hero{padding:62px 0 35px}.eyebrow{margin:0;color:var(--orange);font-size:12px;font-weight:850;letter-spacing:.12em}h1{margin:12px 0 14px;font-size:clamp(42px,7vw,74px);line-height:.95;letter-spacing:-.06em}.lede{max-width:760px;color:var(--muted);line-height:1.6}.stats{display:grid;grid-template-columns:repeat(6,1fr);gap:9px;margin-bottom:28px}.stat{padding:16px;border:1px solid var(--line);border-radius:14px;background:var(--paper)}.stat b{display:block;font-size:28px}.stat span{color:var(--muted);font-size:11px}.toolbar{display:grid;grid-template-columns:1fr minmax(240px,340px) auto;gap:12px;align-items:center;margin-bottom:16px}.filters{display:flex;flex-wrap:wrap;gap:7px}.filters button{border:1px solid var(--line);border-radius:8px;padding:8px 11px;background:var(--paper);font:750 12px inherit;cursor:pointer}.filters button[aria-pressed=true]{color:#fff;background:#24262b}.search{width:100%;border:1px solid var(--line);border-radius:9px;padding:10px 12px;background:var(--paper);font:13px inherit}.count{color:var(--muted);font-size:12px}.risks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.risk{min-width:0;padding:23px;border:1px solid var(--line);border-radius:19px;background:var(--paper)}.risk[hidden]{display:none}.risk-top,.actions{display:flex;align-items:center;justify-content:space-between;gap:12px}.id{color:var(--muted);font:750 10px ui-monospace,SFMono-Regular,Consolas,monospace}.state{padding:5px 8px;border-radius:999px;font-size:10px;font-weight:850;text-transform:uppercase}.state.open{color:var(--bad);background:#ffe5ea}.state.waived{color:#8a5b00;background:#fff0c9}.state.resolved{color:var(--good);background:#e4f4ee}.state.unverified{color:#315f8d;background:#e5f0fb}.risk h2{margin:17px 0 7px;font-size:22px}.target{margin:0;color:var(--muted);font:11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.meta{display:flex;flex-wrap:wrap;gap:8px 15px;min-height:40px;margin:18px 0;color:var(--muted);font-size:11px}.meta b{color:var(--ink)}.actions{justify-content:flex-start;flex-wrap:wrap}.actions a{border:1px solid var(--line);border-radius:9px;padding:9px 11px;color:var(--ink);font-size:12px;font-weight:800;text-decoration:none}.actions a.primary{color:#fff;border-color:#24262b;background:#24262b}.warnings{margin:30px 0;padding:20px;border:1px solid var(--line);border-radius:15px;background:var(--paper)}footer{padding:36px 0;color:var(--muted);font:11px ui-monospace,SFMono-Regular,Consolas,monospace}@media(max-width:800px){.stats{grid-template-columns:repeat(3,1fr)}.toolbar{grid-template-columns:1fr}.risks{grid-template-columns:1fr}}@media(max-width:520px){.top-inner,.shell{width:min(100% - 24px,1160px)}.stats{grid-template-columns:repeat(2,1fr)}.hero{padding-top:42px}}
</style></head><body><header class="top"><div class="top-inner"><div class="brand">Reality<span>Check</span> / RISK REGISTER</div><div class="languages"><button data-language="en" aria-pressed="true">EN</button><button data-language="zh" aria-pressed="false">中文</button></div></div></header><main class="shell"><section class="hero"><p class="eyebrow" data-en="LONGITUDINAL FINDING OWNERSHIP" data-zh="长期问题责任视图">LONGITUDINAL FINDING OWNERSHIP</p><h1 data-en="Recurring risk, made accountable." data-zh="让反复风险可追踪、可负责。">Recurring risk, made accountable.</h1><p class="lede" data-en="Stable fingerprints connect repeated observations across runs. Resolution is claimed only when the latest proving scenario completed successfully." data-zh="稳定指纹连接多次运行中的重复观察；只有最新证明场景成功完成，才会宣称问题已解决。">Stable fingerprints connect repeated observations across runs. Resolution is claimed only when the latest proving scenario completed successfully.</p></section><section class="stats">${[["risks","Risks","风险"],["open","Open","开放"],["waived","Waived","已豁免"],["resolved","Resolved","已解决"],["unverified","Unverified","未验证"],["runs","Runs","运行"]].map(([key,en,zh])=>`<div class="stat"><b>${register.summary[key]}</b><span data-en="${en}" data-zh="${zh}">${en}</span></div>`).join("")}</section><div class="toolbar"><div class="filters">${[["all","All","全部"],["open","Open","开放"],["waived","Waived","已豁免"],["resolved","Resolved","已解决"],["unverified","Unverified","未验证"]].map(([key,en,zh],index)=>`<button data-filter="${key}" aria-pressed="${index===0}" data-en="${en}" data-zh="${zh}">${en}</button>`).join("")}</div><input class="search" type="search" placeholder="Search risk, target, rule, or owner" aria-label="Search risk register"><span class="count" role="status" aria-live="polite"></span></div><section class="risks">${cards}</section>${register.warnings.length?`<section class="warnings"><h2 data-en="Skipped reports" data-zh="已跳过报告">Skipped reports</h2><ul>${register.warnings.map(item=>`<li>${html(item)}</li>`).join("")}</ul></section>`:""}<footer>Generated ${html(register.generatedAt)} · RealityCheck ${TOOL_VERSION}</footer></main><script>(()=>{let language=navigator.language.toLowerCase().startsWith('zh')?'zh':'en';let filter='all';const search=document.querySelector('.search');const count=document.querySelector('.count');const apply=()=>{const query=search.value.trim().toLowerCase();let shown=0;document.querySelectorAll('.risk').forEach(card=>{card.hidden=!((filter==='all'||card.dataset.state===filter)&&(!query||card.textContent.toLowerCase().includes(query)));if(!card.hidden)shown+=1});count.textContent=language==='zh'?'显示 '+shown+'/${register.entries.length} 项':shown+'/${register.entries.length} shown'};const setLanguage=next=>{language=next;document.documentElement.lang=next==='zh'?'zh-CN':'en';document.querySelectorAll('[data-en][data-zh]').forEach(node=>node.textContent=node.dataset[next]);document.querySelectorAll('[data-language]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.language===next)));search.placeholder=next==='zh'?'搜索风险、目标、规则或负责团队':'Search risk, target, rule, or owner';apply()};document.querySelectorAll('[data-language]').forEach(button=>button.addEventListener('click',()=>setLanguage(button.dataset.language)));document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));apply()}));search.addEventListener('input',apply);setLanguage(language)})();</script></body></html>`;
  const recurringStat = `<div class="stat"><b>${register.summary.recurring}</b><span data-en="Recurring" data-zh="反复出现">Recurring</span></div>`;
  const overdueStat = `<div class="stat"><b>${register.summary.overdue}</b><span data-en="Overdue" data-zh="已逾期">Overdue</span></div>`;
  const openStat = `<div class="stat"><b>${register.summary.open}</b><span data-en="Open" data-zh="开放">Open</span></div>`;
  const recurringFilter = `<button data-filter="recurring" aria-pressed="false" data-en="Recurring" data-zh="反复出现">Recurring</button>`;
  const overdueFilter = `<button data-filter="overdue" aria-pressed="false" data-en="Overdue" data-zh="已逾期">Overdue</button>`;
  const policyNotice = register.policy.gateFailed ? `<section class="warnings"><h2 data-en="Risk policy failed" data-zh="风险策略未通过">Risk policy failed</h2><ul>${register.policy.violations.map((violation) => `<li>${html(violation.code)} · ${violation.actual}/${violation.expected}</li>`).join("")}</ul></section>` : "";
  return rendered
    .replace("grid-template-columns:repeat(6,1fr)", "grid-template-columns:repeat(auto-fit,minmax(110px,1fr))")
    .replace(openStat, `${openStat}${recurringStat}`)
    .replace(recurringStat, `${recurringStat}${overdueStat}`)
    .replace('<button data-filter="waived"', `${recurringFilter}${overdueFilter}<button data-filter="waived"`)
    .replace("<footer>", `${policyNotice}<footer>`)
    .replace("filter==='all'||card.dataset.state===filter", "filter==='all'||(filter==='recurring'?card.dataset.recurring==='true':filter==='overdue'?card.dataset.overdue==='true':card.dataset.state===filter)");
}

export function writeRiskRegister(register, outputDirectory) {
  mkdirSync(outputDirectory, { recursive: true });
  const jsonPath = join(outputDirectory, "risk-register.json");
  const csvPath = join(outputDirectory, "risk-register.csv");
  const markdownPath = join(outputDirectory, "risk-register.md");
  const htmlPath = join(outputDirectory, "risk-register.html");
  writeFileSync(jsonPath, `${JSON.stringify(register, null, 2)}\n`, "utf8");
  writeFileSync(csvPath, renderRiskRegisterCsv(register), "utf8");
  writeFileSync(markdownPath, renderRiskRegisterMarkdown(register), "utf8");
  writeFileSync(htmlPath, renderRiskRegisterHtml(register), "utf8");
  return { jsonPath, csvPath, markdownPath, htmlPath };
}

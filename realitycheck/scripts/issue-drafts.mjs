import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { validateArtifactFiles } from "./artifact-validator.mjs";
import { TOOL_VERSION } from "./version.mjs";

const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "__pycache__"]);
const SEVERITY_ORDER = { info: 0, minor: 1, major: 2, critical: 3 };
const CONFIDENCE_ORDER = { low: 0, medium: 1, high: 2 };

function html(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function cleanText(value, maximum = 1000) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function requiredText(value, maximum, label) {
  const result = cleanText(value, maximum);
  if (!result) throw new Error(`${label} becomes empty after safe normalization`);
  return result;
}

function markdownText(value, maximum = 3000) {
  return cleanText(value, maximum).replaceAll("@", "@\u200b").replaceAll("<", "&lt;").replaceAll(">", "&gt;").slice(0, maximum);
}

function markdownCode(value) {
  return `\`${markdownText(value, 500).replaceAll("`", "\\`")}\``;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function fingerprint(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}

function targetWithoutQuery(value) {
  const target = new URL(value);
  target.username = "";
  target.password = "";
  target.search = "";
  target.hash = "";
  return target.toString();
}

function portablePath(fromDirectory, target) {
  const value = relative(fromDirectory, target).split(sep).join("/");
  if (!value || /^[A-Za-z]:|^\//.test(value)) throw new Error("issue-drafts output and repair plans must share a filesystem volume");
  return value;
}

function collectRepairPlans(inputPaths, outputDirectory) {
  const files = new Set();
  const output = resolve(outputDirectory);
  const visit = (candidate) => {
    const path = resolve(candidate);
    if (!existsSync(path)) throw new Error(`${basename(path)}: issue-drafts source does not exist`);
    const stats = statSync(path);
    if (stats.isFile()) {
      if (basename(path) !== "repair-plan.json") throw new Error(`${basename(path)}: expected repair-plan.json`);
      files.add(path);
      return;
    }
    if (!stats.isDirectory()) throw new Error(`${basename(path)}: expected a file or directory`);
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name) && resolve(child) !== output) visit(child);
      else if (entry.isFile() && entry.name === "repair-plan.json") files.add(resolve(child));
    }
  };
  for (const path of inputPaths) visit(path);
  if (!files.size) throw new Error("no repair-plan.json artifacts were found");
  return [...files].sort();
}

function safeLabel(value) {
  return cleanText(value, 50).toLowerCase().replace(/[^a-z0-9:._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
}

function issueId(findingFingerprint) {
  const prefix = /^[a-f0-9]{64}$/.test(findingFingerprint) ? findingFingerprint.slice(0, 12) : createHash("sha256").update(`legacy\0${findingFingerprint}`).digest("hex").slice(0, 12);
  return `ISSUE-${prefix.toUpperCase()}`;
}

function issueBody(item, occurrences, language, { owner = null, waiver = null, disposition = "actionable" } = {}) {
  const zh = language === "zh-CN";
  const translated = item.translations?.["zh-CN"];
  const title = zh ? translated?.title || item.title : item.title;
  const remediation = zh ? translated?.remediation || item.remediation : item.remediation;
  const ownerName = owner?.name;
  const evidence = occurrences.map((occurrence) => `- [${markdownText(occurrence.runId, 160)} · ${markdownText(occurrence.scenarioId, 80)}](${occurrence.evidencePath}) · ${markdownText(occurrence.target, 500)}`);
  const hints = remediation.technicalHints.map((hint) => `- ${markdownText(hint)}`);
  const scenarios = item.verification.requiredScenarios.map((scenario) => markdownCode(scenario)).join(", ");
  const lines = zh ? [
    `## 问题`, "", markdownText(title), "",
    `- 严重级别：${markdownCode(item.severity)}`,
    `- 置信度：${markdownCode(item.confidence)}`,
    `- 规则：${markdownCode(item.ruleId)}`,
    ...(ownerName ? [`- 责任团队：${markdownText(ownerName, 160)}`] : []),
    ...(waiver ? [`- ${disposition === "waived" ? "有效豁免" : "豁免待复核"}：${markdownCode(waiver.id)}，到期日 ${markdownCode(waiver.expires)}`] : []),
    "", "## 修复建议", "", markdownText(remediation.summary), "", ...hints,
    "", "## 验收标准", "", `- 重新运行 ${scenarios}。`, `- 稳定指纹 ${markdownCode(item.fingerprint)} 不再出现。`, "- 基线场景保持健康，且不得出现同级或更严重的新回归。",
    "", "## 证据", "", ...evidence,
    "", "> 这是本地生成的工单草稿。证据链接相对于草稿包；提交前请替换为长期地址或附上证据包，并人工复核后再创建或分派 GitHub Issue。",
  ] : [
    `## Problem`, "", markdownText(title), "",
    `- Severity: ${markdownCode(item.severity)}`,
    `- Confidence: ${markdownCode(item.confidence)}`,
    `- Rule: ${markdownCode(item.ruleId)}`,
    ...(ownerName ? [`- Owning team: ${markdownText(ownerName, 160)}`] : []),
    ...(waiver ? [`- ${disposition === "waived" ? "Active waiver" : "Waiver review"}: ${markdownCode(waiver.id)} until ${markdownCode(waiver.expires)}`] : []),
    "", "## Suggested repair", "", markdownText(remediation.summary), "", ...hints,
    "", "## Acceptance criteria", "", `- Re-run ${scenarios}.`, `- Stable fingerprint ${markdownCode(item.fingerprint)} no longer appears.`, "- The baseline remains healthy and no regression of equal or greater severity is introduced.",
    "", "## Evidence", "", ...evidence,
    "", "> This is a locally generated issue draft. Evidence links are relative to the draft bundle; replace them with durable URLs or attach the bundle, then review before creating or assigning a GitHub issue.",
  ];
  return lines.join("\n").slice(0, 20000);
}

function dispositionFor(group) {
  const waived = group.waiverStates.filter(Boolean).length;
  if (group.owners.size > 1 || group.waivers.size > 1) return "review";
  if (waived === group.waiverStates.length) return "waived";
  if (waived > 0) return "review";
  if (group.item.confidence === "low") return "review";
  return "actionable";
}

export function buildIssueDrafts(inputPaths, outputDirectory, { now = new Date() } = {}) {
  if (!inputPaths.length) throw new Error("issue-drafts requires at least one repair plan file or directory");
  const output = resolve(outputDirectory);
  const paths = collectRepairPlans(inputPaths, output);
  const validation = validateArtifactFiles(paths);
  const invalid = validation.filter((result) => !result.valid || result.kind !== "repair-plan");
  if (invalid.length) throw new Error(`${invalid.length} repair plan artifact(s) failed validation`);
  const plans = paths.map((path) => ({ path, value: JSON.parse(readFileSync(path, "utf8")) }));
  const grouped = new Map();
  for (const plan of plans) {
    for (const item of plan.value.items) {
      const itemFingerprint = requiredText(item.fingerprint, 500, "finding fingerprint");
      const itemRuleId = requiredText(item.ruleId, 100, "finding rule ID");
      const evidencePath = `${portablePath(output, join(dirname(plan.path), "report.html"))}${item.reportAnchor.slice("report.html".length)}`;
      const occurrence = {
        runId: requiredText(plan.value.source.runId, 160, "repair plan run ID"),
        target: targetWithoutQuery(plan.value.source.target),
        findingId: requiredText(item.findingId, 100, "finding ID"),
        scenarioId: requiredText(item.scenarioId, 80, "finding scenario ID"),
        evidencePath,
      };
      if (!grouped.has(itemFingerprint)) grouped.set(itemFingerprint, { item, occurrences: [], owners: new Map(), waivers: new Map(), waiverStates: [] });
      const group = grouped.get(itemFingerprint);
      if (requiredText(group.item.ruleId, 100, "finding rule ID") !== itemRuleId) throw new Error(`fingerprint ${itemFingerprint.slice(0, 12)} maps to conflicting rule IDs`);
      if (!group.occurrences.some((entry) => JSON.stringify(entry) === JSON.stringify(occurrence))) group.occurrences.push(occurrence);
      group.waiverStates.push(Boolean(item.waiver));
      if (item.ownership) group.owners.set(item.ownership.id, item.ownership);
      if (item.waiver) group.waivers.set(item.waiver.id, { id: item.waiver.id, expires: item.waiver.expires });
      if (SEVERITY_ORDER[item.severity] > SEVERITY_ORDER[group.item.severity] || (item.severity === group.item.severity && CONFIDENCE_ORDER[item.confidence] > CONFIDENCE_ORDER[group.item.confidence])) group.item = item;
    }
  }
  const drafts = [...grouped.entries()].map(([findingFingerprint, group]) => {
    group.occurrences.sort((left, right) => left.runId.localeCompare(right.runId) || left.scenarioId.localeCompare(right.scenarioId));
    const item = group.item;
    const disposition = dispositionFor(group);
    const owner = group.owners.size === 1 ? [...group.owners.values()][0] : null;
    const waiver = group.waivers.size === 1 ? [...group.waivers.values()][0] : null;
    const title = markdownText(`[${item.severity}] ${requiredText(item.title, 160, "finding title")}`, 200);
    const titleZh = markdownText(`[${item.severity}] ${cleanText(item.translations?.["zh-CN"]?.title, 160) || requiredText(item.title, 160, "finding title")}`, 200);
    const labels = ["realitycheck", `severity:${item.severity}`, `disposition:${disposition}`];
    const ruleLabel = safeLabel(`rule:${item.ruleId}`);
    if (ruleLabel) labels.push(ruleLabel);
    return {
      id: issueId(findingFingerprint),
      fingerprint: cleanText(findingFingerprint, 500),
      ruleId: requiredText(item.ruleId, 100, "finding rule ID"),
      severity: item.severity,
      confidence: item.confidence,
      disposition,
      title,
      titleZh,
      body: issueBody(item, group.occurrences, "en", { owner, waiver, disposition }),
      bodyZh: issueBody(item, group.occurrences, "zh-CN", { owner, waiver, disposition }),
      labels,
      ...(owner ? { owner: { id: requiredText(owner.id, 80, "owner ID"), name: requiredText(owner.name, 160, "owner name") } } : {}),
      ...(waiver ? { waiver: { id: requiredText(waiver.id, 100, "waiver ID"), expires: waiver.expires } } : {}),
      verification: { ...item.verification, requiredScenarios: item.verification.requiredScenarios.map((scenario) => requiredText(scenario, 80, "verification scenario")) },
      occurrences: group.occurrences,
    };
  }).sort((left, right) => SEVERITY_ORDER[right.severity] - SEVERITY_ORDER[left.severity] || left.disposition.localeCompare(right.disposition) || left.id.localeCompare(right.id));
  const occurrences = drafts.reduce((sum, draft) => sum + draft.occurrences.length, 0);
  return {
    schemaVersion: "1",
    toolVersion: TOOL_VERSION,
    kind: "github-issue-drafts",
    generatedAt: now.toISOString(),
    summary: {
      drafts: drafts.length,
      occurrences,
      duplicates: occurrences - drafts.length,
      actionable: drafts.filter((draft) => draft.disposition === "actionable").length,
      review: drafts.filter((draft) => draft.disposition === "review").length,
      waived: drafts.filter((draft) => draft.disposition === "waived").length,
      critical: drafts.filter((draft) => draft.severity === "critical").length,
      major: drafts.filter((draft) => draft.severity === "major").length,
      minor: drafts.filter((draft) => draft.severity === "minor").length,
      info: drafts.filter((draft) => draft.severity === "info").length,
    },
    sources: plans.map(({ value }) => ({ filename: "repair-plan.json", runId: requiredText(value.source.runId, 160, "repair plan run ID"), fingerprint: fingerprint(value), items: value.items.length })),
    drafts,
    warnings: ["Drafts are never submitted automatically. Review scope, ownership, confidentiality, labels, and duplicate status before creating external issues.", "草稿不会自动提交。创建外部工单前，请人工复核范围、责任归属、保密性、标签和重复状态。"],
  };
}

export function renderIssueDraftsMarkdown(bundle, language = "en") {
  const zh = language === "zh-CN";
  const lines = [
    `# ${zh ? "RealityCheck GitHub 工单草稿" : "RealityCheck GitHub issue drafts"}`,
    "",
    zh ? `草稿 **${bundle.summary.drafts}** · 可执行 **${bundle.summary.actionable}** · 待复核 **${bundle.summary.review}** · 已豁免 **${bundle.summary.waived}** · 已合并重复 **${bundle.summary.duplicates}**` : `Drafts **${bundle.summary.drafts}** · Actionable **${bundle.summary.actionable}** · Review **${bundle.summary.review}** · Waived **${bundle.summary.waived}** · Duplicates merged **${bundle.summary.duplicates}**`,
    "",
    `> ${zh ? bundle.warnings[1] : bundle.warnings[0]}`,
    "",
  ];
  for (const draft of bundle.drafts) {
    lines.push(`## ${zh ? draft.titleZh : draft.title}`, "", `${draft.id} · ${draft.labels.map(markdownCode).join(" ")}`, "", zh ? draft.bodyZh : draft.body, "", "---", "");
  }
  return `${lines.join("\n")}\n`;
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""').replaceAll("\r", " ").replaceAll("\n", " ")}"`;
}

export function renderIssueDraftsCsv(bundle) {
  const lines = [["id", "title", "severity", "confidence", "disposition", "rule", "owner", "occurrences", "labels"].map(csvCell).join(",")];
  for (const draft of bundle.drafts) lines.push([draft.id, draft.title, draft.severity, draft.confidence, draft.disposition, draft.ruleId, draft.owner?.name || "", draft.occurrences.length, draft.labels.join(" ")].map(csvCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

function renderIssueDraftsHtmlBase(bundle) {
  const cards = bundle.drafts.map((draft) => `<article class="draft" data-severity="${draft.severity}" data-disposition="${draft.disposition}" data-search="${html(`${draft.title} ${draft.titleZh} ${draft.ruleId} ${draft.owner?.name || ""}`.toLowerCase())}" data-title-en="${html(draft.title)}" data-title-zh="${html(draft.titleZh)}" data-labels="${html(draft.labels.join(", "))}"><div class="top"><span class="severity ${draft.severity}">${draft.severity}</span><code>${draft.id}</code></div><h2 data-en="${html(draft.title)}" data-zh="${html(draft.titleZh)}">${html(draft.title)}</h2><div class="meta"><span data-en="${draft.disposition}" data-zh="${draft.disposition === "actionable" ? "可执行" : draft.disposition === "review" ? "待复核" : "已豁免"}">${draft.disposition}</span><span>${html(draft.ruleId)}</span><span>${draft.occurrences.length}×</span>${draft.owner ? `<span>${html(draft.owner.name)}</span>` : ""}</div><textarea readonly data-body-en="${html(draft.body)}" data-body-zh="${html(draft.bodyZh)}" aria-label="Issue draft Markdown" data-aria-en="Issue draft Markdown" data-aria-zh="工单草稿 Markdown">${html(draft.body)}</textarea><div class="draft-actions"><button type="button" data-copy data-en="Copy title + labels + body" data-zh="复制标题、标签与正文">Copy title + labels + body</button><a href="${html(draft.occurrences[0].evidencePath)}" data-en="Open evidence" data-zh="打开证据">Open evidence</a><span class="copied" role="status" aria-live="polite"></span></div></article>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';script-src 'unsafe-inline';base-uri 'none';form-action 'none'"><title>RealityCheck GitHub issue drafts</title><style>:root{font-family:Inter,system-ui,sans-serif;color:#191a1f;background:#f3f0ea;--line:#ddd8cf;--paper:#fffdfa;--bad:#b4233c;--major:#b55316;--minor:#8b6900;--info:#315f8d}*{box-sizing:border-box}body{margin:0}header,main,footer{width:min(1120px,calc(100% - 32px));margin:auto}header{min-height:68px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);font-weight:900}.languages,.filters{display:flex;gap:6px;flex-wrap:wrap}button{min-height:38px;border:1px solid var(--line);border-radius:8px;padding:0 12px;background:#fff;cursor:pointer}button[aria-pressed=true],.draft button{color:#fff;background:#22242a}.hero{padding:60px 0 28px}.eyebrow{color:#b53b1c;font-size:11px;font-weight:900;letter-spacing:.12em}h1{max-width:850px;margin:8px 0;font-size:clamp(42px,8vw,78px);line-height:.94;letter-spacing:-.06em}.summary{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:24px 0}.summary article{padding:16px;border:1px solid var(--line);border-radius:11px;background:var(--paper)}.summary strong{display:block;font-size:29px}.toolbar{display:grid;grid-template-columns:1fr minmax(220px,340px) auto;gap:12px;align-items:center;margin:24px 0}.toolbar input{min-height:40px;border:1px solid var(--line);border-radius:8px;padding:0 11px}.count{color:#686b74;font-size:11px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.draft{min-width:0;padding:22px;border:1px solid var(--line);border-radius:15px;background:var(--paper)}.draft[hidden]{display:none}.top,.meta{display:flex;align-items:center;justify-content:space-between;gap:10px}.severity{padding:4px 7px;border-radius:5px;color:#fff;background:var(--info);font-size:10px;font-weight:900;text-transform:uppercase}.severity.critical{background:var(--bad)}.severity.major{background:var(--major)}.severity.minor{background:var(--minor)}.draft h2{font-size:22px}.meta{justify-content:flex-start;flex-wrap:wrap;color:#676b74;font-size:11px}.draft textarea{width:100%;height:190px;margin:18px 0 10px;border:1px solid var(--line);border-radius:8px;padding:12px;background:#f7f5f0;font:11px/1.5 ui-monospace,monospace;resize:vertical}.draft button{border-color:#22242a}.copied{margin-left:8px;color:#13795b;font-size:11px}footer{padding:38px 0;color:#696d75;font-size:11px}@media(max-width:760px){.summary{grid-template-columns:1fr 1fr}.toolbar{grid-template-columns:1fr}.grid{grid-template-columns:1fr}}</style></head><body><header><div>RealityCheck / ISSUE DRAFTS</div><div class="languages"><button data-language="en" aria-pressed="true">EN</button><button data-language="zh" aria-pressed="false">中文</button></div></header><main><section class="hero"><p class="eyebrow" data-en="LOCAL HANDOFF · NO AUTO-SUBMISSION" data-zh="本地交接 · 绝不自动提交">LOCAL HANDOFF · NO AUTO-SUBMISSION</p><h1 data-en="Turn evidence into reviewable work." data-zh="把证据变成可复核的工作。">Turn evidence into reviewable work.</h1><div class="summary"><article><strong>${bundle.summary.drafts}</strong><span data-en="drafts" data-zh="份草稿">drafts</span></article><article><strong>${bundle.summary.actionable}</strong><span data-en="actionable" data-zh="份可执行">actionable</span></article><article><strong>${bundle.summary.review}</strong><span data-en="review" data-zh="份待复核">review</span></article><article><strong>${bundle.summary.waived}</strong><span data-en="waived" data-zh="份已豁免">waived</span></article><article><strong>${bundle.summary.duplicates}</strong><span data-en="duplicates merged" data-zh="个重复已合并">duplicates merged</span></article></div></section><div class="toolbar"><div class="filters"><button data-filter="all" aria-pressed="true" data-en="All" data-zh="全部">All</button><button data-filter="actionable" data-en="Actionable" data-zh="可执行">Actionable</button><button data-filter="review" data-en="Review" data-zh="待复核">Review</button><button data-filter="waived" data-en="Waived" data-zh="已豁免">Waived</button><button data-filter="critical">Critical</button><button data-filter="major">Major</button><button data-filter="minor">Minor</button></div><input type="search" placeholder="Search drafts" aria-label="Search drafts"><span class="count" role="status"></span></div><section class="grid">${cards}</section></main><footer data-en="Review before copying. RealityCheck never creates external issues from this artifact." data-zh="复制前请人工复核。RealityCheck 绝不会根据此产物自动创建外部工单。">Review before copying. RealityCheck never creates external issues from this artifact.</footer><script>(()=>{let language=localStorage.getItem('realitycheck-issue-language')||'en';let filter='all';const input=document.querySelector('input');const apply=()=>{document.documentElement.lang=language==='zh'?'zh-CN':'en';document.querySelectorAll('[data-en][data-zh]').forEach(e=>e.textContent=e.dataset[language]);document.querySelectorAll('[data-language]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.language===language)));input.placeholder=language==='zh'?'搜索草稿':'Search drafts';let shown=0;const query=input.value.trim().toLowerCase();document.querySelectorAll('.draft').forEach(e=>{const filterMatch=filter==='all'||e.dataset.disposition===filter||e.dataset.severity===filter;const searchMatch=!query||e.dataset.search.includes(query);e.hidden=!(filterMatch&&searchMatch);if(!e.hidden)shown+=1;const body=e.querySelector('textarea');body.value=body.dataset[language==='zh'?'bodyZh':'bodyEn']});document.querySelector('.count').textContent=language==='zh'?'显示 '+shown+'/${bundle.drafts.length} 项':shown+'/${bundle.drafts.length} shown'};document.querySelectorAll('[data-language]').forEach(b=>b.addEventListener('click',()=>{language=b.dataset.language;localStorage.setItem('realitycheck-issue-language',language);apply()}));document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));apply()}));document.querySelectorAll('[data-copy]').forEach(b=>b.addEventListener('click',async()=>{const text=b.parentElement.querySelector('textarea').value;const status=b.nextElementSibling;try{await navigator.clipboard.writeText(text);status.textContent=language==='zh'?'已复制':'Copied'}catch{status.textContent=language==='zh'?'请从文本框手动复制':'Copy from the text box'}}));input.addEventListener('input',apply);apply()})();</script></body></html>`;
}

export function renderIssueDraftsHtml(bundle) {
  return renderIssueDraftsHtmlBase(bundle)
    .replace("</style>", ".draft-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.draft-actions a{min-height:38px;display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:8px;padding:0 12px;color:#202127;text-decoration:none;font-size:11px;font-weight:800}</style>")
    .replace('<div class="languages">', '<div class="languages" role="group" aria-label="Language" data-aria-en="Language" data-aria-zh="语言">')
    .replace('<div class="filters">', '<div class="filters" role="group" aria-label="Draft filters" data-aria-en="Draft filters" data-aria-zh="草稿筛选">')
    .replaceAll('<button data-filter="actionable"', '<button data-filter="actionable" aria-pressed="false"')
    .replaceAll('<button data-filter="review"', '<button data-filter="review" aria-pressed="false"')
    .replaceAll('<button data-filter="waived"', '<button data-filter="waived" aria-pressed="false"')
    .replaceAll('<button data-filter="critical"', '<button data-filter="critical" aria-pressed="false"')
    .replaceAll('<button data-filter="major"', '<button data-filter="major" aria-pressed="false"')
    .replaceAll('<button data-filter="minor"', '<button data-filter="minor" aria-pressed="false"')
    .replace('placeholder="Search drafts" aria-label="Search drafts"', 'placeholder="Search drafts" aria-label="Search drafts" data-aria-en="Search drafts" data-aria-zh="搜索草稿"')
    .replace("input.placeholder=language==='zh'?'搜索草稿':'Search drafts';", "input.placeholder=language==='zh'?'搜索草稿':'Search drafts';document.title=language==='zh'?'RealityCheck GitHub 工单草稿':'RealityCheck GitHub issue drafts';document.querySelectorAll('[data-aria-en]').forEach(e=>e.setAttribute('aria-label',e.dataset[language==='zh'?'ariaZh':'ariaEn']));")
    .replace("const text=b.parentElement.querySelector('textarea').value;", "const card=b.closest('.draft');const body=card.querySelector('textarea').value;const title=card.dataset[language==='zh'?'titleZh':'titleEn'];const text='TITLE\\n'+title+'\\n\\nLABELS\\n'+card.dataset.labels+'\\n\\nBODY\\n'+body;")
    .replace("const status=b.nextElementSibling;", "const status=b.parentElement.querySelector('.copied');");
}

export function writeIssueDrafts(bundle, outputDirectory) {
  const output = resolve(outputDirectory);
  mkdirSync(output, { recursive: true });
  const jsonPath = join(output, "github-issue-drafts.json");
  const markdownPath = join(output, "github-issue-drafts.md");
  const markdownZhPath = join(output, "github-issue-drafts.zh-CN.md");
  const csvPath = join(output, "github-issue-drafts.csv");
  const htmlPath = join(output, "github-issue-drafts.html");
  writeFileSync(jsonPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, renderIssueDraftsMarkdown(bundle, "en"), "utf8");
  writeFileSync(markdownZhPath, renderIssueDraftsMarkdown(bundle, "zh-CN"), "utf8");
  writeFileSync(csvPath, renderIssueDraftsCsv(bundle), "utf8");
  writeFileSync(htmlPath, renderIssueDraftsHtml(bundle), "utf8");
  return { jsonPath, markdownPath, markdownZhPath, csvPath, htmlPath, bundle };
}

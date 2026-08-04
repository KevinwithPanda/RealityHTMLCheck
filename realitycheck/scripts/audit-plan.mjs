import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

import { detectorPolicyFingerprint } from "./policy-fingerprint.mjs";
import { resolveRoute } from "./config.mjs";
import { TOOL_VERSION } from "./version.mjs";

const QUICK_SCENARIOS = ["baseline", "long-text", "rtl-arabic", "image-failure", "keyboard-tab"];
const DEEP_SCENARIOS = ["page-zoom-200", "reduced-motion", "dark-scheme", "slow-api", "api-error", "empty-data", "axe"];

function html(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function markdown(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\r", " ").replaceAll("\n", " ");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function safeTarget(value) {
  const target = new URL(value);
  target.username = "";
  target.password = "";
  target.search = "";
  target.hash = "";
  return target.toString();
}

function configCommandArgument(loaded) {
  if (!loaded?.path) return null;
  const candidate = relative(loaded.cwd || process.cwd(), loaded.path).replaceAll("\\", "/");
  const portable = candidate && !isAbsolute(candidate) && candidate !== ".." && !candidate.startsWith("../") ? candidate : basename(loaded.path);
  return /\s/.test(portable) ? JSON.stringify(portable) : portable;
}

function explicitPageCount(target, routes) {
  return new Set([target, ...routes.map((route) => resolveRoute(target, route))]).size;
}

function settingCount(policy, omitted = ["severity"]) {
  if (!policy) return 0;
  return Object.entries(policy).reduce((total, [key, value]) => {
    if (omitted.includes(key) || key.endsWith("Path")) return total;
    if (value && typeof value === "object" && !Array.isArray(value)) return total + settingCount(value, []);
    return total + 1;
  }, 0);
}

function detector(key, label, labelZh, enabled, policySettings, severity, note, noteZh) {
  return { key, label, labelZh, enabled, policySettings, severity: severity || null, note, noteZh };
}

export function auditPlanIdentity(plan) {
  return {
    source: plan.source.policyFingerprint,
    target: plan.target,
    execution: plan.execution,
    detectors: plan.detectors.map(({ key, enabled, policySettings, severity }) => ({ key, enabled, policySettings, severity })),
    governance: plan.governance,
  };
}

export function computeAuditPlanId(plan) {
  const digest = createHash("sha256").update(JSON.stringify(canonical(auditPlanIdentity(plan)))).digest("hex").slice(0, 12).toUpperCase();
  return `PLAN-${digest}`;
}

export function buildAuditPlan(options, loaded, { now = new Date(), storageStateSummary = null } = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error("audit plan now must be a valid Date");
  if (!options?.target) throw new Error("audit plan requires a target URL");
  const targetUrl = safeTarget(options.target);
  const pageStrategy = options.crawl.enabled ? "bounded-crawl" : options.routes.length ? "explicit-routes" : "target-only";
  const pagesMax = options.crawl.enabled ? options.crawl.maxPages : explicitPageCount(options.target, options.routes);
  const builtInScenarios = ["baseline", ...options.viewports.map((item) => item.id), ...QUICK_SCENARIOS.slice(1), ...(options.mode === "deep" ? DEEP_SCENARIOS : [])];
  const scenariosPerPage = builtInScenarios.length;
  const journeyScenarios = options.journeys.length;
  const scenarioExecutionsMax = pagesMax * scenariosPerPage + journeyScenarios;
  const detectors = [
    detector("runtime", "Runtime and UI baseline", "运行时与界面基线", true, 6, "major", "Console, request, image, layout, focus, and rendered-state observations.", "观察控制台、请求、图片、布局、焦点与渲染状态。"),
    detector("responsive", "Responsive viewport matrix", "响应式视口矩阵", true, options.viewports.length, "major", "Each configured viewport runs in a fresh browser context.", "每个配置视口都在新的浏览器上下文中运行。"),
    detector("deep", "Deep recovery and accessibility scenarios", "深度恢复与无障碍场景", options.mode === "deep", options.mode === "deep" ? DEEP_SCENARIOS.length : 0, "major", "Preference, degraded API, empty data, and axe-core scenarios run only in deep mode.", "偏好设置、API 降级、空数据与 axe-core 场景仅在 deep 模式运行。"),
    detector("checks", "Declarative product requirements", "声明式产品要求", options.checks.length > 0, options.checks.length, options.checks[0]?.severity, "Validated selectors and assertions run without arbitrary project code.", "经校验的选择器与断言不会执行任意项目代码。"),
    detector("journeys", "Safe user journeys", "安全用户旅程", options.journeys.length > 0, options.journeys.length, options.journeys[0]?.severity, "Same-origin declarative steps must include proof and cannot submit forms.", "同源声明式步骤必须包含证明，并且不能提交表单。"),
    detector("performance", "Performance budgets", "性能预算", Boolean(options.budgets), settingCount(options.budgets), options.budgets?.severity, "Browser performance metrics are compared with explicit numeric limits.", "将浏览器性能指标与明确的数值上限比较。"),
    detector("network", "Network reliability budgets", "网络可靠性预算", Boolean(options.network), settingCount(options.network), options.network?.severity, "Counts and timings are retained; response bodies and query values are not.", "保留计数与耗时，不保留响应正文与查询参数值。"),
    detector("links", "Same-origin link integrity", "同源链接完整性", Boolean(options.links), settingCount(options.links), options.links?.severity, "A bounded number of allowed same-origin links are checked with HEAD only.", "仅使用 HEAD 核查有限数量且在允许范围内的同源链接。"),
    detector("metadata", "Publishing metadata", "发布元数据", Boolean(options.metadata), settingCount(options.metadata), options.metadata?.severity, "Presence, length, count, and directive facts are retained without copying page text.", "仅保留存在性、长度、数量与指令事实，不复制页面正文。"),
    detector("visual", "Reviewed visual baseline", "经审核的视觉基线", Boolean(options.visual), settingCount(options.visual), options.visual?.severity, "Baselines can change only through a separate explicit approval command.", "视觉基线只能通过独立的显式批准命令变更。"),
    detector("security", "Response and origin security", "响应与来源安全", Boolean(options.security), settingCount(options.security), options.security?.severity, "Headers, mixed content, forms, and origin counts are inspected without submission.", "在不提交数据的前提下检查响应头、混合内容、表单与来源数量。"),
    detector("privacy", "Aggregate browser-storage privacy", "浏览器存储聚合隐私", Boolean(options.privacy), settingCount(options.privacy), options.privacy?.severity, "Only aggregate cookie and Web Storage counts and bytes are retained.", "仅保留 Cookie 与 Web Storage 的聚合数量和字节数。"),
  ];
  const authorization = options.allowRemote ? "explicit-remote" : "local-or-private";
  const authentication = options.storageState ? "storage-state-referenced" : "anonymous";
  const baselineMode = options.compareReport ? "before-after" : options.baselineReport ? "regression-baseline" : "none";
  const plan = {
    schemaVersion: "1",
    toolVersion: TOOL_VERSION,
    kind: "audit-plan",
    id: "PLAN-PENDING",
    generatedAt: now.toISOString(),
    source: {
      configFile: loaded?.path ? basename(loaded.path) : null,
      policyFingerprint: detectorPolicyFingerprint(options),
    },
    target: { url: targetUrl, authorization, authentication, inspected: false },
    execution: {
      mode: options.mode,
      failOn: options.failOn,
      pageStrategy,
      pagesMax,
      maxDepth: options.crawl.maxDepth,
      explicitRoutes: options.routes.length,
      includePatterns: options.crawl.include.length,
      excludePatterns: options.crawl.exclude.length,
      scenariosPerPage,
      journeyScenarios,
      scenarioExecutionsMax,
      builtInScenarios,
      viewports: options.viewports.map(({ id, width, height, touch }) => ({ id, width, height, touch })),
      baselineMode,
    },
    summary: {
      pagesMax,
      scenariosPerPage,
      journeyScenarios,
      scenarioExecutionsMax,
      enabledDetectors: detectors.filter((item) => item.enabled).length,
      policySettings: detectors.reduce((total, item) => total + item.policySettings, 0),
    },
    detectors,
    governance: {
      qualityGate: Boolean(options.qualityGate),
      baselinePolicy: Boolean(options.baselinePolicy),
      waivers: options.waivers.length,
      owners: options.owners.length,
      baselineMode,
    },
    safety: [
      { id: "preview-only", en: "This command did not open a browser, request the target, or modify application code.", zh: "此命令没有打开浏览器、请求目标网站或修改应用代码。" },
      { id: "same-origin", en: "Navigation and declarative journeys remain same-origin and bounded by the route policy.", zh: "导航与声明式旅程保持同源，并受路由策略限制。" },
      { id: "no-submit", en: "RealityCheck does not submit forms, purchase, delete, sign out, or approve releases.", zh: "RealityCheck 不会提交表单、购买、删除、退出登录或批准发布。" },
      { id: "reviewed-repair", en: "Repair suggestions and copyable tasks require human review; no fix is applied from this plan.", zh: "修复建议与可复制任务需要人工复核；此计划不会应用任何修复。" },
    ],
    retention: [
      { id: "screenshots", retained: true, en: "Audit screenshots and bounded DOM measurements may be written as evidence.", zh: "核查截图与有限 DOM 测量值可能写入证据。" },
      { id: "request-data", retained: false, en: "Response bodies and URL query values are not retained.", zh: "不保留响应正文与 URL 查询参数值。" },
      { id: "browser-storage", retained: false, en: "Cookie names, values, storage keys, and storage values are not retained.", zh: "不保留 Cookie 名称和值，也不保留存储键和值。" },
      { id: "authentication", retained: false, en: "Authentication storage-state paths and values are not copied into the plan or report.", zh: "认证状态文件路径和值不会复制到计划或报告中。" },
      { id: "secrets", retained: false, en: "Private signing keys and credentials remain outside generated evidence.", zh: "私有签名密钥与凭据始终位于生成证据之外。" },
    ],
    warnings: [
      "This is an execution preview, not evidence that the target passed or failed.",
      "这是执行预览，不是目标通过或失败的证据。",
      `The maximum scenario count is conservative; crawl discovery may find fewer than ${pagesMax} page(s).`,
      `最大场景数按保守上限计算；实际爬取可能少于 ${pagesMax} 个页面。`,
      ...(storageStateSummary ? [`Authentication input was structurally checked (${storageStateSummary.cookies} cookie record(s), ${storageStateSummary.origins} origin record(s)) without copying values.`, `认证输入已完成结构检查（${storageStateSummary.cookies} 条 Cookie 记录、${storageStateSummary.origins} 条来源记录），未复制任何值。`] : []),
    ],
    nextCommand: loaded?.path
      ? `realitycheck audit --config ${configCommandArgument(loaded)}`
      : `realitycheck audit ${targetUrl}${options.allowRemote ? " --allow-remote" : ""} --mode ${options.mode} --fail-on ${options.failOn}`,
  };
  plan.id = computeAuditPlanId(plan);
  return plan;
}

export function renderAuditPlanMarkdown(plan, language = "en") {
  const zh = language === "zh-CN";
  const on = zh ? "启用" : "enabled";
  const off = zh ? "未启用" : "disabled";
  const lines = [
    `# ${zh ? "RealityCheck 核查计划" : "RealityCheck audit plan"}`,
    "",
    `> ${zh ? "仅预览：没有打开浏览器，也没有访问目标网站。" : "PREVIEW ONLY: no browser was opened and the target was not requested."}`,
    "",
    `- ${zh ? "计划编号" : "Plan"}: \`${plan.id}\``,
    `- ${zh ? "目标" : "Target"}: \`${plan.target.url}\``,
    `- ${zh ? "模式" : "Mode"}: \`${plan.execution.mode}\``,
    `- ${zh ? "最多页面" : "Maximum pages"}: ${plan.summary.pagesMax}`,
    `- ${zh ? "每页场景" : "Scenarios per page"}: ${plan.summary.scenariosPerPage}`,
    `- ${zh ? "最大场景执行次数" : "Maximum scenario executions"}: ${plan.summary.scenarioExecutionsMax}`,
    `- ${zh ? "已启用检测器" : "Enabled detectors"}: ${plan.summary.enabledDetectors}/${plan.detectors.length}`,
    "",
    `## ${zh ? "检查内容" : "What will be checked"}`,
    "",
    `| ${zh ? "检测器" : "Detector"} | ${zh ? "状态" : "State"} | ${zh ? "设置数" : "Settings"} | ${zh ? "说明" : "Boundary"} |`,
    "| --- | --- | ---: | --- |",
    ...plan.detectors.map((item) => `| ${markdown(zh ? item.labelZh : item.label)} | ${item.enabled ? on : off} | ${item.policySettings} | ${markdown(zh ? item.noteZh : item.note)} |`),
    "",
    `## ${zh ? "安全边界" : "Safety boundaries"}`,
    "",
    ...plan.safety.map((item) => `- ${zh ? item.zh : item.en}`),
    "",
    `## ${zh ? "数据保留" : "Data retention"}`,
    "",
    ...plan.retention.map((item) => `- **${item.retained ? (zh ? "保留" : "retained") : (zh ? "不保留" : "not retained")}** — ${zh ? item.zh : item.en}`),
    "",
    `## ${zh ? "确认后运行" : "Run after review"}`,
    "",
    `\`${plan.nextCommand}\``,
    "",
  ];
  return lines.join("\n");
}

export function renderAuditPlanHtml(plan) {
  const detectorCards = plan.detectors.map((item) => `<article class="detector ${item.enabled ? "enabled" : "disabled"}" data-state="${item.enabled ? "enabled" : "disabled"}" data-search="${html(`${item.key} ${item.label} ${item.labelZh} ${item.note} ${item.noteZh}`.toLowerCase())}"><div class="card-top"><span class="state" data-en="${item.enabled ? "ENABLED" : "DISABLED"}" data-zh-cn="${item.enabled ? "已启用" : "未启用"}">${item.enabled ? "ENABLED" : "DISABLED"}</span><code>${html(item.key)}</code></div><h2 data-en="${html(item.label)}" data-zh-cn="${html(item.labelZh)}">${html(item.label)}</h2><p data-en="${html(item.note)}" data-zh-cn="${html(item.noteZh)}">${html(item.note)}</p><footer><b>${item.policySettings}</b><span data-en="policy settings" data-zh-cn="项策略设置">policy settings</span>${item.severity ? `<span class="severity">${html(item.severity)}</span>` : ""}</footer></article>`).join("");
  const safety = plan.safety.map((item) => `<li><span>✓</span><p data-en="${html(item.en)}" data-zh-cn="${html(item.zh)}">${html(item.en)}</p></li>`).join("");
  const copyShim = `<script>(()=>{const nativeWrite=navigator.clipboard?.writeText?.bind(navigator.clipboard);const legacyCopy=text=>{const field=document.createElement('textarea');field.value=text;field.setAttribute('readonly','');field.style.position='fixed';field.style.opacity='0';document.body.appendChild(field);field.select();let copied=false;try{copied=document.execCommand('copy')}catch{}field.remove();return copied};const writeText=async text=>{try{if(nativeWrite){await nativeWrite(text);return}}catch{}if(!legacyCopy(text))throw new Error('copy unavailable')};try{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}})}catch{try{navigator.clipboard.writeText=writeText}catch{}}})();</script>`;
  const retention = plan.retention.map((item) => `<li><span class="retain ${item.retained ? "yes" : "no"}" data-en="${item.retained ? "RETAINED" : "NOT RETAINED"}" data-zh-cn="${item.retained ? "保留" : "不保留"}">${item.retained ? "RETAINED" : "NOT RETAINED"}</span><p data-en="${html(item.en)}" data-zh-cn="${html(item.zh)}">${html(item.en)}</p></li>`).join("") + copyShim;
  const payload = JSON.stringify({
    en: { title: "Know what will run before it runs.", subtitle: "A bounded, inspectable audit plan generated without opening a browser.", search: "Search detectors", shown: "shown", copy: "Copy audit command", copied: "Command copied", filterAll: "All" },
    "zh-CN": { title: "运行之前，先看懂将发生什么。", subtitle: "无需打开浏览器，生成有边界、可检查的核查计划。", search: "搜索检测器", shown: "项显示", copy: "复制核查命令", copied: "命令已复制", filterAll: "全部" },
  }).replaceAll("<", "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';script-src 'unsafe-inline';base-uri 'none';form-action 'none';connect-src 'none';img-src 'none'"><title>RealityCheck audit plan</title><style>:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#17191e;background:#f2efe9;--paper:#fffdfa;--line:#ddd7cd;--accent:#ff5c35;--good:#13795b;--muted:#676b74}*{box-sizing:border-box}body{margin:0}header,main,footer{width:min(1120px,calc(100% - 32px));margin:auto}.top{display:flex;align-items:center;justify-content:space-between;min-height:70px;border-bottom:1px solid var(--line)}.brand{font-weight:900}.brand span{color:var(--accent)}.languages,.filters{display:flex;gap:6px;flex-wrap:wrap}button{min-height:38px;border:1px solid var(--line);border-radius:8px;padding:0 12px;background:#fff;cursor:pointer}button[aria-pressed=true],.copy{color:#fff;background:#22242a}.hero{padding:62px 0 28px}.preview{display:inline-flex;padding:6px 9px;border-radius:6px;color:#8c301f;background:#ffe3da;font-size:11px;font-weight:900;letter-spacing:.1em}h1{max-width:880px;margin:16px 0 10px;font-size:clamp(42px,8vw,78px);line-height:.94;letter-spacing:-.06em}.lede{max-width:720px;color:var(--muted);font-size:18px;line-height:1.55}.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;margin:28px 0}.stat{padding:17px;border:1px solid var(--line);border-radius:12px;background:var(--paper)}.stat b{display:block;font-size:30px}.stat span{color:var(--muted);font-size:11px}.target{display:flex;flex-wrap:wrap;gap:10px 18px;padding:17px;border-radius:11px;color:#fff;background:#202229}.target code{overflow-wrap:anywhere}.target span{font-size:11px}.toolbar{display:grid;grid-template-columns:1fr minmax(220px,330px) auto;gap:12px;align-items:center;margin:32px 0 14px}.toolbar input{min-height:40px;border:1px solid var(--line);border-radius:8px;padding:0 11px}.shown{color:var(--muted);font-size:11px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:11px}.detector{min-width:0;padding:21px;border:1px solid var(--line);border-top:5px solid var(--good);border-radius:13px;background:var(--paper)}.detector.disabled{border-top-color:#aaa8a2;opacity:.72}.card-top,.detector footer{display:flex;align-items:center;justify-content:space-between;gap:10px}.state,.severity{padding:4px 7px;border-radius:5px;color:#fff;background:var(--good);font-size:10px;font-weight:900}.disabled .state{background:#777}.detector h2{font-size:20px}.detector p{min-height:64px;color:var(--muted);line-height:1.45}.detector footer{justify-content:flex-start;border-top:1px solid #e5e0d7;padding-top:13px}.detector footer b{font-size:24px}.detector footer span:not(.severity){color:var(--muted);font-size:11px}.severity{margin-left:auto;background:#555}.columns{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:34px 0}.panel{padding:23px;border:1px solid var(--line);border-radius:14px;background:var(--paper)}.panel h2{margin-top:0}.panel ul{display:grid;gap:10px;padding:0;list-style:none}.panel li{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:start}.panel li p{margin:0;color:#50545d;line-height:1.45}.retain{min-width:88px;padding:4px 6px;border-radius:5px;color:#fff;background:var(--good);font-size:9px;font-weight:900;text-align:center}.retain.no{background:#555}.run{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;margin:26px 0;padding:18px;border-radius:12px;background:#22242a}.run code{color:#fff;overflow-wrap:anywhere}.copy-status{color:#9ce1bd;font-size:11px}footer{padding:38px 0;color:var(--muted);font-size:11px}@media(max-width:850px){.stats{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr 1fr}.columns{grid-template-columns:1fr}.toolbar{grid-template-columns:1fr}.run{grid-template-columns:1fr}}@media(max-width:580px){.grid{grid-template-columns:1fr}.hero{padding-top:40px}}</style></head><body><header class="top"><div class="brand">Reality<span>Check</span> / PLAN</div><div class="languages" role="group" aria-label="Language" data-aria-en="Language" data-aria-zh-cn="语言"><button type="button" data-language="en" aria-pressed="true">EN</button><button type="button" data-language="zh-CN" aria-pressed="false">中文</button></div></header><main><section class="hero"><span class="preview" data-en="PREVIEW ONLY · NO BROWSER OPENED" data-zh-cn="仅预览 · 未打开浏览器">PREVIEW ONLY · NO BROWSER OPENED</span><h1 data-text="title">Know what will run before it runs.</h1><p class="lede" data-text="subtitle">A bounded, inspectable audit plan generated without opening a browser.</p><div class="stats"><article class="stat"><b>${plan.summary.pagesMax}</b><span data-en="maximum pages" data-zh-cn="最多页面">maximum pages</span></article><article class="stat"><b>${plan.summary.scenariosPerPage}</b><span data-en="scenarios per page" data-zh-cn="每页场景">scenarios per page</span></article><article class="stat"><b>${plan.summary.scenarioExecutionsMax}</b><span data-en="maximum executions" data-zh-cn="最大执行次数">maximum executions</span></article><article class="stat"><b>${plan.summary.enabledDetectors}/${plan.detectors.length}</b><span data-en="detectors enabled" data-zh-cn="检测器已启用">detectors enabled</span></article><article class="stat"><b>${plan.summary.policySettings}</b><span data-en="policy settings" data-zh-cn="策略设置">policy settings</span></article></div><div class="target"><code>${html(plan.target.url)}</code><span>${html(plan.execution.mode)} · ${html(plan.execution.pageStrategy)} · fail-on ${html(plan.execution.failOn)}</span><span>${html(plan.id)}</span></div></section><div class="toolbar"><div class="filters" role="group" aria-label="Detector state" data-aria-en="Detector state" data-aria-zh-cn="检测器状态"><button type="button" data-filter="all" aria-pressed="true" data-text="filterAll">All</button><button type="button" data-filter="enabled" aria-pressed="false" data-en="Enabled" data-zh-cn="已启用">Enabled</button><button type="button" data-filter="disabled" aria-pressed="false" data-en="Disabled" data-zh-cn="未启用">Disabled</button></div><input type="search" data-search placeholder="Search detectors" aria-label="Search detectors" data-aria-en="Search detectors" data-aria-zh-cn="搜索检测器"><span class="shown" role="status" aria-live="polite" data-shown></span></div><section class="grid">${detectorCards}</section><section class="columns"><article class="panel"><h2 data-en="Safety boundaries" data-zh-cn="安全边界">Safety boundaries</h2><ul>${safety}</ul></article><article class="panel"><h2 data-en="Data retention" data-zh-cn="数据保留">Data retention</h2><ul>${retention}</ul></article></section><div class="run"><code>${html(plan.nextCommand)}</code><button class="copy" type="button" data-copy data-text="copy">Copy audit command</button><span class="copy-status" role="status" aria-live="polite"></span></div></main><footer data-en="This plan explains intended coverage. Run the audit to collect evidence, then review findings before changing code." data-zh-cn="此计划用于解释预期覆盖范围。运行核查后才能收集证据，修改代码前仍需复核问题。">This plan explains intended coverage. Run the audit to collect evidence, then review findings before changing code.</footer><script>const i18n=${payload};let language=localStorage.getItem("realitycheck-plan-language")||((navigator.language||"").toLowerCase().startsWith("zh")?"zh-CN":"en");let filter="all";const search=document.querySelector("[data-search]");const apply=()=>{document.documentElement.lang=language;document.title=language==="zh-CN"?"RealityCheck 核查计划":"RealityCheck audit plan";document.querySelectorAll("[data-language]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.language===language)));document.querySelectorAll("[data-en]").forEach(e=>e.textContent=e.dataset[language==="zh-CN"?"zhCn":"en"]);document.querySelectorAll("[data-text]").forEach(e=>e.textContent=i18n[language][e.dataset.text]);document.querySelectorAll("[data-aria-en]").forEach(e=>e.setAttribute("aria-label",e.dataset[language==="zh-CN"?"ariaZhCn":"ariaEn"]));search.placeholder=i18n[language].search;const query=search.value.trim().toLowerCase();let shown=0;document.querySelectorAll(".detector").forEach(card=>{card.hidden=(filter!=="all"&&card.dataset.state!==filter)||(query&&!card.dataset.search.includes(query));if(!card.hidden)shown+=1});document.querySelector("[data-shown]").textContent=shown+"/${plan.detectors.length} "+i18n[language].shown};document.querySelectorAll("[data-language]").forEach(b=>b.addEventListener("click",()=>{language=b.dataset.language;localStorage.setItem("realitycheck-plan-language",language);document.querySelector(".copy-status").textContent="";apply()}));document.querySelectorAll("[data-filter]").forEach(b=>b.addEventListener("click",()=>{filter=b.dataset.filter;document.querySelectorAll("[data-filter]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));apply()}));search.addEventListener("input",apply);document.querySelector("[data-copy]").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(${JSON.stringify(plan.nextCommand)});document.querySelector(".copy-status").textContent=i18n[language].copied}catch{document.querySelector(".copy-status").textContent=""}});apply();</script></body></html>`;
}

export function writeAuditPlan(plan, outputDirectory) {
  const output = resolve(outputDirectory);
  mkdirSync(output, { recursive: true });
  const jsonPath = join(output, "audit-plan.json");
  const markdownPath = join(output, "audit-plan.md");
  const markdownZhPath = join(output, "audit-plan.zh-CN.md");
  const htmlPath = join(output, "audit-plan.html");
  writeFileSync(jsonPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, renderAuditPlanMarkdown(plan, "en"), "utf8");
  writeFileSync(markdownZhPath, renderAuditPlanMarkdown(plan, "zh-CN"), "utf8");
  writeFileSync(htmlPath, renderAuditPlanHtml(plan), "utf8");
  return { jsonPath, markdownPath, markdownZhPath, htmlPath, plan };
}

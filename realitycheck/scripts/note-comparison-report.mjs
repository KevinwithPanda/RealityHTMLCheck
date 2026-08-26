const STATES = Object.freeze(["new", "worsened", "unverified", "resolved", "persistent"]);

const STATE_TEXT = Object.freeze({
  new: { en: "NEW", zhCN: "新增" },
  worsened: { en: "WORSENED", zhCN: "恶化" },
  unverified: { en: "UNVERIFIED", zhCN: "未核验" },
  resolved: { en: "RESOLVED", zhCN: "已解决" },
  persistent: { en: "PERSISTENT", zhCN: "仍存在" },
});

const REASON_TEXT = Object.freeze({
  "not-present-in-baseline": { en: "This rule was not present in the baseline scope.", zhCN: "基线范围中没有这项规则。" },
  "not-detected-in-complete-scope": { en: "The same complete scope no longer detects this rule.", zhCN: "相同完整范围已不再检出这项规则。" },
  "affected-count-increased": { en: "The number of affected occurrences increased.", zhCN: "受影响位置数量增加。" },
  "severity-increased": { en: "The finding severity increased.", zhCN: "问题严重级别提高。" },
  "severity-and-affected-count-increased": { en: "Both severity and affected occurrences increased.", zhCN: "严重级别和受影响位置数量均增加。" },
  "affected-count-decreased-but-persists": { en: "Fewer occurrences remain, but the rule is still detected.", zhCN: "受影响位置减少，但问题仍然存在。" },
  "still-detected": { en: "The same rule is still detected.", zhCN: "同一规则仍然被检出。" },
  "after-discovery-truncated": { en: "The current discovery was truncated, so disappearance cannot prove resolution.", zhCN: "本次文件发现被截断，问题消失不能证明已解决。" },
  "html-scope-missing": { en: "The baseline HTML file is absent from the current scope.", zhCN: "本次范围缺少基线中的 HTML 文件。" },
  "html-scope-newly-excluded": { en: "This HTML file was checked by the baseline but is newly excluded now; approve a new reviewed baseline before the gate can pass.", zhCN: "该 HTML 文件在基线中曾被检查，但本次被新增排除；请在复核并批准新基线后再让门禁通过。" },
  "package-scope-not-verified": { en: "The current package scope was not completely verified.", zhCN: "本次文件包范围未得到完整核验。" },
  "package-html-scope-missing": { en: "One or more baseline HTML files are missing from the package scope.", zhCN: "文件包范围缺少一个或多个基线 HTML 文件。" },
  "package-scope-contracted": { en: "The current package inventory is smaller than the baseline inventory.", zhCN: "本次文件包清单小于基线清单。" },
  "package-file-scope-missing": { en: "One or more exact baseline package paths are missing from the current inventory.", zhCN: "本次文件包清单缺少一个或多个基线精确路径。" },
  "package-scope-identity-unavailable": { en: "An exact package path inventory is unavailable, so disappearance cannot prove resolution.", zhCN: "缺少精确文件包路径清单，因此问题消失不能证明已解决。" },
  "note-ruleset-drift": { en: "The deterministic note ruleset changed between runs; content changes cannot be classified safely.", zhCN: "两次运行使用的确定性笔记规则集不同，无法安全归类内容变化。" },
  "note-ruleset-identity-unavailable": { en: "One run does not identify its note ruleset, so changes remain unverified.", zhCN: "其中一次运行没有规则集身份，因此变化保持未核验。" },
  "source-archive-identity-unavailable": { en: "Only one run identifies an imported source archive, so provenance scope differs.", zhCN: "只有一次运行记录了导入源压缩包，因此来源范围不一致。" },
  "legacy-baseline-package-scope": { en: "The legacy baseline did not record trustworthy package ownership.", zhCN: "旧版基线没有记录可信的文件包问题归属。" },
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function localized(value, language) {
  if (!value || typeof value !== "object") return "";
  return language === "zh-CN" ? value.zhCN : value.en;
}

function bilingualElement(tag, value, attributes = "") {
  return `<${tag}${attributes} data-en="${escapeHtml(value.en)}" data-zh-cn="${escapeHtml(value.zhCN)}">${escapeHtml(value.en)}</${tag}>`;
}

function itemCard(item) {
  const finding = item.after || item.before || {};
  const scope = item.scope?.kind === "html"
    ? { en: item.scope.path, zhCN: item.scope.path }
    : { en: "File package", zhCN: "文件包" };
  const reason = REASON_TEXT[item.reason] || { en: item.reason, zhCN: item.reason };
  const beforeCount = item.beforeAffectedCount === null ? "—" : String(item.beforeAffectedCount);
  const afterCount = item.afterAffectedCount === null ? "—" : String(item.afterAffectedCount);
  return `<article class="item" data-state="${escapeHtml(item.state)}">
    <div class="item-head"><span class="state ${escapeHtml(item.state)}" data-en="${STATE_TEXT[item.state].en}" data-zh-cn="${STATE_TEXT[item.state].zhCN}">${STATE_TEXT[item.state].en}</span><code>${escapeHtml(item.ruleId)}</code></div>
    ${bilingualElement("h3", finding.title || { en: item.ruleId, zhCN: item.ruleId })}
    <p class="scope"><span data-en="Scope" data-zh-cn="范围">Scope</span>: <code>${escapeHtml(scope.en)}</code></p>
    <p class="counts"><span data-en="Affected occurrences" data-zh-cn="受影响位置">Affected occurrences</span>: <strong>${beforeCount} → ${afterCount}</strong></p>
    ${bilingualElement("p", reason, ' class="reason"')}
  </article>`;
}

/** Render a dependency-free, self-contained bilingual note comparison. */
export function renderNoteComparisonHtml(comparison) {
  if (!comparison || comparison.kind !== "html-note-check-comparison") throw new TypeError("comparison must be an HTML note comparison");
  const counts = comparison.counts || {};
  const regressionCounts = comparison.regressionsByLevel || { error: 0, warning: 0, advice: 0, total: counts.regressions || 0 };
  const gateFailed = Boolean(comparison.gate?.failed);
  const sections = STATES.map((state) => {
    const items = Array.isArray(comparison[state]) ? comparison[state] : [];
    return `<section class="group"><header><h2 data-en="${STATE_TEXT[state].en}" data-zh-cn="${STATE_TEXT[state].zhCN}">${STATE_TEXT[state].en}</h2><strong>${items.length}</strong></header>${items.length ? items.map(itemCard).join("") : '<p class="empty" data-en="None" data-zh-cn="无">None</p>'}</section>`;
  }).join("");
  const warnings = (comparison.warnings || []).map((warning) => bilingualElement("p", warning.message, ' class="warning"')).join("");
  const htmlExclusions = comparison.scopeExclusions?.html || { patterns: [], files: [], count: 0, newlyExcludedScopes: 0 };
  const visibleExcludedFiles = (htmlExclusions.files || []).slice(0, 50);
  const hiddenExcludedFiles = Math.max(0, Number(htmlExclusions.count || 0) - visibleExcludedFiles.length);
  const exclusionNotice = htmlExclusions.patterns.length ? `<section class="warning"><b data-en="Auditable HTML exclusions" data-zh-cn="可审计的 HTML 排除规则">Auditable HTML exclusions</b><br><span data-en="${escapeHtml(`${htmlExclusions.patterns.length} pattern(s) excluded ${htmlExclusions.count} present file(s); ${htmlExclusions.newlyExcludedScopes || 0} scope(s) are newly excluded versus the baseline. Files remain known package entries and cross-note targets; their own per-file rules are not run.`)}" data-zh-cn="${escapeHtml(`${htmlExclusions.patterns.length} 条规则排除 ${htmlExclusions.count} 个当前存在的文件；相较基线有 ${htmlExclusions.newlyExcludedScopes || 0} 个范围为新增排除。文件仍是已知文件包条目和跨笔记目标，但不会运行其自身的逐文件规则。`)}">${escapeHtml(`${htmlExclusions.patterns.length} pattern(s) excluded ${htmlExclusions.count} present file(s); ${htmlExclusions.newlyExcludedScopes || 0} scope(s) are newly excluded versus the baseline. Files remain known package entries and cross-note targets; their own per-file rules are not run.`)}</span><br><code>${htmlExclusions.patterns.map(escapeHtml).join(" · ")}</code><details><summary data-en="Matched paths preview (${visibleExcludedFiles.length}/${htmlExclusions.count}; complete list in comparison.json)" data-zh-cn="命中路径预览（${visibleExcludedFiles.length}/${htmlExclusions.count}；完整清单见 comparison.json）">Matched paths preview (${visibleExcludedFiles.length}/${htmlExclusions.count}; complete list in comparison.json)</summary>${visibleExcludedFiles.length ? visibleExcludedFiles.map((path) => `<code>${escapeHtml(path)}</code><br>`).join("") : '<span data-en="No current matches" data-zh-cn="当前无命中">No current matches</span>'}${hiddenExcludedFiles ? `<br><span data-en="${hiddenExcludedFiles} additional path(s) are retained in comparison.json." data-zh-cn="另有 ${hiddenExcludedFiles} 个路径保留在 comparison.json 中。">${hiddenExcludedFiles} additional path(s) are retained in comparison.json.</span>` : ""}</details></section>` : "";
  const gateTitle = gateFailed
    ? { en: "Regression gate failed", zhCN: "回归门禁未通过" }
    : { en: "Regression gate passed", zhCN: "回归门禁已通过" };
  const gateDetail = {
    en: `Only new, worsened, and unverified error/warning regressions are gated at “${comparison.gate?.failOn || "never"}”. Persistent baseline debt does not keep CI red.`,
    zhCN: `门禁级别为“${comparison.gate?.failOn || "never"}”，只阻止新增、恶化和未核验的错误/警告回归；基线中持续存在的已知问题不会让 CI 永久失败。`,
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RealityCheck Note Comparison</title>
<style>
:root{color-scheme:light;--ink:#1c1d21;--muted:#626774;--line:#dedbd4;--paper:#fff;--canvas:#f5f3ef;--accent:#ff5c35;--error:#b42318;--warning:#9a5b05;--ok:#17664d;font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:var(--ink);background:var(--canvas)}*{box-sizing:border-box}body{margin:0}.wrap{width:min(980px,calc(100% - 32px));margin:auto}.top{padding:13px 0;background:#191b20;color:#fff}.top .wrap{display:flex;align-items:center;gap:10px}.top span{color:#b8bbc3;font-size:12px}.language{display:flex;gap:4px;margin-left:auto}.language button{min-height:32px;padding:0 10px;border:1px solid #444750;border-radius:7px;background:#23252b;color:#b8bbc3;font-weight:800;cursor:pointer}.language button[aria-pressed=true]{background:#fff;color:#17191f}.hero{padding:38px 0 16px}.eyebrow{margin:0 0 8px;color:var(--accent);font-size:11px;font-weight:900;letter-spacing:.12em}.hero h1{margin:0;font-size:clamp(30px,5vw,48px);letter-spacing:-.045em}.hero>p:not(.eyebrow){max-width:760px;color:var(--muted);line-height:1.6}.gate{padding:18px 20px;border:1px solid var(--line);border-left:5px solid ${gateFailed ? "var(--error)" : "var(--ok)"};border-radius:12px;background:var(--paper)}.gate h2{margin:0 0 7px;font-size:21px}.gate p{margin:0;color:var(--muted);font-size:13px;line-height:1.55}.metrics{display:grid;grid-template-columns:repeat(5,1fr);margin:16px 0;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--paper)}.metric{padding:16px;border-left:1px solid var(--line)}.metric:first-child{border:0}.metric strong{display:block;font-size:27px}.metric span{color:var(--muted);font-size:10px}.regression-levels{margin:0 0 18px;color:var(--muted);font-size:12px}.warning{padding:12px 14px;border-radius:9px;background:#fff0bd;color:#534a2e;font-size:12px}.group{margin:14px 0;border:1px solid var(--line);border-radius:12px;background:var(--paper);overflow:hidden}.group>header{display:flex;justify-content:space-between;align-items:center;padding:15px 18px;border-bottom:1px solid var(--line)}.group h2{margin:0;font-size:18px}.group>header strong{font-size:22px}.item{margin:10px;padding:16px;border:1px solid var(--line);border-radius:10px}.item-head{display:flex;align-items:center;gap:9px}.state{padding:4px 7px;border-radius:5px;font-size:9px;font-weight:900}.state.new,.state.worsened,.state.unverified{color:#fff;background:var(--error)}.state.resolved{color:#fff;background:var(--ok)}.state.persistent{color:#5b3500;background:#ffe6aa}.item h3{margin:11px 0 7px;font-size:18px}.item p{margin:5px 0;color:var(--muted);font-size:12px;line-height:1.5}.item code{font-size:10px}.counts strong{color:var(--ink)}.empty{margin:0;padding:18px;color:var(--muted)}.footer{padding:20px 0 36px;color:var(--muted);font-size:11px}@media(max-width:700px){.metrics{grid-template-columns:1fr 1fr}.metric:first-child{grid-column:1/-1}.metric:nth-child(even){border-left:0}}
</style></head><body>
<header class="top"><div class="wrap"><b>RealityCheck Note</b><span data-en="Baseline comparison" data-zh-cn="基线差异比较">Baseline comparison</span><div class="language" role="group" aria-label="Language"><button type="button" data-language="en" aria-pressed="true">EN</button><button type="button" data-language="zh-CN" aria-pressed="false">中文</button></div></div></header>
<main class="wrap"><section class="hero"><p class="eyebrow" data-en="REGRESSION EVIDENCE" data-zh-cn="回归证据">REGRESSION EVIDENCE</p><h1 data-en="What changed since the baseline" data-zh-cn="相较基线发生了什么变化">What changed since the baseline</h1><p data-en="RealityCheck compares stable rule identities inside the same HTML or package scope. A removed or incompletely discovered file is never presented as resolved." data-zh-cn="RealityCheck 在同一 HTML 或文件包范围内比较稳定规则身份；被删除或未完整发现的文件绝不会被伪装成已解决。">RealityCheck compares stable rule identities inside the same HTML or package scope. A removed or incompletely discovered file is never presented as resolved.</p></section>
<section class="gate">${bilingualElement("h2", gateTitle)}${bilingualElement("p", gateDetail)}</section>
<section class="metrics">${STATES.map((state) => `<div class="metric"><strong>${Number(counts[state] || 0)}</strong><span data-en="${STATE_TEXT[state].en}" data-zh-cn="${STATE_TEXT[state].zhCN}">${STATE_TEXT[state].en}</span></div>`).join("")}</section>
<p class="regression-levels"><span data-en="Gating regressions by level" data-zh-cn="按级别统计的门禁回归">Gating regressions by level</span>: ${Number(regressionCounts.error || 0)} error · ${Number(regressionCounts.warning || 0)} warning · ${Number(regressionCounts.advice || 0)} advice</p>
${warnings}${exclusionNotice}${sections}</main>
<footer class="footer wrap" data-en="Generated locally from bounded machine evidence. Source notes were not executed or uploaded." data-zh-cn="根据有限的机器证据在本地生成；未执行或上传源笔记。">Generated locally from bounded machine evidence. Source notes were not executed or uploaded.</footer>
<script>const buttons=[...document.querySelectorAll('[data-language]')],items=[...document.querySelectorAll('[data-en][data-zh-cn]')];function setLanguage(language){document.documentElement.lang=language;for(const item of items)item.textContent=language==='zh-CN'?item.dataset.zhCn:item.dataset.en;for(const button of buttons)button.setAttribute('aria-pressed',String(button.dataset.language===language))}for(const button of buttons)button.addEventListener('click',()=>setLanguage(button.dataset.language));</script>
</body></html>`;
}

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { validateArtifactFiles } from "./artifact-validator.mjs";
import { TOOL_VERSION } from "./version.mjs";

const CATALOGABLE_FILES = new Set(["report.json", "verification.json", "site-report.json", "site-verification.json", "trend.json", "repair-plan.json", "evidence-attestation.json", "evidence-trust-report.json", "policy-review.json"]);
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "__pycache__"]);

function html(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function markdown(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\r", " ").replaceAll("\n", " ");
}

function portablePath(fromDirectory, target) {
  const value = relative(fromDirectory, target).split(sep).join("/");
  return value || basename(target);
}

function collectCatalogableFiles(inputPaths, outputDirectory) {
  const found = new Set();
  const resolvedOutput = resolve(outputDirectory);
  const visit = (candidate) => {
    const path = resolve(candidate);
    if (!existsSync(path)) throw new Error(`${path}: catalog source does not exist`);
    const stats = statSync(path);
    if (stats.isFile()) {
      if (CATALOGABLE_FILES.has(basename(path)) && dirname(path) !== resolvedOutput) found.add(path);
      else throw new Error(`${path}: expected a RealityCheck report artifact`);
      return;
    }
    if (!stats.isDirectory()) throw new Error(`${path}: expected a file or directory`);
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name) && resolve(child) !== resolvedOutput) visit(child);
      else if (entry.isFile() && CATALOGABLE_FILES.has(entry.name)) found.add(resolve(child));
    }
  };
  for (const path of inputPaths) visit(path);
  return [...found].sort();
}

function coverage(scenarios = []) {
  const covered = scenarios.filter((scenario) => ["passed", "completed-with-findings"].includes(scenario.status)).length;
  return { covered, total: scenarios.length };
}

function ownerNames(items = []) {
  return [...new Set(items.map((item) => item.ownership?.name).filter(Boolean))].sort();
}

function linkFor(path, outputDirectory) {
  const htmlPath = path.replace(/\.json$/i, ".html");
  const markdownPath = path.replace(/\.json$/i, ".md");
  return portablePath(outputDirectory, existsSync(htmlPath) ? htmlPath : existsSync(markdownPath) ? markdownPath : path);
}

function entryFromArtifact(value, path, outputDirectory) {
  if (value.kind === "policy-review") {
    return {
      id: `policy-${value.sources.before.fingerprint.slice(7, 19)}-${value.sources.after.fingerprint.slice(7, 19)}`,
      kind: "policy-review",
      state: value.summary.gateFailed ? "failed" : "passed",
      title: `${value.summary.changes} policy changes`,
      generatedAt: value.generatedAt,
      gateFailed: value.summary.gateFailed,
      changes: {
        weakened: value.summary.weakened,
        strengthened: value.summary.strengthened,
        review: value.summary.review,
      },
      artifactPath: portablePath(outputDirectory, path),
      visualPath: linkFor(path, outputDirectory),
    };
  }
  if (value.kind === "evidence-trust-report") {
    return {
      id: `trust-${value.manifest.runId}-${value.manifest.sha256.slice(7, 19)}`,
      kind: "evidence-trust-report",
      state: value.state === "trusted" ? "passed" : "failed",
      title: `${value.state === "trusted" ? "Trusted" : "Rejected"} evidence · ${value.signer.name || value.manifest.runId}`,
      generatedAt: value.generatedAt,
      gateFailed: value.state !== "trusted",
      changes: { passedChecks: Object.values(value.checks).filter(Boolean).length, failedChecks: Object.values(value.checks).filter((item) => !item).length },
      artifactPath: portablePath(outputDirectory, path),
      visualPath: linkFor(path, outputDirectory),
    };
  }
  if (value.kind === "evidence-attestation") {
    return {
      id: `attestation-${value.manifest.runId}-${value.signer.keyId.slice(7, 19)}`,
      kind: "evidence-attestation",
      state: "informational",
      title: `Signed evidence for ${value.manifest.runId}`,
      generatedAt: value.createdAt,
      changes: { manifestBytes: value.manifest.bytes },
      artifactPath: portablePath(outputDirectory, path),
      visualPath: linkFor(path, outputDirectory),
    };
  }
  if (value.kind === "repair-plan") {
    return {
      id: `repair-${value.source.runId}`,
      kind: "repair-plan",
      state: "informational",
      title: `${value.summary.items} item repair plan`,
      target: value.source.target,
      owners: ownerNames(value.items),
      changes: value.summary,
      artifactPath: portablePath(outputDirectory, path),
      visualPath: linkFor(path, outputDirectory),
    };
  }
  if (value.kind === "site-audit") {
    return {
      id: value.id,
      kind: "site-audit",
      state: value.summary.gateFailed ? "failed" : "passed",
      title: `${value.summary.pagesCompleted}/${value.summary.pagesRequested} pages`,
      target: value.baseUrl,
      startedAt: value.startedAt,
      finishedAt: value.finishedAt,
      score: value.summary.averageScore,
      minimumScore: value.summary.minimumScore,
      gateFailed: value.summary.gateFailed,
      findings: value.summary.findings,
      waivedFindings: value.summary.waivedFindings || 0,
      owners: [...new Set(value.pages.flatMap((page) => page.owners || []))].sort(),
      gateViolations: value.pages.flatMap((page) => (page.gateViolations || []).map((violation) => ({ page: page.url, ...violation }))),
      coverage: { covered: value.summary.scenariosCovered, total: value.pages.filter((page) => page.status === "completed").reduce((sum, page) => sum + Object.keys(page.scenarioStatuses).length, 0) },
      artifactPath: portablePath(outputDirectory, path),
      visualPath: linkFor(path, outputDirectory),
    };
  }
  if (value.kind === "site-verification") {
    return {
      id: `${value.before.id}--${value.after.id}`,
      kind: "site-verification",
      state: value.threshold.met ? "failed" : "passed",
      title: "Site before/after proof",
      score: value.after.averageScore,
      minimumScore: value.after.minimumScore,
      scoreDelta: value.scoreDelta,
      gateFailed: value.threshold.met,
      changes: value.counts,
      gateViolations: value.policyViolations || [],
      owners: ownerNames([...(value.resolved || []), ...(value.remaining || []), ...(value.worsened || []), ...(value.new || []), ...(value.unverified || [])]),
      artifactPath: portablePath(outputDirectory, path),
      visualPath: linkFor(path, outputDirectory),
    };
  }
  if (value.kind === "quality-trend") {
    return {
      id: `trend-${value.generatedAt}`,
      kind: "quality-trend",
      state: "informational",
      title: `${value.summary.targets} targets / ${value.summary.runs} runs`,
      generatedAt: value.generatedAt,
      score: value.summary.latestAverage,
      changes: { regressed: value.summary.regressedTargets, improved: value.summary.improvedTargets },
      artifactPath: portablePath(outputDirectory, path),
      visualPath: linkFor(path, outputDirectory),
    };
  }
  if (value.before && value.after && value.threshold) {
    return {
      id: `${value.before.runId}--${value.after.runId}`,
      kind: "page-verification",
      state: value.threshold.met ? "failed" : "passed",
      title: "Page before/after proof",
      score: value.after.score,
      scoreDelta: value.scoreDelta,
      gateFailed: value.threshold.met,
      changes: value.counts,
      gateViolations: value.threshold.violations || [],
      owners: ownerNames([...(value.resolved || []), ...(value.remaining || []), ...(value.worsened || []), ...(value.new || []), ...(value.unverified || [])]),
      artifactPath: portablePath(outputDirectory, path),
      visualPath: linkFor(path, outputDirectory),
    };
  }
  return {
    id: value.run.id,
    kind: "page-audit",
    state: value.threshold.met ? "failed" : "passed",
    title: value.target.title || "Untitled page",
    target: value.target.finalUrl,
    startedAt: value.run.startedAt,
    finishedAt: value.run.finishedAt,
    score: value.score.overall,
    gateFailed: value.threshold.met,
    findings: value.score.counts,
    waivedFindings: value.score.waivedFindings || 0,
    gateViolations: value.threshold.violations || [],
    owners: ownerNames(value.findings),
    coverage: coverage(value.scenarios),
    artifactPath: portablePath(outputDirectory, path),
    visualPath: linkFor(path, outputDirectory),
  };
}

export function buildArtifactCatalog(inputPaths, outputDirectory, { now = new Date() } = {}) {
  if (!inputPaths.length) throw new Error("catalog requires at least one report file or directory");
  const output = resolve(outputDirectory);
  const files = collectCatalogableFiles(inputPaths, output);
  if (!files.length) throw new Error("no catalogable RealityCheck artifacts were found");
  const validation = validateArtifactFiles(files);
  const validPaths = new Set(validation.filter((result) => result.valid).map((result) => result.path));
  const warnings = validation.filter((result) => !result.valid).map((result) => `${basename(dirname(result.path))}/${basename(result.path)} was skipped because it did not satisfy its published schema.`);
  const entries = files.filter((path) => validPaths.has(path)).map((path) => entryFromArtifact(JSON.parse(readFileSync(path, "utf8")), path, output));
  if (!entries.length) throw new Error("no valid RealityCheck artifacts were available for the catalog");
  entries.sort((left, right) => String(right.startedAt || right.generatedAt || "").localeCompare(String(left.startedAt || left.generatedAt || "")) || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
  const gateEntries = entries.filter((entry) => entry.state !== "informational");
  const auditEntries = entries.filter((entry) => ["page-audit", "site-audit"].includes(entry.kind));
  return {
    schemaVersion: "1",
    toolVersion: TOOL_VERSION,
    kind: "artifact-catalog",
    generatedAt: now.toISOString(),
    summary: {
      artifacts: entries.length,
      audits: auditEntries.length,
      verifications: entries.filter((entry) => entry.kind.endsWith("verification")).length,
      repairPlans: entries.filter((entry) => entry.kind === "repair-plan").length,
      trends: entries.filter((entry) => entry.kind === "quality-trend").length,
      policyReviews: entries.filter((entry) => entry.kind === "policy-review").length,
      attestations: entries.filter((entry) => entry.kind === "evidence-attestation").length,
      trustReports: entries.filter((entry) => entry.kind === "evidence-trust-report").length,
      passing: gateEntries.filter((entry) => entry.state === "passed").length,
      failing: gateEntries.filter((entry) => entry.state === "failed").length,
      latestAuditScore: auditEntries[0]?.score ?? null,
    },
    entries,
    warnings,
  };
}

export function renderCatalogMarkdown(catalog) {
  const lines = [
    "# RealityCheck artifact catalog",
    "",
    `Artifacts: **${catalog.summary.artifacts}** · Audits: **${catalog.summary.audits}** · Proofs: **${catalog.summary.verifications}** · Repair plans: **${catalog.summary.repairPlans}** · Trends: **${catalog.summary.trends}** · Policy reviews: **${catalog.summary.policyReviews}** · Attestations: **${catalog.summary.attestations}** · Trust reports: **${catalog.summary.trustReports}**`,
    `Passing: **${catalog.summary.passing}** · Failing: **${catalog.summary.failing}**`,
    "",
    "| State | Type | Title / target | Score | Delta | Visual | JSON |",
    "|---|---|---|---:|---:|---|---|",
  ];
  for (const entry of catalog.entries) {
    const label = entry.target ? `${entry.title} — ${entry.target}` : entry.title;
    lines.push(`| ${entry.state} | ${entry.kind} | ${markdown(label)} | ${entry.score ?? "—"} | ${entry.scoreDelta === undefined ? "—" : `${entry.scoreDelta >= 0 ? "+" : ""}${entry.scoreDelta}`} | [Open](${entry.visualPath}) | [JSON](${entry.artifactPath}) |`);
  }
  if (catalog.warnings.length) lines.push("", "## Warnings", "", ...catalog.warnings.map((warning) => `- ${markdown(warning)}`));
  return `${lines.join("\n")}\n`;
}

export function renderCatalogHtml(catalog) {
  const cards = catalog.entries.map((entry) => {
    const delta = entry.scoreDelta === undefined ? "" : `<span class="delta ${entry.scoreDelta < 0 ? "down" : entry.scoreDelta > 0 ? "up" : "flat"}">${entry.scoreDelta >= 0 ? "+" : ""}${entry.scoreDelta}</span>`;
    const target = entry.target ? `<p class="target">${html(entry.target)}</p>` : "";
    const changes = entry.changes ? Object.entries(entry.changes).map(([name, value]) => `<span><b>${html(value)}</b> ${html(name)}</span>`).join("") : "";
    const metrics = entry.findings ? `<span><b>${entry.findings.critical}</b> critical</span><span><b>${entry.findings.major}</b> major</span><span><b>${entry.waivedFindings || 0}</b> waived</span>` : changes;
    const gateReasons = (entry.gateViolations || []).map((violation) => `<span class="gate-reason"><b data-en="Gate policy" data-zh="门禁策略">Gate policy</b> · ${html(violation.code)} ${html(violation.actual)}/${html(violation.expected)}</span>`).join("");
    const owners = (entry.owners || []).map((owner) => `<span class="owner"><b data-en="Owner" data-zh="负责团队">Owner</b> · ${html(owner)}</span>`).join("");
    const extra = `${metrics}${gateReasons}${owners}`;
    return `<article class="entry" data-state="${entry.state}" data-kind="${entry.kind}"><div class="entry-top"><span class="kind">${html(entry.kind)}</span><span class="state ${entry.state}" data-en="${entry.state}" data-zh="${entry.state === "passed" ? "通过" : entry.state === "failed" ? "失败" : "信息"}">${html(entry.state)}</span></div><div class="score"><strong>${entry.score ?? "—"}</strong>${delta}</div><h2>${html(entry.title)}</h2>${target}<div class="meta">${extra}</div><div class="actions"><a class="primary" href="${html(entry.visualPath)}" data-en="Open artifact →" data-zh="打开产物 →">Open artifact →</a><a href="${html(entry.artifactPath)}">JSON</a></div></article>`;
  }).join("");
  const warningHtml = catalog.warnings.map((warning) => `<li>${html(warning)}</li>`).join("");
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';script-src 'unsafe-inline';base-uri 'none';form-action 'none'"><title>RealityCheck artifact catalog</title><style>
:root{color-scheme:light;--ink:#18191d;--muted:#686b74;--line:#e3dfd7;--paper:#fffdfa;--canvas:#f3f0ea;--orange:#ff5c35;--good:#13795b;--bad:#bd2840;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;color:var(--ink);background:var(--canvas)}.topbar{color:#fff;background:#17181c}.topbar-inner,.container{width:min(1160px,calc(100% - 40px));margin:auto}.topbar-inner{min-height:70px;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{font-weight:900}.brand span{color:#ff8b70}.languages{display:flex;padding:3px;border:1px solid #41434a;border-radius:9px}.languages button{border:0;border-radius:6px;padding:7px 10px;color:#b9bbc3;background:transparent;font:750 12px inherit;cursor:pointer}.languages button[aria-pressed=true]{color:#17181c;background:#fff}.hero{padding:64px 0 38px}.eyebrow{margin:0;color:var(--orange);font-size:12px;font-weight:850;letter-spacing:.12em}h1{max-width:840px;margin:12px 0 16px;font-size:clamp(42px,7vw,76px);line-height:.95;letter-spacing:-.06em}.lede{max-width:760px;color:var(--muted);line-height:1.65}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(108px,1fr));gap:9px;margin-bottom:35px}.stat{padding:17px;border:1px solid var(--line);border-radius:14px;background:var(--paper)}.stat b{display:block;font-size:29px}.stat span{color:var(--muted);font-size:11px}.toolbar{display:grid;grid-template-columns:1fr minmax(220px,320px) auto;gap:12px;align-items:center;margin-bottom:16px}.filters{display:flex;flex-wrap:wrap;gap:7px}.filters button{border:1px solid var(--line);border-radius:8px;padding:8px 11px;color:var(--ink);background:var(--paper);font:750 12px inherit;cursor:pointer}.filters button[aria-pressed=true]{color:#fff;background:#24262b}.search{width:100%;border:1px solid var(--line);border-radius:9px;padding:10px 12px;background:var(--paper);font:13px inherit}.count{color:var(--muted);font-size:12px}.entries{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.entry{min-width:0;padding:23px;border:1px solid var(--line);border-radius:19px;background:var(--paper);box-shadow:0 12px 34px rgb(37 31 24 / 4%)}.entry[hidden]{display:none}.entry-top,.score,.actions{display:flex;align-items:center;justify-content:space-between;gap:12px}.kind{color:var(--muted);font:750 10px ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:uppercase}.state{padding:5px 8px;border-radius:999px;font-size:10px;font-weight:850;text-transform:uppercase}.state.passed{color:var(--good);background:#e4f4ee}.state.failed{color:var(--bad);background:#ffe5ea}.state.informational{color:#315f8d;background:#e5f0fb}.score{justify-content:flex-start;margin-top:22px}.score strong{font-size:45px;letter-spacing:-.06em}.delta{font-weight:850}.delta.up{color:var(--good)}.delta.down{color:var(--bad)}.delta.flat{color:var(--muted)}.entry h2{margin:10px 0 6px;font-size:23px}.target{margin:0;color:var(--muted);font:11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.meta{display:flex;min-width:0;flex-wrap:wrap;gap:7px 14px;min-height:38px;margin:18px 0;color:var(--muted);font-size:11px}.meta span{min-width:0;overflow-wrap:anywhere}.meta b{color:var(--ink)}.actions{justify-content:flex-start;flex-wrap:wrap}.actions a{border:1px solid var(--line);border-radius:9px;padding:9px 11px;color:var(--ink);font-size:12px;font-weight:800;text-decoration:none}.actions a.primary{color:#fff;border-color:#24262b;background:#24262b}.warnings{margin:32px 0;padding:20px;border:1px solid var(--line);border-radius:15px;background:var(--paper)}footer{padding:35px 0 48px;color:var(--muted);font:11px ui-monospace,SFMono-Regular,Consolas,monospace}@media(max-width:800px){.stats{grid-template-columns:repeat(3,1fr)}.toolbar{grid-template-columns:1fr}.entries{grid-template-columns:1fr}}@media(max-width:520px){.topbar-inner,.container{width:min(100% - 24px,1160px)}.hero{padding-top:42px}.stats{grid-template-columns:repeat(2,1fr)}}
</style></head><body><header class="topbar"><div class="topbar-inner"><div class="brand">Reality<span>Check</span> / CATALOG</div><div class="languages"><button data-language="en" aria-pressed="true">EN</button><button data-language="zh" aria-pressed="false">中文</button></div></div></header><main class="container"><section class="hero"><p class="eyebrow" data-en="LOCAL EVIDENCE INVENTORY" data-zh="本地证据目录">LOCAL EVIDENCE INVENTORY</p><h1 data-en="Every audit. One place." data-zh="每次核查，集中查看。">Every audit. One place.</h1><p class="lede" data-en="Find the latest page audit, site gate, repair plan, proof, or trend without hunting through run directories." data-zh="无需翻找运行目录，即可定位最新单页核查、全站门禁、修复计划、证明或质量趋势。">Find the latest page audit, site gate, repair plan, proof, or trend without hunting through run directories.</p></section><section class="stats"><div class="stat"><b>${catalog.summary.artifacts}</b><span data-en="Artifacts" data-zh="产物">Artifacts</span></div><div class="stat"><b>${catalog.summary.audits}</b><span data-en="Audits" data-zh="核查">Audits</span></div><div class="stat"><b>${catalog.summary.verifications}</b><span data-en="Proofs" data-zh="证明">Proofs</span></div><div class="stat"><b>${catalog.summary.repairPlans}</b><span data-en="Plans" data-zh="计划">Plans</span></div><div class="stat"><b>${catalog.summary.trends}</b><span data-en="Trends" data-zh="趋势">Trends</span></div><div class="stat"><b>${catalog.summary.passing}</b><span data-en="Passing" data-zh="通过">Passing</span></div><div class="stat"><b>${catalog.summary.failing}</b><span data-en="Failing" data-zh="失败">Failing</span></div></section><div class="toolbar"><div class="filters"><button data-filter="all" aria-pressed="true" data-en="All" data-zh="全部">All</button><button data-filter="failed" aria-pressed="false" data-en="Failed" data-zh="失败">Failed</button><button data-filter="passed" aria-pressed="false" data-en="Passed" data-zh="通过">Passed</button><button data-filter="audit" aria-pressed="false" data-en="Audits" data-zh="核查">Audits</button><button data-filter="verification" aria-pressed="false" data-en="Proofs" data-zh="证明">Proofs</button><button data-filter="repair-plan" aria-pressed="false" data-en="Plans" data-zh="计划">Plans</button><button data-filter="quality-trend" aria-pressed="false" data-en="Trends" data-zh="趋势">Trends</button></div><input class="search" type="search" placeholder="Search title, target, run, or type" aria-label="Search catalog"><span class="count" role="status" aria-live="polite"></span></div><section class="entries">${cards}</section>${warningHtml ? `<section class="warnings"><h2 data-en="Skipped artifacts" data-zh="已跳过产物">Skipped artifacts</h2><ul>${warningHtml}</ul></section>` : ""}<footer>Generated ${html(catalog.generatedAt)} · RealityCheck ${TOOL_VERSION}</footer></main><script>(()=>{let language=navigator.language.toLowerCase().startsWith('zh')?'zh':'en';let filter='all';const search=document.querySelector('.search');const count=document.querySelector('.count');const matchesKind=(entry)=>filter==='audit'?entry.dataset.kind.endsWith('audit'):filter==='verification'?entry.dataset.kind.endsWith('verification'):filter==='quality-trend'||filter==='repair-plan'?entry.dataset.kind===filter:true;const apply=()=>{const query=search.value.trim().toLowerCase();let shown=0;document.querySelectorAll('.entry').forEach(entry=>{const stateMatch=filter==='all'||!['passed','failed'].includes(filter)||entry.dataset.state===filter;const kindMatch=matchesKind(entry);const searchMatch=!query||entry.textContent.toLowerCase().includes(query);entry.hidden=!(stateMatch&&kindMatch&&searchMatch);if(!entry.hidden)shown+=1});count.textContent=language==='zh'?'显示 '+shown+'/${catalog.entries.length} 项':shown+'/${catalog.entries.length} shown';const setLanguage=next=>{language=next;document.documentElement.lang=next==='zh'?'zh-CN':'en';document.querySelectorAll('[data-en][data-zh]').forEach(node=>node.textContent=node.dataset[next]);document.querySelectorAll('[data-language]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.language===next)));search.placeholder=next==='zh'?'搜索标题、目标、运行或类型':'Search title, target, run, or type';apply()};document.querySelectorAll('[data-language]').forEach(button=>button.addEventListener('click',()=>setLanguage(button.dataset.language)));document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));apply()}));search.addEventListener('input',apply);setLanguage(language)})();</script></body></html>`;
  const policyStat = `<div class="stat"><b>${catalog.summary.policyReviews}</b><span data-en="Policy" data-zh="策略">Policy</span></div>`;
  const attestationStat = `<div class="stat"><b>${catalog.summary.attestations}</b><span data-en="Signed" data-zh="签名">Signed</span></div>`;
  const trustStat = `<div class="stat"><b>${catalog.summary.trustReports}</b><span data-en="Trust" data-zh="信任">Trust</span></div>`;
  const policyFilter = `<button data-filter="policy-review" aria-pressed="false" data-en="Policy" data-zh="策略">Policy</button>`;
  const attestationFilter = `<button data-filter="evidence-attestation" aria-pressed="false" data-en="Signed" data-zh="签名">Signed</button>`;
  const trustFilter = `<button data-filter="evidence-trust-report" aria-pressed="false" data-en="Trust" data-zh="信任">Trust</button>`;
  return page
    .replace("</section><div class=\"toolbar\">", `${policyStat}${attestationStat}${trustStat}</section><div class="toolbar">`)
    .replace('<button data-filter="quality-trend"', `${policyFilter}${attestationFilter}${trustFilter}<button data-filter="quality-trend"`)
    .replace("filter==='quality-trend'||filter==='repair-plan'", "['quality-trend','repair-plan','policy-review','evidence-attestation','evidence-trust-report'].includes(filter)")
    .replace(" shown';const setLanguage", " shown';};const setLanguage");
}

export function writeArtifactCatalog(catalog, outputDirectory) {
  const output = resolve(outputDirectory);
  mkdirSync(output, { recursive: true });
  const jsonPath = join(output, "catalog.json");
  const markdownPath = join(output, "catalog.md");
  const htmlPath = join(output, "catalog.html");
  writeFileSync(jsonPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, renderCatalogMarkdown(catalog), "utf8");
  writeFileSync(htmlPath, renderCatalogHtml(catalog), "utf8");
  return { jsonPath, markdownPath, htmlPath };
}

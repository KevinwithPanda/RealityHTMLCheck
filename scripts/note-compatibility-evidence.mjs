#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeHtmlNote } from "../realitycheck/scripts/note-analyzer.mjs";
import { analyzeNotePackage } from "../realitycheck/scripts/note-package.mjs";
import { summarizeNoteReports, summarizePackageFindings } from "../realitycheck/scripts/note-summary.mjs";
import { verifyRealExportEvidence } from "./real-export-evidence.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRoot = join(repositoryRoot, "examples", "note-compatibility");
const manifestPath = join(evidenceRoot, "manifest.json");
const matrixPath = join(evidenceRoot, "compatibility-matrix.json");
const pagePath = join(repositoryRoot, "site", "compatibility.html");

const portable = (value) => value.split(sep).join("/");

function listFiles(root, current = root) {
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Compatibility fixture cannot contain a symlink: ${path}`);
    if (entry.isDirectory()) files.push(...listFiles(root, path));
    else if (entry.isFile()) files.push(portable(relative(root, path)));
  }
  return files;
}

function digestFiles(root, paths) {
  const digest = createHash("sha256");
  for (const path of paths) {
    digest.update(path, "utf8");
    digest.update("\0");
    digest.update(readFileSync(join(root, path)));
    digest.update("\0");
  }
  return digest.digest("hex");
}

function analyzeFixture(definition) {
  const directory = resolve(evidenceRoot, definition.directory);
  if (!directory.startsWith(`${evidenceRoot}${sep}`)) throw new Error(`Fixture escapes evidence root: ${definition.id}`);
  const knownFiles = listFiles(directory);
  const htmlPaths = knownFiles.filter((path) => [".htm", ".html"].includes(extname(path).toLowerCase()));
  if (!htmlPaths.length) throw new Error(`Fixture has no HTML entry: ${definition.id}`);
  const entries = knownFiles
    .filter((path) => [".css", ".htm", ".html"].includes(extname(path).toLowerCase()))
    .map((path) => ({
      path,
      kind: extname(path).toLowerCase() === ".css" ? "css" : "html",
      text: readFileSync(join(directory, path), "utf8"),
    }));
  const reports = htmlPaths.map((path) => analyzeHtmlNote({
    path,
    html: readFileSync(join(directory, path), "utf8"),
    knownFiles,
  }));
  const packageFindings = analyzeNotePackage({ entries, knownFiles });
  const packageSummary = summarizePackageFindings(packageFindings);
  const summary = summarizeNoteReports(reports, packageSummary);
  const detectedRules = [...new Set([
    ...reports.flatMap((report) => report.findings.map((finding) => finding.ruleId)),
    ...packageFindings.map((finding) => finding.ruleId),
  ])].sort();
  const fileFindings = reports.flatMap((report) => report.findings.map((finding) => ({
    scope: "html-file",
    reportPath: report.path,
    id: finding.id,
    ruleId: finding.ruleId,
    level: finding.level,
    title: finding.title,
    summary: finding.summary,
    remediation: finding.remediation,
    evidence: (finding.evidence || []).slice(0, 3).map((item) => ({
      path: item.path,
      line: item.line,
      excerpt: item.excerpt,
    })),
  })));
  const packageEvidence = packageFindings.map((finding) => ({
    scope: "package",
    reportPath: null,
    id: finding.id,
    ruleId: finding.ruleId,
    level: finding.level,
    title: finding.title,
    summary: finding.summary,
    remediation: finding.remediation,
    evidence: (finding.evidence || []).slice(0, 3).map((item) => ({
      path: item.path,
      line: item.line,
      excerpt: item.excerpt,
    })),
  }));
  const findings = [...fileFindings, ...packageEvidence];
  const requiredRulesPresent = definition.requiredRules.every((rule) => detectedRules.includes(rule));
  return {
    id: definition.id,
    family: definition.family,
    label: definition.label,
    labelZhCN: definition.labelZhCN,
    phase: definition.phase,
    sourceType: "synthetic-representative",
    purpose: definition.purpose,
    purposeZhCN: definition.purposeZhCN,
    fixtureDirectory: definition.directory,
    entryFiles: htmlPaths,
    knownFileCount: knownFiles.length,
    sourceDigestSha256: digestFiles(directory, knownFiles),
    score: summary.score,
    scoreBasis: summary.scoreBasis,
    status: summary.status,
    counts: summary.counts,
    packageSummary,
    detectedRules,
    findings,
    expected: {
      status: definition.expectedStatus,
      requiredRules: definition.requiredRules,
    },
    expectationMatched: summary.status === definition.expectedStatus && requiredRulesPresent,
  };
}

function buildCase(definition, byId) {
  const before = byId.get(definition.before);
  if (!before) throw new Error(`Case ${definition.id} references unknown before fixture ${definition.before}`);
  if (definition.after) {
    const after = byId.get(definition.after);
    if (!after) throw new Error(`Case ${definition.id} references unknown after fixture ${definition.after}`);
    const resolvedRules = before.detectedRules.filter((rule) => !after.detectedRules.includes(rule));
    return {
      id: definition.id,
      title: definition.title,
      titleZhCN: definition.titleZhCN,
      outcome: "repaired-copy-verified",
      before: { fixture: before.id, score: before.score, status: before.status, rules: before.detectedRules },
      after: { fixture: after.id, score: after.score, status: after.status, rules: after.detectedRules },
      resolvedRules,
      expectedResolvedRules: definition.expectedResolvedRules,
      expectationMatched: after.status === "ready" && definition.expectedResolvedRules.every((rule) => resolvedRules.includes(rule)),
    };
  }
  return {
    id: definition.id,
    title: definition.title,
    titleZhCN: definition.titleZhCN,
    outcome: definition.decision,
    before: { fixture: before.id, score: before.score, status: before.status, rules: before.detectedRules },
    after: null,
    remainingRules: before.detectedRules,
    expectedRemainingRules: definition.expectedRemainingRules,
    expectationMatched: before.status === "review" && definition.expectedRemainingRules.every((rule) => before.detectedRules.includes(rule)),
  };
}

export function buildCompatibilityMatrix() {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const fixtures = manifest.fixtures.map(analyzeFixture);
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const cases = manifest.cases.map((definition) => buildCase(definition, byId));
  const families = [...new Set(fixtures.map((fixture) => fixture.family))];
  return {
    kind: "representative-html-export-compatibility-evidence",
    schemaVersion: manifest.schemaVersion,
    title: manifest.title,
    titleZhCN: manifest.titleZhCN,
    generatedBy: "scripts/note-compatibility-evidence.mjs",
    evidenceBoundary: manifest.evidenceBoundary,
    summary: {
      familyCount: families.length,
      fixtureCount: fixtures.length,
      caseCount: cases.length,
      allExpectationsMatched: fixtures.every((fixture) => fixture.expectationMatched) && cases.every((item) => item.expectationMatched),
    },
    families,
    fixtures,
    cases,
  };
}

const escapeHtml = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
const statusLabel = (status, language) => ({
  "needs-fix": language === "zh-CN" ? "暂不建议分享" : "Do not share yet",
  review: language === "zh-CN" ? "分享前复核" : "Review before sharing",
  ready: language === "zh-CN" ? "未发现确定性阻断项" : "No deterministic blocker",
})[status] ?? status;

export function renderCompatibilityPage(matrix) {
  const realExport = verifyRealExportEvidence();
  if (!realExport.ok) throw new Error(`Real export evidence is invalid: ${realExport.problems.join("; ")}`);
  const realSample = realExport.manifest.samples[0];
  const realGenerator = realExport.manifest.generator;
  const rows = matrix.fixtures.map((fixture) => {
    const entry = fixture.entryFiles[0];
    const fixtureLink = `evidence/note-compatibility/${fixture.fixtureDirectory}/${entry}`;
    const rules = fixture.detectedRules.length ? fixture.detectedRules.join(", ") : "none";
    return `<tr><td><strong>${escapeHtml(fixture.family)}</strong><span data-en="${escapeHtml(fixture.label)}" data-zh-cn="${escapeHtml(fixture.labelZhCN)}">${escapeHtml(fixture.label)}</span></td><td><span class="phase">${escapeHtml(fixture.phase)}</span></td><td><strong>${fixture.score}/100</strong><span class="status ${escapeHtml(fixture.status)}" data-en="${escapeHtml(statusLabel(fixture.status, "en"))}" data-zh-cn="${escapeHtml(statusLabel(fixture.status, "zh-CN"))}">${escapeHtml(statusLabel(fixture.status, "en"))}</span></td><td><code>${escapeHtml(rules)}</code></td><td><a href="${escapeHtml(fixtureLink)}" data-en="Open fixture" data-zh-cn="打开夹具">Open fixture</a><a href="#evidence-${escapeHtml(fixture.id)}" data-en="Inspect findings" data-zh-cn="审查问题证据">Inspect findings</a><small>SHA-256 ${fixture.sourceDigestSha256.slice(0, 12)}…</small></td></tr>`;
  }).join("\n");
  const evidenceDetails = matrix.fixtures.map((fixture) => {
    const findings = fixture.findings.length ? fixture.findings.map((finding) => {
      const evidence = finding.evidence.length
        ? finding.evidence.map((item) => `<li><code>${escapeHtml(item.path)}:${item.line}</code><span>${escapeHtml(item.excerpt)}</span></li>`).join("")
        : `<li data-en="No source location was retained." data-zh-cn="未保留源文件位置。">No source location was retained.</li>`;
      return `<article><span class="finding-level ${escapeHtml(finding.level)}">${escapeHtml(finding.level.toUpperCase())}</span><h3 data-en="${escapeHtml(finding.title.en)}" data-zh-cn="${escapeHtml(finding.title.zhCN)}">${escapeHtml(finding.title.en)}</h3><p data-en="${escapeHtml(finding.summary.en)}" data-zh-cn="${escapeHtml(finding.summary.zhCN)}">${escapeHtml(finding.summary.en)}</p><strong data-en="Recommended change" data-zh-cn="建议修改">Recommended change</strong><p data-en="${escapeHtml(finding.remediation.en)}" data-zh-cn="${escapeHtml(finding.remediation.zhCN)}">${escapeHtml(finding.remediation.en)}</p><ul>${evidence}</ul></article>`;
    }).join("") : `<p data-en="No enabled deterministic finding was recorded for this fixture." data-zh-cn="这个夹具没有记录到已启用规则的问题。">No enabled deterministic finding was recorded for this fixture.</p>`;
    return `<details id="evidence-${escapeHtml(fixture.id)}"><summary><strong>${escapeHtml(fixture.family)} · ${escapeHtml(fixture.phase)}</strong><span>${fixture.score}/100 · <span data-en="${escapeHtml(statusLabel(fixture.status, "en"))}" data-zh-cn="${escapeHtml(statusLabel(fixture.status, "zh-CN"))}">${escapeHtml(statusLabel(fixture.status, "en"))}</span></span></summary><div class="finding-list">${findings}</div></details>`;
  }).join("\n");
  const fixtureById = new Map(matrix.fixtures.map((fixture) => [fixture.id, fixture]));
  const cases = matrix.cases.map((item, index) => {
    const before = fixtureById.get(item.before.fixture);
    if (item.after) {
      const after = fixtureById.get(item.after.fixture);
      return `<article class="case"><span class="case-number">0${index + 1} · BEFORE → FINDING → REPAIR</span><h3 data-en="${escapeHtml(item.title)}" data-zh-cn="${escapeHtml(item.titleZhCN)}">${escapeHtml(item.title)}</h3><div class="flow"><div><small data-en="Before" data-zh-cn="修复前">Before</small><strong>${before.score}/100 · <span data-en="${escapeHtml(statusLabel(before.status, "en"))}" data-zh-cn="${escapeHtml(statusLabel(before.status, "zh-CN"))}">${escapeHtml(statusLabel(before.status, "en"))}</span></strong><code>${escapeHtml(item.resolvedRules.join(", "))}</code></div><b aria-hidden="true">→</b><div><small data-en="Verified repaired copy" data-zh-cn="已验证修复副本">Verified repaired copy</small><strong>${after.score}/100 · <span data-en="${escapeHtml(statusLabel(after.status, "en"))}" data-zh-cn="${escapeHtml(statusLabel(after.status, "zh-CN"))}">${escapeHtml(statusLabel(after.status, "en"))}</span></strong><code data-en="resolved" data-zh-cn="已消除">resolved</code></div></div></article>`;
    }
    return `<article class="case"><span class="case-number">0${index + 1} · BEFORE → FINDING → DECISION</span><h3 data-en="${escapeHtml(item.title)}" data-zh-cn="${escapeHtml(item.titleZhCN)}">${escapeHtml(item.title)}</h3><div class="flow"><div><small data-en="Observed" data-zh-cn="已观察">Observed</small><strong>${before.score}/100 · <span data-en="${escapeHtml(statusLabel(before.status, "en"))}" data-zh-cn="${escapeHtml(statusLabel(before.status, "zh-CN"))}">${escapeHtml(statusLabel(before.status, "en"))}</span></strong><code>${escapeHtml(item.remainingRules.join(", "))}</code></div><b aria-hidden="true">→</b><div><small data-en="Conservative decision" data-zh-cn="保守决策">Conservative decision</small><strong data-en="Keep visible; review intent" data-zh-cn="保留可见；复核用途">Keep visible; review intent</strong><code data-en="no blind script removal" data-zh-cn="不盲目删除脚本">no blind script removal</code></div></div></article>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="index,follow">
  <title>Representative HTML note evidence · RealityCheck</title>
  <meta name="description" content="Reproducible RealityCheck evidence from an actual locally generated Pandoc export and synthetic representative HTML package fixtures, with explicit non-certification boundaries.">
  <link rel="canonical" href="https://kevinwithpanda.github.io/RealityHTMLCheck/compatibility.html">
  <link rel="icon" href="assets/icon.svg" type="image/svg+xml">
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#182230;background:#f4f6f2}*{box-sizing:border-box}body{margin:0}.wrap{width:min(1180px,calc(100% - 32px));margin:auto}header{padding:22px 0;border-bottom:1px solid #d9ddd6;background:#fff}nav{display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{font-weight:900;color:#182230;text-decoration:none}.nav-actions{display:flex;align-items:center;gap:10px}.nav-actions a,.language button{border:1px solid #cdd3cb;background:#fff;color:#182230;border-radius:999px;padding:9px 13px;text-decoration:none;font:inherit}.language{display:flex;gap:4px}.language button[aria-pressed="true"]{background:#182230;color:#fff}main{padding:56px 0 72px}.eyebrow,.case-number{font-size:.75rem;font-weight:900;letter-spacing:.12em;color:#496252}h1{font-size:clamp(2.3rem,6vw,5.1rem);line-height:.95;max-width:900px;margin:14px 0 20px}.lead{font-size:1.15rem;line-height:1.7;max-width:800px}.boundary{margin:32px 0;padding:22px;border:1px solid #d29a48;border-radius:16px;background:#fff8e9}.boundary strong{display:block;margin-bottom:8px}.real-proof{display:grid;grid-template-columns:1.3fr repeat(3,.7fr);gap:14px;margin:28px 0;padding:22px;border-radius:18px;color:#f7faf7;background:#182230}.real-proof>div:first-child{padding-right:16px}.real-proof h2{margin:6px 0 10px}.real-proof p{color:#c7d0c8;line-height:1.55}.real-proof strong{display:block;font-size:1.8rem}.real-proof small{color:#acb7ad}.real-proof a{display:block;margin-top:8px;color:#bce7c7;font-weight:800}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:28px 0}.stats div,.case{background:#fff;border:1px solid #d9ddd6;border-radius:16px;padding:20px}.stats strong{display:block;font-size:2rem}.stats span{color:#59635a}.table-wrap{overflow-x:auto;border:1px solid #d9ddd6;border-radius:16px;background:#fff}table{width:100%;border-collapse:collapse;min-width:900px}th,td{text-align:left;vertical-align:top;padding:16px;border-bottom:1px solid #e4e7e2}th{font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;background:#edf1eb}td span,td small{display:block;margin-top:5px;color:#667068}td a{display:block;margin-top:4px;font-weight:800;color:#244c8b}.phase,.status{width:max-content;border-radius:999px;padding:4px 8px;font-size:.78rem}.phase{background:#eef1ed}.status.needs-fix{background:#ffe8e4;color:#8e2820}.status.review{background:#fff0c8;color:#735200}.status.ready{background:#dff4e5;color:#236239}code{font:600 .78rem ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}h2{font-size:2rem;margin:54px 0 18px}.evidence-details{display:grid;gap:12px}.evidence-details details{scroll-margin-top:24px;background:#fff;border:1px solid #d9ddd6;border-radius:14px;padding:16px}.evidence-details summary{display:flex;justify-content:space-between;gap:18px;cursor:pointer}.finding-list{display:grid;gap:12px;margin-top:16px}.finding-list article{border-top:1px solid #e4e7e2;padding-top:14px}.finding-list h3{margin:8px 0}.finding-list p{line-height:1.55}.finding-list ul{padding-left:20px}.finding-list li{margin:7px 0}.finding-list li span{display:block;color:#667068}.finding-level{font-size:.72rem;font-weight:900;letter-spacing:.08em}.finding-level.error{color:#9a3027}.finding-level.warning{color:#7b5700}.cases{display:grid;gap:16px}.case h3{font-size:1.35rem;margin:10px 0 18px}.flow{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:18px}.flow div{display:grid;gap:8px}.flow small{color:#667068}.flow b{font-size:1.7rem;color:#718079}.method{margin-top:46px;padding:24px;border-radius:16px;background:#182230;color:#f8faf7}.method code{display:block;margin-top:12px;padding:13px;border-radius:10px;background:#0f1720;color:#d9f2dd}.method a{display:inline-block;margin:8px 8px 0 0;border-radius:999px;background:#d9f2dd;color:#102217;padding:10px 14px;font-weight:800;text-decoration:none}footer{padding:28px 0;border-top:1px solid #d9ddd6;color:#667068}@media(max-width:900px){.real-proof{grid-template-columns:1fr 1fr}.real-proof>div:first-child{grid-column:1/-1}}@media(max-width:760px){.stats,.real-proof{grid-template-columns:1fr 1fr}.flow{grid-template-columns:1fr}.flow>b{transform:rotate(90deg);justify-self:start}.evidence-details summary{display:grid}nav{align-items:flex-start;flex-direction:column}.nav-actions{width:100%;justify-content:space-between}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
  </style>
</head>
<body>
  <header><nav class="wrap"><a class="brand" href="./">RealityCheck</a><div class="nav-actions"><a href="note.html" data-en="Check my note" data-zh-cn="检查我的笔记">Check my note</a><div class="language" role="group" aria-label="Report language"><button type="button" data-language="en" aria-pressed="true">EN</button><button type="button" data-language="zh-CN" aria-pressed="false">中文</button></div></div></nav></header>
  <main class="wrap">
    <span class="eyebrow">REPRODUCIBLE · SYNTHETIC · BOUNDED</span>
    <h1 data-en="Compatibility claims you can rerun." data-zh-cn="可以重新运行的兼容性证据。">Compatibility claims you can rerun.</h1>
    <p class="lead" data-en="The same production analyzers inspect seven checked-in packages covering one-page exports, linked notes, notebook interactivity, and nested publishing libraries." data-zh-cn="同一套正式分析器会检查 7 个随仓库提交的文件包，覆盖单页导出、互链笔记、笔记本交互与嵌套发布依赖。">The same production analyzers inspect seven checked-in packages covering one-page exports, linked notes, notebook interactivity, and nested publishing libraries.</p>
    <aside class="boundary"><strong data-en="Evidence boundary" data-zh-cn="证据边界">Evidence boundary</strong><span data-en="${escapeHtml(matrix.evidenceBoundary.statement)}" data-zh-cn="${escapeHtml(matrix.evidenceBoundary.statementZhCN)}">${escapeHtml(matrix.evidenceBoundary.statement)}</span></aside>
    <section class="real-proof"><div><span class="eyebrow" data-en="ACTUAL TOOL OUTPUT · SEPARATE FROM -LIKE FIXTURES" data-zh-cn="真实工具输出 · 与 -like 夹具分层">ACTUAL TOOL OUTPUT · SEPARATE FROM -LIKE FIXTURES</span><h2 data-en="One HTML file was emitted by Pandoc ${escapeHtml(realGenerator.version)}, not hand-written to resemble it." data-zh-cn="一个 HTML 文件由 Pandoc ${escapeHtml(realGenerator.version)} 实际生成，并非手写仿制。">One HTML file was emitted by Pandoc ${escapeHtml(realGenerator.version)}, not hand-written to resemble it.</h2><p data-en="${escapeHtml(realExport.manifest.evidenceBoundary.statement)}" data-zh-cn="${escapeHtml(realExport.manifest.evidenceBoundary.statementZhCN)}">${escapeHtml(realExport.manifest.evidenceBoundary.statement)}</p></div><div><strong>${realExport.observation.score}/100</strong><small data-en="fresh static check" data-zh-cn="重新静态核查">fresh static check</small></div><div><strong>${escapeHtml(realGenerator.version)}</strong><small>Pandoc · ${escapeHtml(realGenerator.platform)}</small></div><div><strong>SHA-256</strong><small>${escapeHtml(realSample.hashes.outputRawSha256.slice(0, 12))}…</small><a href="evidence/real-export/${escapeHtml(realSample.output)}" data-en="Open generated HTML →" data-zh-cn="打开真实生成 HTML →">Open generated HTML →</a><a href="evidence/real-export/manifest.json" data-en="Inspect manifest" data-zh-cn="审查清单">Inspect manifest</a></div></section>
    <section class="stats" aria-label="Evidence summary"><div><strong>${matrix.summary.familyCount}</strong><span data-en="export shapes" data-zh-cn="类导出结构">export shapes</span></div><div><strong>${matrix.summary.fixtureCount}</strong><span data-en="hashed fixtures" data-zh-cn="个哈希固定夹具">hashed fixtures</span></div><div><strong>${matrix.summary.caseCount}</strong><span data-en="decision cases" data-zh-cn="个决策案例">decision cases</span></div><div><strong>${matrix.summary.allExpectationsMatched ? "PASS" : "FAIL"}</strong><span data-en="declared expectations" data-zh-cn="声明预期">declared expectations</span></div></section>
    <h2 data-en="Observed matrix" data-zh-cn="实测矩阵">Observed matrix</h2>
    <div class="table-wrap"><table><thead><tr><th data-en="Representative shape" data-zh-cn="代表性结构">Representative shape</th><th data-en="Phase" data-zh-cn="阶段">Phase</th><th data-en="Decision" data-zh-cn="决策">Decision</th><th data-en="Observed rules" data-zh-cn="实测规则">Observed rules</th><th data-en="Reproduce" data-zh-cn="复现">Reproduce</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h2 data-en="Inspect every decision" data-zh-cn="审查每项判断">Inspect every decision</h2>
    <section class="evidence-details">${evidenceDetails}</section>
    <h2 data-en="Before → finding → outcome" data-zh-cn="修复前 → 问题 → 结果">Before → finding → outcome</h2>
    <section class="cases">${cases}</section>
    <section class="method"><strong data-en="Regenerate and verify" data-zh-cn="重新生成并验证">Regenerate and verify</strong><code>node scripts/note-compatibility-evidence.mjs --verify</code><p data-en="Verification recalculates every score and rule from the fixture bytes, checks declared outcomes, and compares both published artifacts byte for byte." data-zh-cn="验证会从夹具字节重新计算每个分数与规则，核对声明结果，并逐字节比较两份发布产物。">Verification recalculates every score and rule from the fixture bytes, checks declared outcomes, and compares both published artifacts byte for byte.</p><a href="evidence/note-compatibility/compatibility-matrix.json" data-en="Open machine-readable matrix →" data-zh-cn="打开机器可读矩阵 →">Open machine-readable matrix →</a><a href="https://github.com/KevinwithPanda/RealityHTMLCheck/blob/main/scripts/note-compatibility-evidence.mjs" data-en="Review the generator →" data-zh-cn="审查生成脚本 →">Review the generator →</a><a href="https://github.com/KevinwithPanda/RealityHTMLCheck/issues/new?template=html-note-export.yml" data-en="Contribute a sanitized real export →" data-zh-cn="贡献去隐私化真实导出样本 →">Contribute a sanitized real export →</a></section>
  </main>
  <footer><div class="wrap" data-en="Structure-level evidence, not vendor certification or full browser compatibility." data-zh-cn="这是结构级证据，不是厂商认证或完整浏览器兼容性证明。">Structure-level evidence, not vendor certification or full browser compatibility.</div></footer>
  <script>(()=>{const setLanguage=language=>{document.documentElement.lang=language;for(const node of document.querySelectorAll('[data-en][data-zh-cn]'))node.textContent=language==='zh-CN'?node.dataset.zhCn:node.dataset.en;for(const button of document.querySelectorAll('[data-language]'))button.setAttribute('aria-pressed',String(button.dataset.language===language))};for(const button of document.querySelectorAll('[data-language]'))button.addEventListener('click',()=>setLanguage(button.dataset.language));setLanguage((navigator.language||'').toLowerCase().startsWith('zh')?'zh-CN':'en')})();</script>
</body>
</html>
`;
}

function serializedArtifacts() {
  const matrix = buildCompatibilityMatrix();
  return {
    matrix,
    json: `${JSON.stringify(matrix, null, 2)}\n`,
    html: renderCompatibilityPage(matrix),
  };
}

export function writeCompatibilityArtifacts() {
  const artifacts = serializedArtifacts();
  mkdirSync(dirname(matrixPath), { recursive: true });
  mkdirSync(dirname(pagePath), { recursive: true });
  writeFileSync(matrixPath, artifacts.json, "utf8");
  writeFileSync(pagePath, artifacts.html, "utf8");
  return artifacts.matrix;
}

export function verifyCompatibilityArtifacts() {
  const artifacts = serializedArtifacts();
  const problems = [];
  if (!artifacts.matrix.summary.allExpectationsMatched) problems.push("one or more fixture expectations did not match");
  if (!existsSync(matrixPath) || readFileSync(matrixPath, "utf8") !== artifacts.json) problems.push("compatibility-matrix.json is stale");
  if (!existsSync(pagePath) || readFileSync(pagePath, "utf8") !== artifacts.html) problems.push("site/compatibility.html is stale");
  return { ok: problems.length === 0, problems, matrix: artifacts.matrix };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--write")) {
    const matrix = writeCompatibilityArtifacts();
    console.log(`Wrote ${matrix.summary.fixtureCount} representative fixture results across ${matrix.summary.familyCount} export shapes.`);
  } else {
    const result = verifyCompatibilityArtifacts();
    if (!result.ok) {
      console.error(`Compatibility evidence verification failed: ${result.problems.join("; ")}. Run with --write after reviewing intentional fixture changes.`);
      process.exitCode = 1;
    } else {
      console.log(`Verified ${result.matrix.summary.fixtureCount} representative fixtures and ${result.matrix.summary.caseCount} before/after decision cases.`);
    }
  }
}

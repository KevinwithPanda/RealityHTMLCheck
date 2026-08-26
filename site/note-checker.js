import { analyzeHtmlNote, applySafeNoteFixes, buildRepairTask, normalizeNotePath } from "./note-analyzer.mjs?v=0.7.0";
import { analyzeNotePackage } from "./note-package.mjs?v=0.7.0";
import { buildPackageRepairTask, summarizeNoteReports, summarizePackageFindings, noteDecision } from "./note-summary.mjs?v=0.7.0";
import { buildPortableNoteReport } from "./note-share-report.mjs?v=0.7.0";
import { analyzeBrowserNoteSources, duplicateBrowserNotePaths, safeRepairDownloadName, safeRepairDownloadPayload, verifySafeNoteRepair } from "./note-repair-verification.mjs?v=0.7.0";

const noteAnalysisHelpers = {
  analyzeHtmlNote,
  applySafeNoteFixes,
  analyzeNotePackage,
  summarizeNoteReports,
  summarizePackageFindings,
  normalizeNotePath,
};

const elements = {
  dropZone: document.querySelector("#drop-zone"),
  filePicker: document.querySelector("#file-picker"),
  folderPicker: document.querySelector("#folder-picker"),
  demo: document.querySelector("#demo-button"),
  status: document.querySelector("#status"),
  results: document.querySelector("#results"),
  summary: document.querySelector("#summary"),
  decision: document.querySelector("#decision"),
  files: document.querySelector("#file-results"),
  reset: document.querySelector("#reset-button"),
  copyAll: document.querySelector("#copy-all"),
  downloadJson: document.querySelector("#download-json"),
  downloadReport: document.querySelector("#download-report"),
  toast: document.querySelector("#toast"),
};

let language = "en";
let current = null;
let inspectionGeneration = 0;

function translate(value) {
  return language === "zh-CN" ? value.zhCN : value.en;
}

function setLanguage(next) {
  language = next === "zh-CN" ? "zh-CN" : "en";
  document.documentElement.lang = language;
  for (const element of document.querySelectorAll("[data-en][data-zh-cn]")) element.textContent = language === "zh-CN" ? element.dataset.zhCn : element.dataset.en;
  for (const button of document.querySelectorAll("[data-language]")) button.setAttribute("aria-pressed", String(button.dataset.language === language));
  if (current) render(current);
  try { localStorage.setItem("realitycheck-note-language", language); } catch (_) {}
}

function notify(en, zhCN) {
  elements.toast.textContent = language === "zh-CN" ? zhCN : en;
  elements.toast.classList.add("show");
  setTimeout(() => elements.toast.classList.remove("show"), 1700);
}

function pathFor(file) {
  return normalizeNotePath(file.webkitRelativePath || file.name) || normalizeNotePath(file.name);
}

function create(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    notify("Repair task copied.", "修复任务已复制。");
  } catch (_) {
    notify("Copy was blocked by the browser.", "浏览器阻止了复制，请手动选择文本。");
  }
}

async function inspectFiles(fileList, folderMode = false) {
  const selectedFiles = [...fileList];
  const generation = ++inspectionGeneration;
  clearRenderedResult();
  elements.filePicker.value = "";
  elements.folderPicker.value = "";
  elements.status.textContent = "";
  try {
    await inspectFilesGeneration(selectedFiles, folderMode, generation);
  } catch (_) {
    if (generation !== inspectionGeneration) return;
    clearRenderedResult();
    elements.status.textContent = language === "zh-CN"
      ? "读取或分析这些文件时发生错误，因此没有保留旧报告，也没有生成新报告。请重新选择文件后再试。"
      : "The files could not be read or analyzed. The previous result was cleared and no new report was created; select the files and try again.";
  }
}

async function inspectFilesGeneration(fileList, folderMode, generation) {
  const allFiles = [...fileList];
  const oversizedHtml = allFiles.filter((file) => /\.html?$/i.test(file.name) && file.size > 25 * 1024 * 1024);
  if (oversizedHtml.length) {
    elements.status.textContent = language === "zh-CN" ? `有 ${oversizedHtml.length} 个 HTML 文件超过 25 MiB，未生成不完整报告。请缩小或拆分文件后重试。` : `${oversizedHtml.length} HTML file(s) exceed 25 MiB. No incomplete report was created; reduce or split them and try again.`;
    return;
  }
  const htmlFiles = allFiles.filter((file) => /\.html?$/i.test(file.name));
  if (!htmlFiles.length) {
    elements.status.textContent = language === "zh-CN" ? "没有找到 .html 或 .htm 文件。" : "No .html or .htm file was found.";
    return;
  }
  if (htmlFiles.length > 200) {
    elements.status.textContent = language === "zh-CN" ? "一次最多检查 200 个 HTML 文件，请缩小文件夹范围。" : "A check is limited to 200 HTML files. Choose a smaller folder.";
    return;
  }
  const duplicatePaths = duplicateBrowserNotePaths(allFiles.map(pathFor), normalizeNotePath);
  if (duplicatePaths.length) {
    const preview = duplicatePaths.slice(0, 3).join(", ");
    elements.status.textContent = language === "zh-CN"
      ? `发现重复文件路径（${preview}）。为避免把一份报告与另一份同名内容错误配对，本次未生成报告；请选择整个文件夹，或先让文件名/相对路径保持唯一。`
      : `Duplicate file path(s) found (${preview}). No report was created because same-named content cannot be paired safely; choose the whole folder or make the relative paths unique.`;
    return;
  }
  elements.status.textContent = language === "zh-CN" ? `正在本地读取 ${htmlFiles.length} 个 HTML 文件…` : `Reading ${htmlFiles.length} HTML file(s) locally…`;
  const knownFiles = folderMode || allFiles.some((file) => file.webkitRelativePath) || allFiles.length > htmlFiles.length ? allFiles.map(pathFor) : null;
  const sources = new Map();
  const htmlSources = [];
  for (const file of htmlFiles) {
    const html = await file.text();
    if (generation !== inspectionGeneration) return;
    const path = pathFor(file);
    sources.set(path, { file, html });
    htmlSources.push({ path, html });
  }
  const cssSources = [];
  if (knownFiles) {
    const cssFiles = allFiles.filter((file) => /\.css$/i.test(file.name));
    for (const file of cssFiles) {
      const text = file.size <= 5 * 1024 * 1024 ? await file.text() : null;
      if (generation !== inspectionGeneration) return;
      cssSources.push({ path: pathFor(file), text });
    }
  }
  const analysis = { htmlSources, cssSources, knownFiles };
  const analyzed = analyzeBrowserNoteSources(analysis, noteAnalysisHelpers);
  if (generation !== inspectionGeneration) return;
  current = {
    schemaVersion: "1",
    kind: "html-note-browser-check",
    generatedAt: new Date().toISOString(),
    privacy: { uploaded: false, sourceModified: false },
    knownFiles: knownFiles ? knownFiles.length : null,
    ...analyzed,
    sources,
    analysis,
    repairVerifications: new Map(),
  };
  render(current);
  elements.status.textContent = language === "zh-CN" ? "检查完成。文件内容没有离开当前浏览器。" : "Check complete. File content never left this browser.";
  elements.results.hidden = false;
  elements.results.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderSummary(bundle) {
  elements.summary.replaceChildren();
  const cards = [
    [bundle.summary.score, "/100", bundle.packageFindings?.length
      ? { en: "folder readiness · lowest HTML file adjusted by package findings", zhCN: "文件夹就绪度 · 最低 HTML 分并计入文件包问题" }
      : { en: "folder readiness · lowest file", zhCN: "文件夹就绪度 · 最低文件分" }],
    [bundle.summary.files, "", { en: "HTML files", zhCN: "HTML 文件" }],
    [bundle.summary.counts.error, "", { en: "errors", zhCN: "错误" }],
    [bundle.summary.counts.warning, "", { en: "warnings", zhCN: "警告" }],
    [bundle.summary.counts.autoFixable, "", { en: "safe copy fixes", zhCN: "安全副本修复" }],
  ];
  for (const [value, suffix, label] of cards) {
    const article = create("article");
    const strong = create("strong", "", String(value));
    if (suffix) strong.append(create("small", "", suffix));
    article.append(strong, create("small", "", translate(label)));
    elements.summary.append(article);
  }
}

function renderDecision(bundle) {
  const decision = noteDecision(bundle.summary.status);
  elements.decision.dataset.tone = decision.tone;
  elements.decision.replaceChildren();
  const heading = create("div");
  heading.append(create("small", "", translate(decision.label)), create("strong", "", translate(decision.title)));
  elements.decision.append(heading, create("p", "", translate(decision.detail)));
}

function renderFinding(report, finding, packageScope = false) {
  const article = create("article", "finding");
  article.dataset.level = finding.level;
  const top = create("div", "finding-top");
  const levelText = language === "zh-CN" ? { error: "错误", warning: "警告", advice: "建议" }[finding.level] : finding.level.toUpperCase();
  top.append(create("span", `level ${finding.level}`, levelText), create("code", "", finding.id));
  if (finding.safeFix) top.append(create("span", "safe", language === "zh-CN" ? "可安全生成副本" : "SAFE COPY FIX"));
  const heading = create("h3", "", translate(finding.title));
  const summary = create("p", "", translate(finding.summary));
  const remedy = create("div", "remediation");
  remedy.append(create("b", "", language === "zh-CN" ? "如何修改" : "HOW TO FIX"), create("span", "", translate(finding.remediation)));
  const details = create("details");
  details.append(create("summary", "", language === "zh-CN" ? `证据（${finding.affectedCount}）` : `Evidence (${finding.affectedCount})`));
  const list = create("ul");
  for (const item of finding.evidence) {
    const row = create("li");
    row.append(create("code", "", `${item.path}:${item.line}`), create("span", "", item.excerpt));
    list.append(row);
  }
  details.append(list);
  const button = create("button", "copy-one", language === "zh-CN" ? "复制此项修复任务" : "Copy this repair task");
  button.type = "button";
  button.addEventListener("click", () => copy(packageScope
    ? buildPackageRepairTask([finding], language)
    : buildRepairTask({ ...report, findings: [finding] }, language)));
  article.append(top, heading, summary, remedy, details, button);
  return article;
}

function renderPackage(bundle) {
  if (!bundle.packageFindings?.length) return null;
  const section = create("section", "file-result package-result");
  const header = create("header", "file-header");
  const path = create("div", "file-path");
  path.append(
    create("code", "", language === "zh-CN" ? "文件包依赖" : "FILE PACKAGE DEPENDENCIES"),
    create("strong", "", language === "zh-CN" ? "文件包" : "PACKAGE"),
  );
  const stats = create("div", "file-stats");
  const packageSummary = bundle.packageSummary || summarizePackageFindings(bundle.packageFindings);
  for (const [value, label] of [
    [packageSummary.counts.error, { en: "errors", zhCN: "错误" }],
    [packageSummary.counts.warning, { en: "warnings", zhCN: "警告" }],
    [packageSummary.affected, { en: "affected references", zhCN: "受影响引用" }],
  ]) {
    const item = create("span", "", String(value));
    item.append(create("small", "", translate(label)));
    stats.append(item);
  }
  header.append(path, stats);
  const list = create("div", "finding-list");
  for (const finding of bundle.packageFindings) list.append(renderFinding(null, finding, true));
  section.append(header, list);
  return section;
}

function verificationFindingLabel(entry) {
  const scope = entry.scope === "package"
    ? (language === "zh-CN" ? "文件包" : "Package")
    : entry.path;
  return `${scope} · ${translate(entry.finding.title)}`;
}

function renderVerificationGroup(title, entries, tone) {
  const group = create("section", `repair-verification-group ${tone}`);
  const heading = create("h4", "", `${title} · ${entries.length}`);
  const list = create("ul");
  if (!entries.length) list.append(create("li", "empty", language === "zh-CN" ? "无" : "None"));
  else for (const entry of entries) list.append(create("li", "", verificationFindingLabel(entry)));
  group.append(heading, list);
  return group;
}

function renderRepairVerification(verification) {
  const panel = create("section", "repair-verification");
  panel.setAttribute("aria-live", "polite");
  const heading = create("div", "repair-verification-heading");
  heading.append(
    create("small", "", language === "zh-CN" ? "安全修复副本复检完成" : "SAFE-FIX COPY RECHECKED"),
    create("h3", "", language === "zh-CN" ? "下载前，已用同一检测器重新检查" : "Rechecked with the same detector before download"),
  );
  const scores = create("div", "repair-verification-scores");
  for (const [label, value] of [
    [language === "zh-CN" ? "原文件夹中的文件分数" : "File score in original folder", `${verification.before.report.score} → ${verification.after.report.score}`],
    [language === "zh-CN" ? "原文件夹就绪度" : "Original-folder readiness", `${verification.before.summary.score} → ${verification.after.summary.score}`],
    [language === "zh-CN" ? "单 HTML 得分（资源未打包）" : "HTML-only score (assets not bundled)", `${verification.download.summary.score}/100`],
  ]) {
    const item = create("article");
    item.append(create("small", "", label), create("strong", "", value));
    scores.append(item);
  }
  const findingGroups = create("div", "repair-verification-groups");
  findingGroups.append(
    renderVerificationGroup(language === "zh-CN" ? "已解决" : "Resolved", verification.findings.resolved, "resolved"),
    renderVerificationGroup(language === "zh-CN" ? "仍存在" : "Still present", verification.findings.remaining, "remaining"),
    renderVerificationGroup(language === "zh-CN" ? "新出现" : "New after repair", verification.findings.introduced, "introduced"),
    renderVerificationGroup(language === "zh-CN" ? "仅单独下载时未核验" : "Unverified only when downloaded alone", verification.download.onlyFindings, "download"),
  );
  const boundary = create("p", "repair-verification-boundary", language === "zh-CN"
    ? `仅应用并复检了 ${verification.changes.length} 项无歧义元数据修复；这不代表所有问题都已修好。原文件未被覆盖，下载内容与本次复检的内存 HTML 完全一致。浏览器下载只包含这一份 HTML，不包含文件夹图片、样式或附件；请把它移回原相对目录，或使用 Skill/CLI 生成保持目录结构的修复文件夹。`
    : `Only ${verification.changes.length} unambiguous metadata fix(es) were applied and rechecked; this does not mean every problem is fixed. The original was not overwritten, and the download is the exact in-memory HTML that was rechecked. The browser download contains this HTML only—not folder images, styles, or attachments. Move it back beside its original relative assets, or use the Skill/CLI for a repaired folder that preserves structure.`);
  panel.append(heading, scores, findingGroups, boundary);
  return panel;
}

function renderFile(report, bundle) {
  const section = create("section", "file-result");
  const header = create("header", "file-header");
  const path = create("div", "file-path");
  const score = create("strong", "", String(report.score));
  score.append(create("small", "", "/100"));
  path.append(create("code", "", report.path), score);
  const stats = create("div", "file-stats");
  for (const [value, label] of [[report.counts.error, { en: "errors", zhCN: "错误" }], [report.counts.warning, { en: "warnings", zhCN: "警告" }], [report.metrics.words, { en: "words/characters", zhCN: "词/字" }]]) {
    const item = create("span", "", String(value));
    item.append(create("small", "", translate(label)));
    stats.append(item);
  }
  header.append(path, stats);
  const source = bundle.sources.get(report.path);
  if (report.counts.autoFixable && source) {
    const folderContext = Boolean(bundle.analysis?.knownFiles);
    const existingVerification = bundle.repairVerifications?.get(report.path) || null;
    const fix = create("button", "download-fix", existingVerification
      ? (language === "zh-CN" ? "下载已复检的单个 HTML" : "Download rechecked HTML only")
      : (folderContext
        ? (language === "zh-CN" ? "安全修复、复检并下载单个 HTML" : "Safe-fix, recheck & download HTML only")
        : (language === "zh-CN" ? "应用安全修复、复检并下载" : "Apply safe fixes, recheck & download")));
    fix.type = "button";
    fix.addEventListener("click", () => {
      try {
        let verification = bundle.repairVerifications?.get(report.path) || null;
        if (!verification) {
          verification = verifySafeNoteRepair({ path: report.path, beforeBundle: bundle, analysis: bundle.analysis }, noteAnalysisHelpers);
          bundle.repairVerifications.set(report.path, verification);
          render(bundle);
        }
        const payload = safeRepairDownloadPayload(verification, safeRepairDownloadName(report.path));
        download(payload.name, payload.content, payload.type);
        elements.status.textContent = language === "zh-CN"
          ? `安全修复副本已复检并下载：原目录文件分数 ${verification.before.report.score} → ${verification.after.report.score}；单 HTML 得分 ${verification.download.summary.score}/100（资源未打包）。`
          : `Safe-fix copy rechecked and downloaded: original-folder file score ${verification.before.report.score} → ${verification.after.report.score}; HTML-only score ${verification.download.summary.score}/100 (assets not bundled).`;
        notify("Rechecked HTML downloaded; folder assets were not bundled.", "已下载复检 HTML；文件夹资源未打包。");
      } catch (_) {
        elements.status.textContent = language === "zh-CN"
          ? "安全修复副本未能完成复检，因此没有下载。原文件未被修改。"
          : "The safe-fix copy could not be rechecked, so it was not downloaded. The original was not modified.";
        notify("Recheck failed; no copy was downloaded.", "复检失败，未下载副本。");
      }
    });
    header.append(fix);
  }
  const list = create("div", "finding-list");
  if (!report.findings.length) list.append(create("p", "clean", language === "zh-CN" ? "启用的笔记规则没有发现问题。" : "No problems found by the enabled note rules."));
  else for (const finding of report.findings) list.append(renderFinding(report, finding));
  const verification = bundle.repairVerifications?.get(report.path);
  section.append(header, ...(verification ? [renderRepairVerification(verification)] : []), list);
  return section;
}

function render(bundle) {
  renderDecision(bundle);
  renderSummary(bundle);
  const packageCard = renderPackage(bundle);
  elements.files.replaceChildren(...[packageCard, ...bundle.reports.map((report) => renderFile(report, bundle))].filter(Boolean));
  applyFilter(bundle.summary.counts.error ? "error" : bundle.summary.counts.warning ? "warning" : "all");
}

function applyFilter(filter) {
  for (const finding of document.querySelectorAll(".finding")) finding.hidden = filter !== "all" && finding.dataset.level !== filter;
  for (const button of document.querySelectorAll("[data-filter]")) button.setAttribute("aria-pressed", String(button.dataset.filter === filter));
}

function clearRenderedResult() {
  current = null;
  elements.results.hidden = true;
  elements.summary.replaceChildren();
  elements.decision.replaceChildren();
  elements.files.replaceChildren();
}

function reset() {
  inspectionGeneration += 1;
  clearRenderedResult();
  elements.filePicker.value = "";
  elements.folderPicker.value = "";
  elements.status.textContent = "";
  elements.dropZone.scrollIntoView({ behavior: "smooth", block: "center" });
}

for (const button of document.querySelectorAll("[data-language]")) button.addEventListener("click", () => setLanguage(button.dataset.language));
elements.filePicker.addEventListener("change", () => inspectFiles(elements.filePicker.files, false));
elements.folderPicker.addEventListener("change", () => inspectFiles(elements.folderPicker.files, true));
for (const event of ["dragenter", "dragover"]) elements.dropZone.addEventListener(event, (input) => { input.preventDefault(); elements.dropZone.classList.add("drag"); });
for (const event of ["dragleave", "drop"]) elements.dropZone.addEventListener(event, (input) => { input.preventDefault(); elements.dropZone.classList.remove("drag"); });
elements.dropZone.addEventListener("drop", (event) => inspectFiles(event.dataTransfer.files, false));
elements.reset.addEventListener("click", reset);
elements.copyAll.addEventListener("click", () => current && copy([
  ...current.reports.map((report) => buildRepairTask(report, language)),
  ...(current.packageFindings?.length ? [buildPackageRepairTask(current.packageFindings, language)] : []),
].join("\n\n---\n\n")));
elements.downloadReport.addEventListener("click", () => {
  if (!current) return;
  download(`realitycheck-note-report-${new Date().toISOString().slice(0, 10)}.html`, buildPortableNoteReport(current, { buildRepairTask, buildPackageRepairTask, noteDecision }), "text/html;charset=utf-8");
  notify("Portable bilingual report downloaded.", "中英双语可携带报告已下载。");
});
elements.downloadJson.addEventListener("click", () => {
  if (!current) return;
  const { sources: _sources, analysis: _analysis, repairVerifications, ...safe } = current;
  safe.safeRepairVerifications = [...(repairVerifications?.values() || [])].map((verification) => ({
    kind: verification.kind,
    path: verification.path,
    changes: verification.changes,
    beforeScore: verification.before.report.score,
    afterScore: verification.after.report.score,
    downloadContext: verification.download.context,
    downloadScore: verification.download.summary.score,
    packageAssetsIncluded: verification.download.packageAssetsIncluded,
    downloadOnlyFindings: verification.download.onlyFindings.map((entry) => entry.key),
    resolved: verification.findings.resolved.map((entry) => entry.key),
    remaining: verification.findings.remaining.map((entry) => entry.key),
    introduced: verification.findings.introduced.map((entry) => entry.key),
    originalModified: verification.originalModified,
  }));
  download(`realitycheck-note-${new Date().toISOString().slice(0, 10)}.json`, `${JSON.stringify(safe, null, 2)}\n`, "application/json;charset=utf-8");
});
for (const button of document.querySelectorAll("[data-filter]")) button.addEventListener("click", () => {
  applyFilter(button.dataset.filter);
});
elements.demo.addEventListener("click", async () => {
  const html = `<!doctype html><html><head><title>AI research draft</title><style>main{min-width:860px}</style></head><body onclick="init()"><main><h1 id="result">Research TODO</h1><h3 id="result">Findings</h3><p>This AI-generated draft contains an unfinished placeholder {{citation}}, a local image, a broken contents link, and enough text to demonstrate a realistic note check.</p><a href="#methods">Read methods</a><img src="images/result.png"><script src="http://example.invalid/helper.js"></script></main></body></html>`;
  const file = new File([html], "ai-research-draft.html", { type: "text/html" });
  await inspectFiles([file], true);
});

let initial = (navigator.language || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en";
try { initial = localStorage.getItem("realitycheck-note-language") || initial; } catch (_) {}
setLanguage(initial);

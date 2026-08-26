import { analyzeHtmlNote, applySafeNoteFixes, buildRepairTask, normalizeNotePath } from "./note-analyzer.mjs?v=0.8.0";
import { analyzeNotePackage } from "./note-package.mjs?v=0.8.0";
import { buildPackageRepairTask, summarizeNoteReports, summarizePackageFindings, noteDecision } from "./note-summary.mjs?v=0.8.0";
import { buildPortableNoteReport } from "./note-share-report.mjs?v=0.8.0";
import { bindSafeFolderCandidate, buildVerifiedFolderRepairZip, prepareFolderRepairInventory } from "./note-folder-repair.mjs?v=0.8.0";
import { analyzeBrowserNoteSources, duplicateBrowserNotePaths, safeRepairDownloadName, safeRepairDownloadPayload, verifySafeNotePackageRepair, verifySafeNoteRepair } from "./note-repair-verification.mjs?v=0.8.0";

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
  downloadFolderZip: document.querySelector("#download-folder-zip"),
  downloadJson: document.querySelector("#download-json"),
  downloadReport: document.querySelector("#download-report"),
  folderRepair: document.querySelector("#folder-repair"),
  toast: document.querySelector("#toast"),
};

let language = "en";
let current = null;
let inspectionGeneration = 0;
let activeFolderRepairController = null;
const MAX_HTML_TEXT_BYTES = 32 * 1024 * 1024;
const MAX_CSS_TEXT_BYTES = 16 * 1024 * 1024;
const MAX_SELECTED_FILES = 5000;

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
  setTimeout(() => URL.revokeObjectURL(url), type === "application/zip" ? 30000 : 5000);
}

async function copy(text, messages = null) {
  try {
    await navigator.clipboard.writeText(text);
    notify(messages?.en || "Repair task copied.", messages?.zhCN || "修复任务已复制。");
  } catch (_) {
    notify("Copy was blocked by the browser.", "浏览器阻止了复制，请手动选择文本。");
  }
}

async function inspectFiles(fileList, folderMode = false) {
  const selectedFiles = [...fileList];
  activeFolderRepairController?.abort();
  activeFolderRepairController = null;
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
  if (allFiles.length > MAX_SELECTED_FILES) {
    elements.status.textContent = language === "zh-CN"
      ? `一次最多检查 ${MAX_SELECTED_FILES} 个浏览器所选文件。本次未读取任何内容；请缩小文件夹范围。`
      : `A check is limited to ${MAX_SELECTED_FILES} browser-selected files. No content was read; choose a smaller folder.`;
    return;
  }
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
  const htmlTextBytes = htmlFiles.reduce((sum, file) => sum + file.size, 0);
  if (htmlTextBytes > MAX_HTML_TEXT_BYTES) {
    elements.status.textContent = language === "zh-CN" ? "所选 HTML 总计超过 32 MiB，本次未读取或生成部分报告；请缩小文件夹范围。" : "Selected HTML exceeds the 32 MiB total text budget. No files were read and no partial report was created; choose a smaller folder.";
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
  const folderInventory = folderMode && allFiles.every((file) => typeof file.webkitRelativePath === "string" && file.webkitRelativePath)
    ? prepareFolderRepairInventory(allFiles.map((file) => ({ path: file.webkitRelativePath, file })), { normalizeNotePath })
    : null;
  elements.status.textContent = language === "zh-CN" ? `正在本地读取 ${htmlFiles.length} 个 HTML 文件…` : `Reading ${htmlFiles.length} HTML file(s) locally…`;
  const knownFiles = folderMode || allFiles.some((file) => file.webkitRelativePath) || allFiles.length > htmlFiles.length ? allFiles.map(pathFor) : null;
  const cssFiles = knownFiles ? allFiles.filter((file) => /\.css$/i.test(file.name)) : [];
  const readableCssBytes = cssFiles.filter((file) => file.size <= 5 * 1024 * 1024).reduce((sum, file) => sum + file.size, 0);
  if (readableCssBytes > MAX_CSS_TEXT_BYTES) {
    elements.status.textContent = language === "zh-CN" ? "所选可读取 CSS 总计超过 16 MiB，本次未生成不完整的文件包报告；请缩小文件夹范围。" : "Readable selected CSS exceeds the 16 MiB total text budget. No incomplete package report was created; choose a smaller folder.";
    return;
  }
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
    folderInventory,
    folderRepairState: folderInventory ? { status: folderInventory.eligible ? "idle" : "blocked", error: null } : null,
    folderRepairVerification: null,
    folderZipArtifact: null,
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

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function folderBlockerText(blocker) {
  const path = blocker.path ? ` · ${blocker.path}` : "";
  const messages = {
    "unsafe-path": { en: "A selected path is not portable.", zhCN: "所选路径不具备可迁移性。" },
    "missing-folder-root": { en: "Choose the folder picker so relative structure is available.", zhCN: "请使用文件夹选择器，以便保留相对目录结构。" },
    "multiple-folder-roots": { en: "The selection contains more than one top-level folder.", zhCN: "所选内容包含多个顶层文件夹。" },
    "unreadable-file": { en: "A selected file cannot be read as immutable bytes.", zhCN: "有文件无法作为只读字节读取。" },
    "file-name-mismatch": { en: "A selected File name does not match its relative path.", zhCN: "所选 File 名称与其相对路径不一致。" },
    "sensitive-path": { en: "A potentially sensitive file or development directory is selected; narrow the folder before archiving.", zhCN: "所选内容包含潜在敏感文件或开发目录；请缩小文件夹范围后再打包。" },
    "file-too-large": { en: "A selected file exceeds the 32 MiB archive limit.", zhCN: "有文件超过 32 MiB 打包上限。" },
    "too-many-files": { en: "The folder exceeds the archive file-count limit.", zhCN: "文件夹超过打包文件数量上限。" },
    "folder-too-large": { en: "The selected folder exceeds the 62 MiB input limit.", zhCN: "所选文件夹超过 62 MiB 输入上限。" },
    "zip-path-or-layout": { en: "The folder contains a path that cannot be extracted safely across platforms.", zhCN: "文件夹包含无法在不同平台安全解压的路径。" },
  };
  const message = messages[blocker.code] || { en: "The selected folder cannot be archived safely.", zhCN: "所选文件夹无法安全打包。" };
  return `${translate(message)}${path}`;
}

function renderFolderRepair(bundle) {
  const inventory = bundle.folderInventory;
  const state = bundle.folderRepairState;
  elements.folderRepair.replaceChildren();
  if (!inventory || !state) {
    elements.folderRepair.hidden = true;
    elements.downloadFolderZip.hidden = true;
    return;
  }
  elements.downloadFolderZip.hidden = false;
  elements.folderRepair.hidden = false;
  const repairableHtml = bundle.reports.filter((report) => report.counts.autoFixable > 0).length;
  const title = create("div", "folder-repair-heading");
  const repairTitle = state.status === "ready"
    ? (language === "zh-CN" ? "已验证安全元数据文件夹 ZIP" : "Verified safe-metadata folder ZIP")
    : state.status === "building"
      ? (language === "zh-CN" ? "正在验证安全元数据文件夹 ZIP" : "Verifying safe-metadata folder ZIP")
      : (language === "zh-CN" ? "安全元数据文件夹 ZIP" : "Safe-metadata folder ZIP");
  title.append(
    create("small", "", language === "zh-CN" ? "保持目录结构的新副本" : "STRUCTURE-PRESERVING NEW COPY"),
    create("h3", "", repairTitle),
  );
  const facts = create("div", "folder-repair-facts");
  for (const [value, label] of [
    [inventory.selectedFiles, language === "zh-CN" ? "浏览器所选文件" : "browser-selected files"],
    [inventory.htmlFiles, "HTML"],
    [formatBytes(inventory.selectedBytes), language === "zh-CN" ? "所选字节" : "selected bytes"],
    [repairableHtml, language === "zh-CN" ? "可安全修复 HTML" : "safe-fixable HTML"],
  ]) {
    const item = create("article");
    item.append(create("strong", "", String(value)), create("small", "", label));
    facts.append(item);
  }
  elements.folderRepair.append(title, facts);

  if (!inventory.eligible) {
    elements.downloadFolderZip.disabled = true;
    elements.downloadFolderZip.textContent = language === "zh-CN" ? "文件夹 ZIP 已阻止" : "Folder ZIP blocked";
    const list = create("ul", "folder-repair-blockers");
    for (const blocker of inventory.blockers.slice(0, 8)) list.append(create("li", "", folderBlockerText(blocker)));
    elements.folderRepair.append(create("p", "folder-repair-boundary", language === "zh-CN" ? "不会静默省略敏感、冲突或超限文件；请处理下列项目后重新选择文件夹。" : "Sensitive, conflicting, or oversized files are never silently omitted. Resolve these items and choose the folder again."), list);
    return;
  }
  if (!repairableHtml) {
    elements.downloadFolderZip.disabled = true;
    elements.downloadFolderZip.textContent = language === "zh-CN" ? "没有可应用的安全元数据修复" : "No safe metadata fixes available";
    elements.folderRepair.append(create("p", "folder-repair-boundary", language === "zh-CN" ? "当前文件夹没有可自动应用的三项元数据修复；原检查结果仍可下载。" : "This folder has none of the three automatic metadata fixes to apply; the original inspection report remains available."));
    return;
  }
  if (state.status === "building") {
    elements.downloadFolderZip.disabled = true;
    elements.downloadFolderZip.textContent = language === "zh-CN" ? "正在联合复检并验证 ZIP…" : "Rechecking and verifying ZIP…";
    elements.folderRepair.append(create("p", "folder-repair-boundary", language === "zh-CN" ? "正在同时修复所有可处理 HTML、重新检查完整文件包、构建 ZIP，并回读核验每个 entry。" : "Applying every eligible HTML metadata fix together, rechecking the complete package, building the ZIP, and reading every entry back for verification."));
    return;
  }
  if (state.status === "review") {
    elements.downloadFolderZip.disabled = false;
    elements.downloadFolderZip.textContent = language === "zh-CN" ? "确认清单并构建 ZIP" : "Confirm inventory & build ZIP";
    const inventoryText = inventory.files.map((item) => `${item.sourcePath} · ${formatBytes(item.size)}`).join("\n");
    const inventoryList = create("pre", "folder-repair-inventory", inventoryText);
    elements.folderRepair.append(
      create("p", "folder-repair-boundary", language === "zh-CN"
        ? "请检查下面的完整浏览器所选文件清单。确认后会全部打包，不会静默省略；若看到凭据、密钥或不应分享的附件，请先重新选择更小的文件夹。"
        : "Review the complete browser-selected inventory below. Confirmation includes every item without silent omission. If you see credentials, keys, or attachments that should not be shared, choose a smaller folder first."),
      inventoryList,
    );
    return;
  }
  if (state.status === "ready" && bundle.folderRepairVerification && bundle.folderZipArtifact) {
    const verification = bundle.folderRepairVerification;
    const artifact = bundle.folderZipArtifact;
    elements.downloadFolderZip.disabled = false;
    const again = state.downloaded ? (language === "zh-CN" ? "再次" : " again") : "";
    elements.downloadFolderZip.textContent = verification.after.summary.counts.error
      ? (language === "zh-CN" ? `${again}下载安全元数据 ZIP · 仍需修复` : `Download safe-metadata ZIP${again} · still needs fixes`)
      : (language === "zh-CN" ? `${again}下载已验证安全元数据 ZIP` : `Download verified safe-metadata ZIP${again}`);
    const outcome = create("div", "folder-repair-outcome");
    outcome.append(
      create("strong", "", `${verification.before.summary.score} → ${verification.after.summary.score}`),
      create("span", "", language === "zh-CN" ? "文件夹就绪度" : "folder readiness"),
      create("b", "", `${verification.changes.length} HTML · ${verification.totalChanges} ${language === "zh-CN" ? "项元数据修复" : "metadata fixes"}`),
      create("b", "", `${artifact.manifest.files} entries · ${formatBytes(artifact.manifest.archiveBytes)}`),
    );
    const changes = create("p", "folder-repair-counts", language === "zh-CN"
      ? `已解决 ${verification.findings.resolved.length} · 仍存在 ${verification.findings.remaining.length} · 恶化 ${verification.findings.worsened.length} · 新出现 ${verification.findings.introduced.length}`
      : `${verification.findings.resolved.length} resolved · ${verification.findings.remaining.length} remaining · ${verification.findings.worsened.length} worsened · ${verification.findings.introduced.length} introduced`);
    const candidate = create("div", "folder-candidate-id");
    const candidateCode = create("code", "", `${verification.candidateId.slice(0, 19)}…${verification.candidateId.slice(-8)}`);
    candidateCode.title = verification.candidateId;
    const copyCandidate = create("button", "copy-one", language === "zh-CN" ? "复制完整 ID" : "Copy full ID");
    copyCandidate.type = "button";
    copyCandidate.addEventListener("click", () => copy(verification.candidateId, { en: "Full candidate ID copied.", zhCN: "完整候选 ID 已复制。" }));
    candidate.append(
      create("span", "", language === "zh-CN" ? "候选分析指纹" : "candidate analysis fingerprint"),
      candidateCode,
      copyCandidate,
    );
    const boundary = create("p", "folder-repair-boundary", language === "zh-CN"
      ? "ZIP 已回读验证，包含浏览器所选的全部文件；修改仅限 doctype、lang、UTF-8 元数据。未创建缺失资源、未下载远程资源、未修复结构/内容/脚本；空目录、符号链接和浏览器未提供的隐藏文件无法保留。"
      : "The ZIP was read back and contains every browser-selected file. Changes are limited to doctype, lang, and UTF-8 metadata. Missing files were not invented, remote resources were not downloaded, and structure/content/scripts were not repaired. Empty directories, symlinks, and hidden files not supplied by the browser cannot be preserved.");
    elements.folderRepair.append(outcome, candidate, changes, boundary);
    return;
  }
  elements.downloadFolderZip.disabled = false;
  elements.downloadFolderZip.textContent = language === "zh-CN"
    ? `先检查 ZIP 文件清单 · ${inventory.selectedFiles} 个文件`
    : `Review ZIP inventory · ${inventory.selectedFiles} files`;
  if (state.status === "failed") elements.folderRepair.append(create("p", "folder-repair-error", language === "zh-CN" ? "上次 ZIP 构建失败，未下载任何文件；请重新检查文件清单后重试。" : "The previous ZIP build failed and nothing was downloaded; review the inventory before retrying."));
  elements.folderRepair.append(create("p", "folder-repair-boundary", language === "zh-CN"
    ? "将对全部可安全修复的 HTML 同时应用三项元数据修改，联合复检后把全部浏览器所选文件打包到新顶层目录；其余错误和警告继续保留。"
    : "All eligible HTML files receive the three safe metadata fixes together, then the complete package is rechecked and every browser-selected file is copied under a new top-level folder. All other errors and warnings remain visible."));
}

function render(bundle) {
  renderDecision(bundle);
  renderSummary(bundle);
  renderFolderRepair(bundle);
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
  elements.folderRepair.replaceChildren();
  elements.folderRepair.hidden = true;
  elements.downloadFolderZip.hidden = true;
}

function reset() {
  activeFolderRepairController?.abort();
  activeFolderRepairController = null;
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
elements.downloadFolderZip.addEventListener("click", async () => {
  const bundle = current;
  if (!bundle?.folderInventory?.eligible || !bundle.folderRepairState) return;
  if (bundle.folderRepairState.status === "ready" && bundle.folderZipArtifact) {
    download(bundle.folderZipArtifact.filename, bundle.folderZipArtifact.blob, "application/zip");
    bundle.folderRepairState = { ...bundle.folderRepairState, downloaded: true };
    render(bundle);
    elements.status.textContent = language === "zh-CN"
      ? `已下载 ${bundle.folderZipArtifact.filename}；这是已回读验证的安全元数据副本，仍有 ${bundle.folderRepairVerification.findings.remaining.length} 项问题需要处理。原文件未修改。`
      : `Downloaded ${bundle.folderZipArtifact.filename}. This read-back-verified safe-metadata copy still has ${bundle.folderRepairVerification.findings.remaining.length} finding(s) to address. Originals were not modified.`;
    notify("Verified safe-metadata folder ZIP downloaded.", "已下载验证后的安全元数据文件夹 ZIP。");
    return;
  }
  if (bundle.folderRepairState.status !== "review") {
    bundle.folderRepairState = { status: "review", error: null };
    render(bundle);
    elements.status.textContent = language === "zh-CN" ? "请先核对将被完整打包的文件清单，再确认构建。" : "Review the complete file inventory before confirming the archive build.";
    return;
  }
  activeFolderRepairController?.abort();
  const controller = new AbortController();
  activeFolderRepairController = controller;
  bundle.folderRepairState = { status: "building", error: null };
  render(bundle);
  elements.status.textContent = language === "zh-CN" ? "正在联合复检全部 HTML，并构建、回读验证文件夹 ZIP…" : "Rechecking every HTML together, then building and reading back the folder ZIP…";
  try {
    const verification = await bindSafeFolderCandidate(
      verifySafeNotePackageRepair({ beforeBundle: bundle, analysis: bundle.analysis }, noteAnalysisHelpers),
      { signal: controller.signal },
    );
    const afterReport = buildPortableNoteReport({
      ...verification.after,
      generatedAt: bundle.generatedAt,
      privacy: bundle.privacy,
      reportContext: "folder-candidate",
      safePackageRepairVerification: verification,
    }, { buildRepairTask, buildPackageRepairTask, noteDecision });
    const artifact = await buildVerifiedFolderRepairZip({
      inventory: bundle.folderInventory,
      verification,
      reportHtml: afterReport,
      generatedAt: bundle.generatedAt,
      signal: controller.signal,
    });
    if (controller.signal.aborted || current !== bundle) return;
    bundle.folderRepairVerification = verification;
    bundle.folderZipArtifact = artifact;
    bundle.folderRepairState = { status: "ready", error: null, downloaded: false };
    render(bundle);
    elements.status.textContent = language === "zh-CN"
      ? `文件夹 ZIP 已联合复检并回读验证，尚未下载：${verification.before.summary.score} → ${verification.after.summary.score}，${verification.changes.length} 个 HTML 应用 ${verification.totalChanges} 项元数据修复，仍有 ${verification.findings.remaining.length} 项问题。请点击下载。`
      : `Folder ZIP jointly rechecked and read-back verified, not downloaded yet: ${verification.before.summary.score} → ${verification.after.summary.score}; ${verification.totalChanges} metadata fixes across ${verification.changes.length} HTML file(s), with ${verification.findings.remaining.length} finding(s) remaining. Click download when ready.`;
    notify("Folder ZIP verified; review the result, then download.", "文件夹 ZIP 已验证；请复核结果后再下载。");
  } catch (error) {
    if (controller.signal.aborted || current !== bundle) return;
    bundle.folderRepairState = { status: "failed", error: String(error.message || error).slice(0, 300) };
    bundle.folderRepairVerification = null;
    bundle.folderZipArtifact = null;
    render(bundle);
    elements.status.textContent = language === "zh-CN" ? "文件夹 ZIP 未通过联合复检或回读验证，因此没有下载；原文件未修改。" : "The folder ZIP failed cumulative recheck or read-back verification, so nothing was downloaded. Originals were not modified.";
    notify("Folder ZIP failed verification; nothing downloaded.", "文件夹 ZIP 验证失败，未下载。");
  } finally {
    if (activeFolderRepairController === controller) activeFolderRepairController = null;
  }
});
elements.copyAll.addEventListener("click", () => current && copy([
  ...current.reports.map((report) => buildRepairTask(report, language)),
  ...(current.packageFindings?.length ? [buildPackageRepairTask(current.packageFindings, language)] : []),
].join("\n\n---\n\n")));
elements.downloadReport.addEventListener("click", () => {
  if (!current) return;
  download(`realitycheck-note-report-${new Date().toISOString().slice(0, 10)}.html`, buildPortableNoteReport({ ...current, reportContext: "original" }, { buildRepairTask, buildPackageRepairTask, noteDecision }), "text/html;charset=utf-8");
  notify("Portable bilingual report downloaded.", "中英双语可携带报告已下载。");
});
elements.downloadJson.addEventListener("click", () => {
  if (!current) return;
  const {
    sources: _sources,
    analysis: _analysis,
    folderInventory,
    folderRepairState: _folderRepairState,
    folderRepairVerification,
    folderZipArtifact,
    repairVerifications,
    ...safe
  } = current;
  safe.folderRepairAvailability = folderInventory ? {
    basis: "all-browser-selected-files",
    eligible: folderInventory.eligible,
    rootName: folderInventory.rootName,
    selectedFiles: folderInventory.selectedFiles,
    selectedBytes: folderInventory.selectedBytes,
    htmlFiles: folderInventory.htmlFiles,
    blockers: folderInventory.blockers,
    limits: folderInventory.limits,
  } : null;
  safe.safeFolderRepairVerification = folderRepairVerification && folderZipArtifact ? {
    kind: folderRepairVerification.kind,
    candidateId: folderRepairVerification.candidateId,
    basis: "cumulative-all-eligible-html",
    changes: folderRepairVerification.changes,
    totalChanges: folderRepairVerification.totalChanges,
    beforeSummary: folderRepairVerification.before.summary,
    afterSummary: folderRepairVerification.after.summary,
    afterStatus: folderRepairVerification.after.summary.status,
    beforeScore: folderRepairVerification.before.summary.score,
    afterScore: folderRepairVerification.after.summary.score,
    resolved: folderRepairVerification.findings.resolved.map((entry) => entry.key),
    remaining: folderRepairVerification.findings.remaining.map((entry) => entry.key),
    introduced: folderRepairVerification.findings.introduced.map((entry) => entry.key),
    worsened: folderRepairVerification.findings.worsened.map((entry) => entry.key),
    originalModified: folderRepairVerification.originalModified,
    scope: folderRepairVerification.scope,
    archive: {
      filename: folderZipArtifact.filename,
      selectedInventoryIncluded: folderZipArtifact.selectedInventoryIncluded,
      remoteResourcesBundled: folderZipArtifact.remoteResourcesBundled,
      missingReferencedFilesRestored: folderZipArtifact.missingReferencedFilesRestored,
      manifest: folderZipArtifact.manifest,
      proofPath: folderZipArtifact.proofPath,
      reportPath: folderZipArtifact.reportPath,
      boundary: folderZipArtifact.proof.archiveBoundary,
      inventorySha256: folderZipArtifact.proof.selection.inventorySha256,
    },
  } : null;
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
    worsened: verification.findings.worsened.map((entry) => entry.key),
    originalModified: verification.originalModified,
  }));
  download(`realitycheck-note-${new Date().toISOString().slice(0, 10)}.json`, `${JSON.stringify(safe, null, 2)}\n`, "application/json;charset=utf-8");
});
for (const button of document.querySelectorAll("[data-filter]")) button.addEventListener("click", () => {
  applyFilter(button.dataset.filter);
});
elements.demo.addEventListener("click", async () => {
  const withPath = (content, path, type) => {
    const file = new File([content], path.split("/").at(-1), { type });
    Object.defineProperty(file, "webkitRelativePath", { value: path });
    return file;
  };
  const files = [
    withPath(`<!doctype html><html><head><title>AI research draft</title><link rel="stylesheet" href="assets/note.css"></head><body onclick="init()"><main><h1 id="result">Research TODO</h1><h3 id="result">Findings</h3><p>This AI-generated draft contains an unfinished placeholder {{citation}}, a local image, a broken contents link, and enough text to demonstrate a realistic note check.</p><a href="#methods">Read methods</a><img src="images/result.svg"><script src="http://example.invalid/helper.js"></script></main></body></html>`, "realitycheck-demo/ai-research-draft.html", "text/html"),
    withPath(`<html><head><title>Linked guide</title></head><body><main><h1 id="guide">Linked guide</h1><p>This linked note proves that all eligible HTML files receive their safe metadata fixes together while the selected folder structure remains intact.</p><a href="ai-research-draft.html#result">Back to findings</a></main></body></html>`, "realitycheck-demo/guide.html", "text/html"),
    withPath(`main{max-width:72rem;margin:auto;min-width:860px}`, "realitycheck-demo/assets/note.css", "text/css"),
    withPath(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><rect width="160" height="90" fill="#dfe9ff"/><path d="M20 68 60 32l26 20 52-34" fill="none" stroke="#315f8d" stroke-width="7"/></svg>`, "realitycheck-demo/images/result.svg", "image/svg+xml"),
  ];
  await inspectFiles(files, true);
});

let initial = (navigator.language || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en";
try { initial = localStorage.getItem("realitycheck-note-language") || initial; } catch (_) {}
setLanguage(initial);

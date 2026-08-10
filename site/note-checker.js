import { analyzeHtmlNote, applySafeNoteFixes, buildRepairTask } from "./note-analyzer.mjs?v=0.4.0-simple";

const elements = {
  dropZone: document.querySelector("#drop-zone"),
  filePicker: document.querySelector("#file-picker"),
  folderPicker: document.querySelector("#folder-picker"),
  demo: document.querySelector("#demo-button"),
  status: document.querySelector("#status"),
  results: document.querySelector("#results"),
  summary: document.querySelector("#summary"),
  files: document.querySelector("#file-results"),
  reset: document.querySelector("#reset-button"),
  copyAll: document.querySelector("#copy-all"),
  downloadJson: document.querySelector("#download-json"),
  toast: document.querySelector("#toast"),
};

let language = "en";
let current = null;

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
  return (file.webkitRelativePath || file.name).replaceAll("\\", "/");
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

function summarize(reports) {
  const counts = { error: 0, warning: 0, advice: 0, autoFixable: 0 };
  for (const report of reports) for (const key of Object.keys(counts)) counts[key] += report.counts[key];
  return { files: reports.length, score: Math.round(reports.reduce((sum, report) => sum + report.score, 0) / reports.length), counts };
}

async function inspectFiles(fileList, folderMode = false) {
  const files = [...fileList].filter((file) => file.size <= 25 * 1024 * 1024);
  const htmlFiles = files.filter((file) => /\.html?$/i.test(file.name));
  if (!htmlFiles.length) {
    elements.status.textContent = language === "zh-CN" ? "没有找到 .html 或 .htm 文件。" : "No .html or .htm file was found.";
    return;
  }
  if (htmlFiles.length > 200) {
    elements.status.textContent = language === "zh-CN" ? "一次最多检查 200 个 HTML 文件，请缩小文件夹范围。" : "A check is limited to 200 HTML files. Choose a smaller folder.";
    return;
  }
  elements.status.textContent = language === "zh-CN" ? `正在本地读取 ${htmlFiles.length} 个 HTML 文件…` : `Reading ${htmlFiles.length} HTML file(s) locally…`;
  const knownFiles = folderMode || files.some((file) => file.webkitRelativePath) || files.length > htmlFiles.length ? files.map(pathFor) : null;
  const sources = new Map();
  const reports = [];
  for (const file of htmlFiles) {
    const html = await file.text();
    const path = pathFor(file);
    sources.set(path, { file, html });
    reports.push(analyzeHtmlNote({ path, html, knownFiles }));
  }
  reports.sort((left, right) => left.score - right.score || left.path.localeCompare(right.path));
  current = {
    schemaVersion: "1",
    kind: "html-note-browser-check",
    generatedAt: new Date().toISOString(),
    privacy: { uploaded: false, sourceModified: false },
    knownFiles: knownFiles ? knownFiles.length : null,
    summary: summarize(reports),
    reports,
    sources,
  };
  render(current);
  elements.status.textContent = language === "zh-CN" ? "检查完成。文件内容没有离开当前浏览器。" : "Check complete. File content never left this browser.";
  elements.results.hidden = false;
  elements.results.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderSummary(bundle) {
  elements.summary.replaceChildren();
  const cards = [
    [bundle.summary.score, "/100", { en: "average health", zhCN: "平均健康度" }],
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

function renderFinding(report, finding) {
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
  button.addEventListener("click", () => copy(buildRepairTask({ ...report, findings: [finding] }, language)));
  article.append(top, heading, summary, remedy, details, button);
  return article;
}

function repairedName(path) {
  return path.replace(/\.html?$/i, ".repaired.html").split("/").pop();
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
    const fix = create("button", "download-fix", language === "zh-CN" ? "下载安全修复副本" : "Download safe repaired copy");
    fix.type = "button";
    fix.addEventListener("click", () => {
      const repaired = applySafeNoteFixes(source.html);
      download(repairedName(report.path), repaired.html, "text/html;charset=utf-8");
      notify(`Downloaded a new copy with ${repaired.changes.length} safe fix(es).`, `已下载包含 ${repaired.changes.length} 项安全修复的新副本。`);
    });
    header.append(fix);
  }
  const list = create("div", "finding-list");
  if (!report.findings.length) list.append(create("p", "clean", language === "zh-CN" ? "启用的笔记规则没有发现问题。" : "No problems found by the enabled note rules."));
  else for (const finding of report.findings) list.append(renderFinding(report, finding));
  section.append(header, list);
  return section;
}

function render(bundle) {
  renderSummary(bundle);
  elements.files.replaceChildren(...bundle.reports.map((report) => renderFile(report, bundle)));
  applyFilter(bundle.summary.counts.error ? "error" : bundle.summary.counts.warning ? "warning" : "all");
}

function applyFilter(filter) {
  for (const finding of document.querySelectorAll(".finding")) finding.hidden = filter !== "all" && finding.dataset.level !== filter;
  for (const button of document.querySelectorAll("[data-filter]")) button.setAttribute("aria-pressed", String(button.dataset.filter === filter));
}

function reset() {
  current = null;
  elements.results.hidden = true;
  elements.summary.replaceChildren();
  elements.files.replaceChildren();
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
elements.copyAll.addEventListener("click", () => current && copy(current.reports.map((report) => buildRepairTask(report, language)).join("\n\n---\n\n")));
elements.downloadJson.addEventListener("click", () => {
  if (!current) return;
  const safe = { ...current, sources: undefined };
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

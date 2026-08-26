#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeHtmlNote, applySafeNoteFixes, buildRepairTask } from "./note-analyzer.mjs";
import {
  compareNoteBundles,
  markLegacyPackageScopeUnverified,
  noteComparisonGateFailed,
  noteComparisonRegressionCounts,
  prepareNoteBaselineForComparison,
} from "./note-compare.mjs";
import { renderNoteComparisonHtml } from "./note-comparison-report.mjs";
import { analyzeNotePackage } from "./note-package.mjs";
import { buildPackageRepairTask, summarizeNoteReports, summarizePackageFindings } from "./note-summary.mjs";

const HTML_EXTENSIONS = new Set([".htm", ".html"]);
const IGNORED_DIRECTORIES = new Set([".git", ".realitycheck", "node_modules"]);
const LEVEL_ORDER = Object.freeze({ error: 0, warning: 1, advice: 2 });
const MAX_REPAIR_COPY_BYTES = 512 * 1024 * 1024;
const MAX_BASELINE_BYTES = 64 * 1024 * 1024;
const STABLE_PUBLISH_LOCK_NAME = ".stable-publish.lock";
const STABLE_PUBLISH_RECOVERY_GUARD_NAME = ".stable-publish-recovery.lock";
const STABLE_PUBLISH_WAIT_MS = 15_000;
const STABLE_PUBLISH_STALE_MS = 5_000;
const STABLE_PUBLISH_POLL_MS = 25;
const ATOMIC_RENAME_RETRY_CODES = new Set(["EACCES", "EBUSY", "EEXIST", "EPERM"]);
const SLEEP_VIEW = new Int32Array(new SharedArrayBuffer(4));

function usage() {
  return `RealityCheck Note — local HTML note health check

Usage:
  realitycheck note <FILE|DIRECTORY> [options]

Options:
  --output PATH            Report root (default: .realitycheck/notes)
  --fix-safe               Write repaired copies for unambiguous metadata fixes
  --prepare-repair         Copy the bounded note bundle and apply safe fixes for Codex repair
  --baseline PATH          Compare with an earlier html-note-check-bundle; gate regressions only
  --fail-on LEVEL          error|warning|never (default: never)
  --language en|zh-CN      Terminal summary language (default: zh-CN)
  --max-files NUMBER       Maximum HTML notes, 1-500 (default: 200)
  -h, --help               Show this help

The command never uploads files and never overwrites the source note.`;
}

function parseArguments(argv) {
  const args = [...argv];
  const options = { input: null, output: ".realitycheck/notes", baseline: null, fixSafe: false, prepareRepair: false, failOn: "never", language: "zh-CN", maxFiles: 200 };
  while (args.length) {
    const item = args.shift();
    if (item === "-h" || item === "--help") return { ...options, help: true };
    if (item === "--fix-safe") {
      options.fixSafe = true;
      continue;
    }
    if (item === "--prepare-repair") {
      options.prepareRepair = true;
      continue;
    }
    if (["--output", "--baseline", "--fail-on", "--language", "--max-files"].includes(item)) {
      const value = args.shift();
      if (!value) throw new Error(`${item} requires a value`);
      if (item === "--output") options.output = value;
      if (item === "--baseline") options.baseline = value;
      if (item === "--fail-on") options.failOn = value;
      if (item === "--language") options.language = value;
      if (item === "--max-files") options.maxFiles = Number(value);
      continue;
    }
    if (item.startsWith("--")) throw new Error(`Unknown option: ${item}`);
    if (options.input) throw new Error(`Unexpected argument: ${item}`);
    options.input = item;
  }
  if (!options.input) throw new Error("note requires an HTML file or directory");
  if (!new Set(["error", "warning", "never"]).has(options.failOn)) throw new Error("--fail-on must be error, warning, or never");
  if (!new Set(["en", "zh-CN"]).has(options.language)) throw new Error("--language must be en or zh-CN");
  if (!Number.isInteger(options.maxFiles) || options.maxFiles < 1 || options.maxFiles > 500) throw new Error("--max-files must be an integer from 1 to 500");
  return options;
}

function portablePath(value) {
  return value.split(sep).join("/");
}

function discover(root, { htmlLimit, fileLimit = 10000 }) {
  const htmlFiles = [];
  const allFiles = [];
  let truncated = false;
  const walk = (directory) => {
    if (truncated) return;
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) walk(fullPath);
        if (truncated) return;
        continue;
      }
      if (!entry.isFile()) continue;
      allFiles.push(fullPath);
      if (HTML_EXTENSIONS.has(extname(entry.name).toLowerCase()) && htmlFiles.length < htmlLimit) htmlFiles.push(fullPath);
      else if (HTML_EXTENSIONS.has(extname(entry.name).toLowerCase())) truncated = true;
      if (allFiles.length >= fileLimit) truncated = true;
      if (truncated) return;
    }
  };
  walk(root);
  return { htmlFiles, allFiles, truncated };
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(".", "");
}

export function createNoteRunDirectory(outputRoot, fingerprint, stamp = timestamp()) {
  mkdirSync(outputRoot, { recursive: true });
  const base = `${stamp}-${fingerprint}`;
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const runId = attempt ? `${base}-${String(attempt).padStart(3, "0")}` : base;
    const runDirectory = join(outputRoot, runId);
    try {
      mkdirSync(runDirectory);
      return { runId, runDirectory };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error("Could not allocate a unique note evidence directory");
}

function sleepSync(milliseconds) {
  Atomics.wait(SLEEP_VIEW, 0, 0, milliseconds);
}

function lockOwner(lockPath) {
  let stat;
  try {
    stat = lstatSync(lockPath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return { stat: null, metadata: null };
  }
  if (!stat.isFile() || stat.size > 16 * 1024) return { stat, metadata: null };
  try {
    return { stat, metadata: JSON.parse(readFileSync(lockPath, "utf8")) };
  } catch {
    // A process can be terminated between exclusive creation and writing its
    // owner record. Preserve the timestamp so that empty/malformed orphan
    // locks can still age out safely.
    return { stat, metadata: null };
  }
}

function processIsRunning(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function createOwnedLock(lockPath) {
  const token = `${process.pid}-${randomUUID()}`;
  let descriptor;
  try {
    descriptor = openSync(lockPath, "wx");
    writeFileSync(descriptor, `${JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() })}\n`, "utf8");
    fsyncSync(descriptor);
    return { lockPath, token, descriptor };
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch {}
      try { rmSync(lockPath, { force: true }); } catch {}
    }
    if (error?.code === "EEXIST") return null;
    throw error;
  }
}

function releaseOwnedLock(lock) {
  try {
    closeSync(lock.descriptor);
  } finally {
    const current = lockOwner(lock.lockPath);
    if (current?.metadata?.token === lock.token) rmSync(lock.lockPath, { force: true });
  }
}

function recoverStalePublishLock(outputRoot, lockPath, staleMilliseconds) {
  const observed = lockOwner(lockPath);
  if (!observed) return true;
  if (!observed.stat || Date.now() - observed.stat.mtimeMs <= staleMilliseconds) return false;
  if (processIsRunning(observed.metadata?.pid)) return false;

  // Only one recovery can inspect/delete the main lock at a time. Ordinary
  // acquisition also observes this guard, closing the read-then-remove window
  // in which a freshly created main lock could otherwise be deleted.
  const guardPath = join(outputRoot, STABLE_PUBLISH_RECOVERY_GUARD_NAME);
  const guard = createOwnedLock(guardPath);
  if (!guard) return false;
  try {
    const current = lockOwner(lockPath);
    if (!current) return true;
    if (!current.stat || Date.now() - current.stat.mtimeMs <= staleMilliseconds) return false;
    if (processIsRunning(current.metadata?.pid)) return false;
    try {
      rmSync(lockPath, { force: true });
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return true;
      return false;
    }
  } finally {
    releaseOwnedLock(guard);
  }
}

function acquireStablePublishLock(outputRoot, {
  waitMilliseconds = STABLE_PUBLISH_WAIT_MS,
  staleMilliseconds = STABLE_PUBLISH_STALE_MS,
} = {}) {
  mkdirSync(outputRoot, { recursive: true });
  const lockPath = join(outputRoot, STABLE_PUBLISH_LOCK_NAME);
  const guardPath = join(outputRoot, STABLE_PUBLISH_RECOVERY_GUARD_NAME);
  const deadline = Date.now() + waitMilliseconds;
  while (true) {
    if (existsSync(guardPath)) {
      if (Date.now() >= deadline) throw new Error(`Timed out waiting to publish stable note artifacts in ${outputRoot}`);
      sleepSync(Math.min(STABLE_PUBLISH_POLL_MS, Math.max(1, deadline - Date.now())));
      continue;
    }
    let lock;
    try {
      lock = createOwnedLock(lockPath);
    } catch (error) {
      throw error;
    }
    if (lock) {
      // A recovery may have acquired its guard after our first check. Giving
      // the main lock back keeps normal acquisition out of that critical
      // section; the recovery will revalidate rather than delete this owner.
      if (existsSync(guardPath)) {
        releaseOwnedLock(lock);
      } else {
        return lock;
      }
    } else if (recoverStalePublishLock(outputRoot, lockPath, staleMilliseconds)) {
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting to publish stable note artifacts in ${outputRoot}`);
    }
    sleepSync(Math.min(STABLE_PUBLISH_POLL_MS, Math.max(1, deadline - Date.now())));
  }
}

function releaseStablePublishLock(lock) {
  releaseOwnedLock(lock);
}

function stageStableFile(target, contents) {
  const temporary = join(dirname(target), `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx");
    writeFileSync(descriptor, contents, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    return temporary;
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch {}
    }
    rmSync(temporary, { force: true });
    throw error;
  }
}

function replaceStableFile(temporary, target) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      renameSync(temporary, target);
      return;
    } catch (error) {
      if (!ATOMIC_RENAME_RETRY_CODES.has(error?.code) || attempt === 9) throw error;
      // Windows can briefly retain a handle after a reader closes it. Keep the
      // same-directory temporary file and retry the atomic replace; never fall
      // back to deleting the destination first.
      sleepSync(10 * (attempt + 1));
    }
  }
}

function publishStableNoteArtifacts(outputRoot, {
  reportJson,
  reportHtml,
  repairPlanEn,
  repairPlanZh,
  comparisonJson,
  comparisonHtml,
}) {
  const lock = acquireStablePublishLock(outputRoot);
  const staged = [];
  try {
    const specifications = [
      ["report.json", reportJson],
      ["repair-plan.md", repairPlanEn],
      ["repair-plan.zh-CN.md", repairPlanZh],
      ["latest.html", reportHtml],
      ...(comparisonJson ? [["comparison.json", comparisonJson], ["comparison.html", comparisonHtml]] : []),
      // Treat latest.json as the commit marker and replace it last.
      ["latest.json", reportJson],
    ];
    for (const [name, contents] of specifications) {
      const target = join(outputRoot, name);
      staged.push({ name, target, temporary: stageStableFile(target, contents) });
    }

    for (const artifact of staged.slice(0, -1)) replaceStableFile(artifact.temporary, artifact.target);
    if (!comparisonJson) {
      rmSync(join(outputRoot, "comparison.json"), { force: true });
      rmSync(join(outputRoot, "comparison.html"), { force: true });
    }
    const latest = staged.at(-1);
    replaceStableFile(latest.temporary, latest.target);
  } finally {
    for (const artifact of staged) rmSync(artifact.temporary, { force: true });
    releaseStablePublishLock(lock);
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function localized(value, language) {
  return language === "zh-CN" ? value.zhCN : value.en;
}

function renderHtml(bundle) {
  const { reports, summary, packageFindings = [], packageSummary = summarizePackageFindings(packageFindings) } = bundle;
  const comparisonBanner = bundle.comparison ? `<section class="comparison-banner">
    <div><b data-en="Baseline comparison" data-zh-cn="基线差异">Baseline comparison</b><span data-en="${bundle.comparison.gate.failed ? "Regression gate failed" : "Regression gate passed"}" data-zh-cn="${bundle.comparison.gate.failed ? "回归门禁未通过" : "回归门禁已通过"}">${bundle.comparison.gate.failed ? "Regression gate failed" : "Regression gate passed"}</span></div>
    <p><strong>${bundle.comparison.counts.new}</strong> <span data-en="new" data-zh-cn="新增">new</span> · <strong>${bundle.comparison.counts.worsened}</strong> <span data-en="worsened" data-zh-cn="恶化">worsened</span> · <strong>${bundle.comparison.counts.unverified}</strong> <span data-en="unverified" data-zh-cn="未核验">unverified</span> · <strong>${bundle.comparison.counts.resolved}</strong> <span data-en="resolved" data-zh-cn="已解决">resolved</span> · <strong>${bundle.comparison.counts.persistent}</strong> <span data-en="persistent" data-zh-cn="仍存在">persistent</span></p>
  </section>` : "";
  const repairTasks = (language) => [
    ...reports.map((report) => buildRepairTask(report, language)),
    ...(packageFindings.length ? [buildPackageRepairTask(packageFindings, language)] : []),
  ].join("\n\n---\n\n");
  const allTaskZh = repairTasks("zh-CN");
  const allTaskEn = repairTasks("en");
  const findingCard = (finding, taskEn, taskZh) => {
    const locations = finding.evidence.map((item) => `<li><code>${escapeHtml(item.path)}:${item.line}</code><span>${escapeHtml(item.excerpt)}</span></li>`).join("");
    return `<article class="finding" data-level="${finding.level}">
        <div class="finding-head"><span class="level ${finding.level}" data-en="${finding.level.toUpperCase()}" data-zh-cn="${finding.level === "error" ? "错误" : finding.level === "warning" ? "警告" : "建议"}">${finding.level.toUpperCase()}</span><code>${escapeHtml(finding.id)}</code>${finding.safeFix ? '<span class="safe" data-en="SAFE COPY FIX" data-zh-cn="可安全生成副本">SAFE COPY FIX</span>' : ""}</div>
        <h3 data-en="${escapeHtml(finding.title.en)}" data-zh-cn="${escapeHtml(finding.title.zhCN)}">${escapeHtml(finding.title.en)}</h3>
        <p data-en="${escapeHtml(finding.summary.en)}" data-zh-cn="${escapeHtml(finding.summary.zhCN)}">${escapeHtml(finding.summary.en)}</p>
        <div class="remedy"><b data-en="How to fix" data-zh-cn="如何修改">How to fix</b><span data-en="${escapeHtml(finding.remediation.en)}" data-zh-cn="${escapeHtml(finding.remediation.zhCN)}">${escapeHtml(finding.remediation.en)}</span></div>
        <details><summary data-en="Evidence (${finding.affectedCount})" data-zh-cn="证据（${finding.affectedCount}）">Evidence (${finding.affectedCount})</summary><ul>${locations}</ul></details>
        <button type="button" class="copy-task" data-task-en="${escapeHtml(taskEn)}" data-task-zh-cn="${escapeHtml(taskZh)}" data-en="Copy this repair task" data-zh-cn="复制此项修复任务">Copy this repair task</button>
      </article>`;
  };
  const fileCards = reports.map((report) => {
    const findings = report.findings.map((finding) => {
      const taskZh = buildRepairTask({ ...report, findings: [finding] }, "zh-CN");
      const taskEn = buildRepairTask({ ...report, findings: [finding] }, "en");
      return findingCard(finding, taskEn, taskZh);
    }).join("");
    return `<section class="file-card">
      <header><div><p>${escapeHtml(report.path)}</p><h2>${report.score}<small>/100</small></h2></div><div class="file-metrics"><span>${report.counts.error} <i data-en="errors" data-zh-cn="错误">errors</i></span><span>${report.counts.warning} <i data-en="warnings" data-zh-cn="警告">warnings</i></span><span>${report.metrics.words} <i data-en="words/characters" data-zh-cn="词/字">words/characters</i></span></div></header>
      <div class="findings">${findings || '<p class="clean" data-en="No problems found by the enabled note rules." data-zh-cn="启用的笔记规则没有发现问题。">No problems found by the enabled note rules.</p>'}</div>
    </section>`;
  }).join("");
  const packageCard = packageFindings.length ? `<section class="file-card package-card">
      <header><div><p data-en="FILE PACKAGE DEPENDENCIES" data-zh-cn="文件包依赖">FILE PACKAGE DEPENDENCIES</p><h2 data-en="PACKAGE" data-zh-cn="文件包">PACKAGE</h2></div><div class="file-metrics"><span>${packageSummary.counts.error}<i data-en="errors" data-zh-cn="错误">errors</i></span><span>${packageSummary.counts.warning}<i data-en="warnings" data-zh-cn="警告">warnings</i></span><span>${packageSummary.affected}<i data-en="affected references" data-zh-cn="受影响引用">affected references</i></span></div></header>
      <div class="findings">${packageFindings.map((finding) => findingCard(finding, buildPackageRepairTask([finding], "en"), buildPackageRepairTask([finding], "zh-CN"))).join("")}</div>
    </section>` : "";
  const readinessLabelEn = packageFindings.length ? "folder readiness · lowest HTML file adjusted by package findings" : "folder readiness · lowest file";
  const readinessLabelZh = packageFindings.length ? "文件夹就绪度 · 最低 HTML 分并计入文件包问题" : "文件夹就绪度 · 最低文件分";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RealityCheck Note Report</title>
<style>
:root{--ink:#1b1d22;--muted:#656b76;--line:#dedbd4;--paper:#fff;--canvas:#f6f4f0;--accent:#ff5c35;--error:#b42318;--warning:#9a5b05;--advice:#3559a6;font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:var(--ink);background:var(--canvas)}*{box-sizing:border-box}body{margin:0}.wrap{width:min(1040px,calc(100% - 32px));margin:auto}.top{padding:13px 0;color:#fff;background:#191b20}.top .wrap{display:flex;align-items:center;gap:12px}.top b{font-size:16px}.top span{color:#aeb2bb;font-size:11px}.language{display:flex;gap:4px;margin-left:auto}.language button,.filters button,.copy-task,.actions button,.actions a{min-height:40px;border:1px solid #d3cfc7;border-radius:8px;padding:0 12px;background:#fff;color:var(--ink);font:800 11px inherit;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}.language button{min-height:32px;border-color:#444750;background:#23252b;color:#aeb2bc}.language button[aria-pressed=true]{background:#fff;color:#17191f}.hero{padding:38px 0 18px}.eyebrow{margin:0 0 8px;color:var(--accent);font-size:10px;font-weight:900;letter-spacing:.12em}.hero h1{max-width:720px;margin:0;font-size:clamp(32px,5vw,48px);line-height:1.03;letter-spacing:-.045em}.hero>p:not(.eyebrow){max-width:760px;margin:14px 0 0;color:var(--muted);font-size:13px;line-height:1.6}.summary{display:grid;grid-template-columns:1.25fr repeat(4,1fr);margin:16px 0 12px;border:1px solid var(--line);border-radius:13px;background:var(--paper);overflow:hidden}.summary div{min-height:86px;display:flex;flex-direction:column;justify-content:center;padding:16px;border-left:1px solid var(--line)}.summary div:first-child{border:0;background:#202127;color:#fff}.summary strong{font-size:30px;letter-spacing:-.05em}.summary span{color:var(--muted);font-size:10px}.summary div:first-child span{color:#c4c7cf}.comparison-banner{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:0 0 12px;padding:13px 15px;border:1px solid var(--line);border-radius:10px;background:var(--paper)}.comparison-banner div{display:grid;gap:3px}.comparison-banner span,.comparison-banner p{color:var(--muted);font-size:11px}.comparison-banner p{margin:0}.comparison-banner p strong{color:var(--ink)}.next-step{margin:0 0 14px;color:var(--muted);font-size:11px}.actions,.filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}.actions button:first-child{color:#fff;background:#202127}.filters button[aria-pressed=true]{border-color:#202127;background:#202127;color:#fff}.file-card{margin:14px 0 26px;border:1px solid var(--line);border-radius:13px;background:var(--paper);overflow:hidden}.file-card>header{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:18px 20px;border-bottom:1px solid var(--line)}.file-card header p{margin:0 0 4px;color:var(--muted);font:11px ui-monospace,monospace}.file-card h2{margin:0;font-size:29px}.file-card h2 small{font-size:11px;color:var(--muted)}.file-metrics{display:flex;gap:20px}.file-metrics span{font-weight:900}.file-metrics i{display:block;color:var(--muted);font-size:9px;font-style:normal;font-weight:600}.findings{display:grid;gap:8px;padding:12px}.finding{padding:17px;border:1px solid var(--line);border-radius:10px;background:#fff}.finding[hidden]{display:none}.finding-head{display:flex;align-items:center;gap:8px}.finding-head code{color:var(--muted);font-size:10px}.level,.safe{padding:4px 6px;border-radius:5px;font-size:9px;font-weight:900}.level.error{color:#fff;background:var(--error)}.level.warning{color:#5b3500;background:#ffe6aa}.level.advice{color:#23427f;background:#dfe9ff}.safe{margin-left:auto;color:#17664d;background:#dcf5e9}.finding h3{margin:12px 0 6px;font-size:18px}.finding>p{margin:0;color:var(--muted);font-size:13px;line-height:1.55}.remedy{display:grid;gap:5px;margin:13px 0;padding:11px 12px;border-left:3px solid var(--accent);background:#f7f4ef}.remedy b{font-size:10px;text-transform:uppercase}.remedy span{font-size:12px;line-height:1.5}.finding details{margin:10px 0}.finding summary{cursor:pointer;font-size:11px;font-weight:800}.finding ul{padding-left:18px}.finding li{margin:7px 0}.finding li code{display:block;font-size:10px}.finding li span{color:var(--muted);font-size:11px}.copy-task{border:0!important;padding:0!important;border-bottom:1px solid currentColor!important;border-radius:0!important}.clean{padding:22px;color:#17664d}.notice{margin:22px 0;padding:14px;border-radius:9px;color:#534a2e;background:#fff0bd;font-size:12px;line-height:1.6}.toast{position:fixed;right:18px;bottom:18px;opacity:0;padding:10px 13px;border-radius:8px;background:#202127;color:#fff;font-size:11px;transition:.2s}.toast.show{opacity:1}.footer{padding:24px 0 38px;color:var(--muted);font-size:11px}@media(max-width:750px){.summary{grid-template-columns:1fr 1fr}.summary div:first-child{grid-column:1/-1}.summary div:nth-child(even){border-left:0}.comparison-banner{align-items:flex-start;flex-direction:column}.file-card>header{align-items:flex-start;flex-direction:column}.file-metrics{width:100%;justify-content:space-between}.safe{margin-left:0}.finding-head{flex-wrap:wrap}}
</style></head><body>
<header class="top"><div class="wrap"><b>RealityCheck Note</b><span data-en="Local HTML note health check" data-zh-cn="本地 HTML 笔记体检">Local HTML note health check</span><div class="language" role="group" aria-label="Language"><button type="button" data-language="en" aria-pressed="true">EN</button><button type="button" data-language="zh-CN" aria-pressed="false">中文</button></div></div></header>
<main class="wrap"><section class="hero"><p class="eyebrow" data-en="CHECK COMPLETE" data-zh-cn="检查完成">CHECK COMPLETE</p><h1 data-en="Results and next steps" data-zh-cn="结果与下一步">Results and next steps</h1><p data-en="Start with errors. Each item explains the impact, the recommended change, and the source evidence." data-zh-cn="先处理错误。每一项都说明影响、建议修改方法和源文件证据。">Start with errors. Each item explains the impact, the recommended change, and the source evidence.</p></section>
<section class="summary"><div><strong>${summary.score}<small>/100</small></strong><span data-en="${readinessLabelEn}" data-zh-cn="${readinessLabelZh}">${readinessLabelEn}</span></div><div><strong>${summary.files}</strong><span data-en="HTML files" data-zh-cn="HTML 文件">HTML files</span></div><div><strong>${summary.counts.error}</strong><span data-en="errors" data-zh-cn="错误">errors</span></div><div><strong>${summary.counts.warning}</strong><span data-en="warnings" data-zh-cn="警告">warnings</span></div><div><strong>${summary.counts.autoFixable}</strong><span data-en="safe copy fixes" data-zh-cn="安全副本修复">safe copy fixes</span></div></section>
${comparisonBanner}
<p class="next-step" data-en="Safe fixes create new copies; the checked source files are never overwritten." data-zh-cn="安全修复只生成新副本，绝不会覆盖已检查的源文件。">Safe fixes create new copies; the checked source files are never overwritten.</p>
<div class="actions"><button type="button" id="copy-all" data-task-en="${escapeHtml(allTaskEn)}" data-task-zh-cn="${escapeHtml(allTaskZh)}" data-en="Copy repair task for AI" data-zh-cn="复制给 AI 的修复任务">Copy repair task for AI</button><a href="report.json" download data-en="Download evidence" data-zh-cn="下载检查证据">Download evidence</a>${bundle.comparison ? '<a href="comparison.html" data-en="Open baseline comparison" data-zh-cn="打开基线差异">Open baseline comparison</a>' : ""}<a href="repair-plan.zh-CN.md" download data-en="Download repair plan" data-zh-cn="下载修复计划">Download repair plan</a></div>
<div class="filters" role="group" aria-label="Finding filters"><button type="button" data-filter="all" aria-pressed="true" data-en="All findings" data-zh-cn="全部问题">All findings</button><button type="button" data-filter="error" aria-pressed="false" data-en="Errors" data-zh-cn="错误">Errors</button><button type="button" data-filter="warning" aria-pressed="false" data-en="Warnings" data-zh-cn="警告">Warnings</button><button type="button" data-filter="advice" aria-pressed="false" data-en="Advice" data-zh-cn="建议">Advice</button></div>
${bundle.discovery.truncated ? '<p class="notice" data-en="Discovery reached its safety limit. Unseen local attachments were not falsely reported as missing." data-zh-cn="文件发现达到安全上限；未看到的本地附件不会被误报为缺失。">Discovery reached its safety limit. Unseen local attachments were not falsely reported as missing.</p>' : ""}
${packageCard}${fileCards}</main><footer class="footer wrap" data-en="Generated locally. The checker did not upload or modify source notes. Reports can contain bounded evidence excerpts; review them before external storage or sharing." data-zh-cn="报告在本地生成；检查器没有上传或修改源笔记。报告可能包含有限证据摘录，外部存储或分享前请先复核。">Generated locally. The checker did not upload or modify source notes. Reports can contain bounded evidence excerpts; review them before external storage or sharing.</footer><div class="toast" role="status" aria-live="polite"></div>
<script>
const languageButtons=[...document.querySelectorAll('[data-language]')],translatable=[...document.querySelectorAll('[data-en][data-zh-cn]')],toast=document.querySelector('.toast');let language='en';
function setLanguage(next){language=next;document.documentElement.lang=next;for(const element of translatable)element.textContent=next==='zh-CN'?element.dataset.zhCn:element.dataset.en;for(const button of languageButtons)button.setAttribute('aria-pressed',String(button.dataset.language===next));}
function notify(en,zh){toast.textContent=language==='zh-CN'?zh:en;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),1600)}
async function copy(button){const task=language==='zh-CN'?button.dataset.taskZhCn:button.dataset.taskEn;try{await navigator.clipboard.writeText(task);notify('Repair task copied.','修复任务已复制。')}catch(_){notify('Copy was blocked.','浏览器阻止了复制。')}}
function setFilter(filter){for(const item of document.querySelectorAll('.finding'))item.hidden=filter!=='all'&&item.dataset.level!==filter;for(const item of document.querySelectorAll('[data-filter]'))item.setAttribute('aria-pressed',String(item.dataset.filter===filter));}
for(const button of languageButtons)button.addEventListener('click',()=>setLanguage(button.dataset.language));for(const button of document.querySelectorAll('.copy-task,#copy-all'))button.addEventListener('click',()=>copy(button));
for(const button of document.querySelectorAll('[data-filter]'))button.addEventListener('click',()=>setFilter(button.dataset.filter));
setLanguage((navigator.language||'').toLowerCase().startsWith('zh')?'zh-CN':'en');
setFilter('${summary.counts.error ? "error" : summary.counts.warning ? "warning" : "all"}');
</script></body></html>`;
}

function markdownReport(reports, packageFindings, language) {
  const zh = language === "zh-CN";
  const lines = [zh ? "# RealityCheck HTML 笔记修复计划" : "# RealityCheck HTML note repair plan", ""];
  if (packageFindings.length) {
    lines.push(zh ? "## 文件包依赖" : "## File package dependencies", "");
    for (const finding of packageFindings) {
      lines.push(`- **[${finding.id}] ${localized(finding.title, language)}** (${finding.level}, ${finding.affectedCount})`);
      lines.push(`  - ${localized(finding.summary, language)}`);
      lines.push(`  - ${zh ? "修改" : "Fix"}: ${localized(finding.remediation, language)}`);
      for (const item of finding.evidence.slice(0, 3)) lines.push(`  - \`${item.path}:${item.line}\` — ${item.excerpt.replace(/\s+/g, " ")}`);
    }
    lines.push("");
  }
  for (const report of reports) {
    lines.push(`## ${report.path} — ${report.score}/100`, "");
    if (!report.findings.length) lines.push(zh ? "没有发现问题。" : "No findings.", "");
    for (const finding of report.findings) {
      lines.push(`- **[${finding.id}] ${localized(finding.title, language)}** (${finding.level}, ${finding.affectedCount})`);
      lines.push(`  - ${localized(finding.summary, language)}`);
      lines.push(`  - ${zh ? "修改" : "Fix"}: ${localized(finding.remediation, language)}`);
      for (const item of finding.evidence.slice(0, 3)) lines.push(`  - \`${item.path}:${item.line}\` — ${item.excerpt.replace(/\s+/g, " ")}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function thresholdFailed(counts, failOn) {
  if (failOn === "never") return false;
  if (failOn === "error") return counts.error > 0;
  return counts.error + counts.warning > 0;
}

function loadComparisonBaseline(path) {
  const baselinePath = resolve(path);
  if (!existsSync(baselinePath)) throw new Error(`Baseline does not exist: ${path}`);
  const stat = lstatSync(baselinePath);
  if (!stat.isFile()) throw new Error("Baseline must be a regular JSON file, not a directory or symbolic link");
  if (stat.size > MAX_BASELINE_BYTES) throw new Error("Baseline is larger than the 64 MiB safety limit");
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch (error) {
    throw new Error(`Baseline is not valid JSON: ${error.message}`);
  }
  return prepareNoteBaselineForComparison(parsed);
}

export async function runNoteCommand(argv) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  const input = resolve(options.input);
  if (!existsSync(input)) throw new Error(`Input does not exist: ${options.input}`);
  const inputStat = lstatSync(input);
  if (inputStat.isSymbolicLink()) throw new Error("The note input must not be a symbolic link");
  if (!inputStat.isFile() && !inputStat.isDirectory()) throw new Error("The note input must be a regular file or directory");
  if (inputStat.isFile() && !HTML_EXTENSIONS.has(extname(input).toLowerCase())) throw new Error("The note input file must end in .html or .htm");
  const baseline = options.baseline ? loadComparisonBaseline(options.baseline) : null;

  const root = inputStat.isDirectory() ? input : dirname(input);
  const discovered = discover(root, { htmlLimit: options.maxFiles });
  if (options.prepareRepair && inputStat.isDirectory() && discovered.truncated) {
    throw new Error("Refused to prepare an incomplete repair copy; reduce the folder or raise --max-files within its safe limit");
  }
  const repairFilesToCopy = options.prepareRepair ? (inputStat.isFile() ? [input] : discovered.allFiles) : [];
  const repairCopyBytes = repairFilesToCopy.reduce((sum, path) => sum + lstatSync(path).size, 0);
  if (repairCopyBytes > MAX_REPAIR_COPY_BYTES) {
    throw new Error("Refused to prepare a repair copy larger than 512 MiB");
  }
  const htmlFiles = inputStat.isFile() ? [input] : discovered.htmlFiles;
  if (!htmlFiles.length) throw new Error("No .html or .htm notes were found");
  const knownFiles = discovered.truncated ? null : discovered.allFiles.map((path) => portablePath(relative(root, path)));
  let reports = htmlFiles.map((path) => analyzeHtmlNote({
    path: portablePath(relative(root, path)) || basename(path),
    html: readFileSync(path, "utf8"),
    knownFiles,
  }));
  let packageFindings = [];
  if (knownFiles) {
    const packageEntries = [
      ...htmlFiles.map((path) => ({ path: portablePath(relative(root, path)) || basename(path), text: readFileSync(path, "utf8"), kind: "html" })),
      ...discovered.allFiles.filter((path) => extname(path).toLowerCase() === ".css").map((path) => ({ path: portablePath(relative(root, path)), text: lstatSync(path).size <= 5 * 1024 * 1024 ? readFileSync(path, "utf8") : null, kind: "css" })),
    ];
    packageFindings = analyzeNotePackage({ entries: packageEntries, knownFiles })
      .sort((left, right) => LEVEL_ORDER[left.level] - LEVEL_ORDER[right.level] || left.ruleId.localeCompare(right.ruleId));
  }
  reports.sort((left, right) => LEVEL_ORDER[left.findings[0]?.level ?? "advice"] - LEVEL_ORDER[right.findings[0]?.level ?? "advice"] || left.path.localeCompare(right.path));
  const packageSummary = summarizePackageFindings(packageFindings);
  const summary = summarizeNoteReports(reports, packageSummary);
  const { counts } = summary;
  const fingerprint = createHash("sha256").update(`${input}\0${reports.map((report) => report.path).join("\0")}`).digest("hex").slice(0, 8);
  const outputRoot = resolve(options.output);
  const { runId, runDirectory } = createNoteRunDirectory(outputRoot, fingerprint);
  const bundle = {
    schemaVersion: "1",
    kind: "html-note-check-bundle",
    id: runId,
    generatedAt: new Date().toISOString(),
    input: { name: basename(input), kind: inputStat.isDirectory() ? "directory" : "file" },
    discovery: { htmlFiles: reports.length, knownFiles: knownFiles?.length ?? null, truncated: discovered.truncated },
    summary,
    reports,
    packageFindings,
    packageSummary,
    sourceModified: false,
    privacy: { uploaded: false, absolutePathsPersisted: false },
  };
  if (baseline) {
    let comparison = compareNoteBundles(baseline.bundle, bundle);
    if (baseline.packageScopeUnverified) comparison = markLegacyPackageScopeUnverified(comparison);
    const regressionsByLevel = noteComparisonRegressionCounts(comparison);
    comparison = {
      ...comparison,
      warnings: baseline.warnings,
      regressionsByLevel,
      gate: {
        mode: "baseline-regressions-only",
        failOn: options.failOn,
        failed: noteComparisonGateFailed(comparison, options.failOn),
        states: ["new", "worsened", "unverified"],
      },
    };
    bundle.comparison = comparison;
  }
  const reportJson = `${JSON.stringify(bundle, null, 2)}\n`;
  const reportHtml = renderHtml(bundle);
  const comparisonJson = bundle.comparison ? `${JSON.stringify(bundle.comparison, null, 2)}\n` : null;
  const comparisonHtml = bundle.comparison ? renderNoteComparisonHtml(bundle.comparison) : null;
  const repairPlanEn = markdownReport(reports, packageFindings, "en");
  const repairPlanZh = markdownReport(reports, packageFindings, "zh-CN");
  writeFileSync(join(runDirectory, "report.json"), reportJson, "utf8");
  writeFileSync(join(runDirectory, "report.html"), reportHtml, "utf8");
  writeFileSync(join(runDirectory, "repair-plan.md"), repairPlanEn, "utf8");
  writeFileSync(join(runDirectory, "repair-plan.zh-CN.md"), repairPlanZh, "utf8");
  if (comparisonJson) {
    writeFileSync(join(runDirectory, "comparison.json"), comparisonJson, "utf8");
    writeFileSync(join(runDirectory, "comparison.html"), comparisonHtml, "utf8");
  }
  // Keep every relative download in the stable latest HTML functional. The
  // aliases are published as one serialized generation; immutable timestamped
  // runs remain the evidence source of record.
  publishStableNoteArtifacts(outputRoot, {
    reportJson,
    reportHtml,
    repairPlanEn,
    repairPlanZh,
    comparisonJson,
    comparisonHtml,
  });
  let preparedRepair = null;
  if (options.prepareRepair) {
    const repairRoot = resolve(runDirectory, "repaired");
    let safeFixes = 0;
    for (const path of repairFilesToCopy) {
      const relativePath = portablePath(relative(root, path)) || basename(path);
      const target = resolve(repairRoot, relativePath);
      if (!target.startsWith(`${repairRoot}${sep}`)) throw new Error("Refused repaired output outside the run directory");
      mkdirSync(dirname(target), { recursive: true });
      if (HTML_EXTENSIONS.has(extname(path).toLowerCase())) {
        const repaired = applySafeNoteFixes(readFileSync(path, "utf8"));
        safeFixes += repaired.changes.length;
        writeFileSync(target, repaired.html, "utf8");
      } else {
        copyFileSync(path, target);
      }
    }
    preparedRepair = { root: repairRoot, files: repairFilesToCopy.length, bytes: repairCopyBytes, safeFixes };
  } else if (options.fixSafe) {
    for (const path of htmlFiles) {
      const repaired = applySafeNoteFixes(readFileSync(path, "utf8"));
      if (!repaired.changes.length) continue;
      const relativePath = portablePath(relative(root, path)) || basename(path);
      const target = resolve(runDirectory, "repaired", relativePath);
      const repairedRoot = resolve(runDirectory, "repaired") + sep;
      if (!target.startsWith(repairedRoot)) throw new Error("Refused repaired output outside the run directory");
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, repaired.html, "utf8");
    }
  }
  const zh = options.language === "zh-CN";
  console.log(zh
    ? `已检查 ${summary.files} 个 HTML 笔记：${summary.score}/100，${counts.error} 个错误，${counts.warning} 个警告。`
    : `Checked ${summary.files} HTML note(s): ${summary.score}/100, ${counts.error} error(s), ${counts.warning} warning(s).`);
  console.log(zh ? `可视报告：${join(runDirectory, "report.html")}` : `Visual report: ${join(runDirectory, "report.html")}`);
  if (bundle.comparison) {
    const comparison = bundle.comparison;
    console.log(zh
      ? `基线差异：新增 ${comparison.counts.new}，已解决 ${comparison.counts.resolved}，恶化 ${comparison.counts.worsened}，仍存在 ${comparison.counts.persistent}，未核验 ${comparison.counts.unverified}。`
      : `Baseline comparison: ${comparison.counts.new} new, ${comparison.counts.resolved} resolved, ${comparison.counts.worsened} worsened, ${comparison.counts.persistent} persistent, ${comparison.counts.unverified} unverified.`);
    console.log(zh ? `差异报告：${join(runDirectory, "comparison.html")}` : `Comparison report: ${join(runDirectory, "comparison.html")}`);
    for (const warning of comparison.warnings || []) console.log(zh ? warning.message.zhCN : warning.message.en);
  }
  if (preparedRepair) {
    console.log(zh
      ? `Codex 修复工作副本：${preparedRepair.root}（共 ${preparedRepair.files} 个文件，已应用 ${preparedRepair.safeFixes} 项安全修复）`
      : `Codex repair working copy: ${preparedRepair.root} (${preparedRepair.files} file(s), ${preparedRepair.safeFixes} safe fix(es) applied)`);
  }
  console.log(zh ? "检查器未修改或上传源笔记；报告可能包含有限证据摘录。" : "The checker did not modify or upload source notes; reports may contain bounded evidence excerpts.");
  return bundle.comparison
    ? (bundle.comparison.gate.failed ? 1 : 0)
    : (thresholdFailed(counts, options.failOn) ? 1 : 0);
}

const direct = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (direct) {
  const directArguments = process.argv.slice(2);
  if (directArguments[0] === "note") directArguments.shift();
  runNoteCommand(directArguments).then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(`RealityCheck Note error: ${error.message}`);
    process.exitCode = 2;
  });
}

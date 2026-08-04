import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { validateArtifactFiles } from "./artifact-validator.mjs";
import { TOOL_VERSION } from "./version.mjs";

export const RELEASE_CONTROL_KEYS = Object.freeze(["audit", "verification", "policy", "trust", "risk", "issues"]);
const CONTROL_FILES = new Map([
  ["report.json", "audit"],
  ["site-report.json", "audit"],
  ["verification.json", "verification"],
  ["site-verification.json", "verification"],
  ["policy-review.json", "policy"],
  ["evidence-trust-report.json", "trust"],
  ["risk-register.json", "risk"],
  ["github-issue-drafts.json", "issues"],
]);
const EXPECTED_KIND_BY_FILE = new Map([
  ["report.json", "report"],
  ["site-report.json", "site-audit"],
  ["verification.json", "verification"],
  ["site-verification.json", "site-verification"],
  ["policy-review.json", "policy-review"],
  ["evidence-trust-report.json", "evidence-trust-report"],
  ["risk-register.json", "risk-register"],
  ["github-issue-drafts.json", "github-issue-drafts"],
]);
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "__pycache__"]);
const LABELS = {
  audit: ["Quality gate", "质量门禁"],
  verification: ["Fix verification", "修复验证"],
  policy: ["Policy change guard", "策略变更守卫"],
  trust: ["Evidence trust", "证据可信度"],
  risk: ["Longitudinal risk", "长期风险"],
  issues: ["Repair review queue", "修复复核队列"],
};
const STATE_LABELS = {
  pass: ["PASS", "通过"],
  review: ["REVIEW", "待复核"],
  fail: ["FAIL", "失败"],
  missing: ["MISSING", "缺失"],
  stale: ["STALE", "已过期"],
};

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

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function loadJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path}: invalid JSON (${error.message})`);
  }
}

function portablePath(fromDirectory, target) {
  const value = relative(fromDirectory, target).split(sep).join("/");
  if (/^[A-Za-z]:/.test(value) || value.startsWith("/")) throw new Error("release-decision source and output must share a filesystem volume so evidence links stay portable");
  return value || basename(target);
}

function collectControlFiles(inputPaths, outputDirectory) {
  if (!inputPaths.length) throw new Error("release-decision requires at least one artifact file or directory");
  const found = new Set();
  const output = resolve(outputDirectory);
  const visit = (candidate, explicit = false) => {
    const path = resolve(candidate);
    if (!existsSync(path)) throw new Error(`${path}: release-decision source does not exist`);
    const stats = statSync(path);
    if (stats.isFile()) {
      if (!CONTROL_FILES.has(basename(path))) {
        if (explicit) throw new Error(`${path}: unsupported release control artifact`);
        return;
      }
      if (dirname(path) !== output) found.add(path);
      return;
    }
    if (!stats.isDirectory()) throw new Error(`${path}: expected an artifact file or directory`);
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name) && resolve(child) !== output) visit(child);
      else if (entry.isFile() && CONTROL_FILES.has(entry.name)) found.add(resolve(child));
    }
  };
  for (const inputPath of inputPaths) visit(inputPath, true);
  if (!found.size) throw new Error("no supported RealityCheck release control artifacts were found");
  return [...found].sort();
}

function artifactObservedAt(key, value) {
  if (key === "audit") return value.kind === "site-audit" ? value.finishedAt : value.run.finishedAt;
  if (key === "verification") return value.after.finishedAt || value.after.startedAt;
  return value.generatedAt;
}

function artifactRunId(key, value) {
  if (key === "audit") return value.kind === "site-audit" ? value.id : value.run.id;
  if (key === "verification") return value.after.id || value.after.runId;
  if (key === "trust") return value.manifest.runId;
  return null;
}

function reason(code, outcome, message, messageZh) {
  return { code, outcome, message, messageZh };
}

function fact(key, value, label, labelZh) {
  return { key, value, label, labelZh };
}

function evaluateArtifact(key, value) {
  if (key === "audit") {
    const site = value.kind === "site-audit";
    const failed = site ? value.summary.gateFailed : value.threshold.met;
    const facts = site
      ? [fact("averageScore", value.summary.averageScore, "Average score", "平均分"), fact("minimumScore", value.summary.minimumScore, "Minimum score", "最低分"), fact("pagesFailed", value.summary.pagesFailed, "Pages failed", "失败页面")]
      : [fact("score", value.score.overall, "Score", "评分"), fact("findings", value.score.totalFindings, "Findings", "问题数"), fact("coveragePercent", value.threshold.coveragePercent ?? 0, "Coverage %", "覆盖率 %")];
    return {
      state: failed ? "fail" : "pass",
      facts,
      reasons: failed ? [reason("quality-gate-failed", "fail", "The selected audit did not satisfy its own configured release gate.", "所选核查未满足其自身配置的发布门禁。")]
        : [],
    };
  }
  if (key === "verification") {
    const failed = Boolean(value.threshold.met);
    const unverified = value.counts?.unverified || 0;
    const facts = [fact("scoreDelta", value.scoreDelta, "Score change", "评分变化"), fact("resolved", value.counts.resolved, "Resolved", "已解决"), fact("new", value.counts.new, "New", "新增"), fact("unverified", unverified, "Unverified", "未验证")];
    const reasons = [];
    if (failed) reasons.push(reason("verification-gate-failed", "fail", "The before/after verification still violates its configured gate.", "前后对比验证仍违反其配置门禁。"));
    else if (unverified > 0) reasons.push(reason("unverified-fixes", "review", `${unverified} finding(s) could not be proved resolved.`, `${unverified} 个问题无法证明已经解决。`));
    return { state: failed ? "fail" : unverified ? "review" : "pass", facts, reasons };
  }
  if (key === "policy") {
    const { weakened, strengthened, review, gateFailed } = value.summary;
    const facts = [fact("weakened", weakened, "Weakened", "弱化"), fact("strengthened", strengthened, "Strengthened", "加强"), fact("review", review, "Needs review", "待复核")];
    const reasons = [];
    if (gateFailed || weakened > 0) reasons.push(reason("policy-weakened", "fail", `${weakened} structural policy weakening change(s) were detected.`, `检测到 ${weakened} 项结构化策略弱化。`));
    else if (review > 0) reasons.push(reason("policy-review-required", "review", `${review} policy change(s) require human review.`, `${review} 项策略变更需要人工复核。`));
    return { state: gateFailed || weakened ? "fail" : review ? "review" : "pass", facts, reasons };
  }
  if (key === "trust") {
    const passed = Object.values(value.checks).filter(Boolean).length;
    const facts = [fact("checksPassed", passed, "Trust checks passed", "可信检查通过"), fact("activeKeys", value.policy.activeKeys, "Active signer keys", "有效签名密钥")];
    return {
      state: value.state === "trusted" ? "pass" : "fail",
      facts,
      reasons: value.state === "trusted" ? [] : [reason("evidence-rejected", "fail", "Integrity, signature, or signer authorization rejected the evidence.", "证据的完整性、签名或签名者授权未通过。")],
    };
  }
  if (key === "risk") {
    const { open, recurring, overdue, waived, unverified } = value.summary;
    const facts = [fact("open", open, "Open", "未关闭"), fact("recurring", recurring, "Recurring", "重复出现"), fact("overdue", overdue, "Overdue", "逾期"), fact("waived", waived, "Waived", "已豁免"), fact("unverified", unverified, "Unverified", "未验证")];
    const reasons = [];
    if (value.policy.gateFailed) reasons.push(reason("risk-policy-failed", "fail", `${value.policy.violations.length} longitudinal risk policy limit(s) were exceeded.`, `${value.policy.violations.length} 项长期风险策略限制被突破。`));
    else if (unverified > 0) reasons.push(reason("risk-unverified", "review", `${unverified} risk state(s) are unverified.`, `${unverified} 个风险状态尚未验证。`));
    return { state: value.policy.gateFailed ? "fail" : unverified ? "review" : "pass", facts, reasons };
  }
  const { drafts, actionable, review, waived, duplicates } = value.summary;
  const facts = [fact("drafts", drafts, "Drafts", "草稿"), fact("actionable", actionable, "Actionable", "可执行"), fact("review", review, "Needs review", "待复核"), fact("waived", waived, "Waived", "已豁免"), fact("duplicates", duplicates, "Duplicates merged", "已合并重复项")];
  return {
    state: review > 0 ? "review" : "pass",
    facts,
    reasons: review > 0 ? [reason("repair-review-required", "review", `${review} repair draft(s) need an owner or evidence decision.`, `${review} 份修复草稿需要负责人或证据判断。`)] : [],
  };
}

function decisionFromControls(controls) {
  if (controls.some((item) => item.state === "fail" || (item.required && ["missing", "stale"].includes(item.state)))) return "no-go";
  if (controls.some((item) => item.state === "review" || item.state === "stale")) return "review";
  return "go";
}

export function parseRequiredControls(value = "audit") {
  const items = Array.isArray(value) ? value : String(value).split(",");
  const controls = [...new Set(items.flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter(Boolean))];
  if (!controls.length) throw new Error("--require must name at least one release control");
  for (const control of controls) {
    if (!RELEASE_CONTROL_KEYS.includes(control)) throw new Error(`unknown release control ${control}; expected ${RELEASE_CONTROL_KEYS.join(", ")}`);
  }
  return controls.sort((left, right) => RELEASE_CONTROL_KEYS.indexOf(left) - RELEASE_CONTROL_KEYS.indexOf(right));
}

export function buildReleaseDecision(inputPaths, outputDirectory, { now = new Date(), maxAgeHours = 24, requiredControls = ["audit"] } = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error("release-decision now must be a valid Date");
  if (!Number.isInteger(maxAgeHours) || maxAgeHours < 1 || maxAgeHours > 8760) throw new Error("--max-age-hours must be an integer from 1 to 8760");
  const required = parseRequiredControls(requiredControls);
  const paths = collectControlFiles(inputPaths, outputDirectory);
  const validation = validateArtifactFiles(paths);
  const invalid = validation.filter((item) => !item.valid);
  if (invalid.length) throw new Error(`release-decision refuses invalid evidence: ${invalid.map((item) => `${basename(item.path)} (${item.errors.join("; ")})`).join(", ")}`);
  const mismatched = validation.filter((item) => item.kind !== EXPECTED_KIND_BY_FILE.get(basename(item.path)));
  if (mismatched.length) throw new Error(`release-decision refuses mislabeled evidence: ${mismatched.map((item) => `${basename(item.path)} contains ${item.kind}`).join(", ")}`);

  const candidates = new Map(RELEASE_CONTROL_KEYS.map((key) => [key, []]));
  for (const path of paths) {
    const key = CONTROL_FILES.get(basename(path));
    const value = loadJson(path);
    const observedAt = artifactObservedAt(key, value);
    candidates.get(key).push({ path, value, observedAt, timestamp: Date.parse(observedAt) });
  }
  for (const values of candidates.values()) values.sort((left, right) => right.timestamp - left.timestamp || left.path.localeCompare(right.path));

  const output = resolve(outputDirectory);
  const keys = RELEASE_CONTROL_KEYS.filter((key) => required.includes(key) || candidates.get(key).length);
  const controls = keys.map((key) => {
    const options = candidates.get(key);
    const isRequired = required.includes(key);
    if (!options.length) {
      return {
        key,
        label: LABELS[key][0],
        labelZh: LABELS[key][1],
        required: true,
        state: "missing",
        observedAt: null,
        ageHours: null,
        candidates: 0,
        facts: [],
        reasons: [reason("required-control-missing", "fail", `Required ${LABELS[key][0].toLowerCase()} evidence was not found.`, `未找到必需的${LABELS[key][1]}证据。`)],
      };
    }
    const selected = options[0];
    const evaluated = evaluateArtifact(key, selected.value);
    const rawAgeHours = (now.getTime() - selected.timestamp) / 3_600_000;
    const ageHours = Math.round(Math.max(0, rawAgeHours) * 100) / 100;
    let state = evaluated.state;
    const reasons = [...evaluated.reasons];
    if (rawAgeHours > maxAgeHours && state !== "fail") {
      state = "stale";
      reasons.push(reason("evidence-stale", isRequired ? "fail" : "review", `Evidence is ${ageHours} hours old; the limit is ${maxAgeHours}.`, `证据已有 ${ageHours} 小时；上限为 ${maxAgeHours} 小时。`));
    } else if (rawAgeHours < -5 / 60 && state === "pass") {
      state = "review";
      reasons.push(reason("clock-skew", "review", "The artifact timestamp is more than five minutes in the future.", "产物时间戳比当前时间超前五分钟以上。"));
    }
    const digest = sha256(readFileSync(selected.path));
    return {
      key,
      label: LABELS[key][0],
      labelZh: LABELS[key][1],
      required: isRequired,
      state,
      observedAt: selected.observedAt,
      ageHours,
      candidates: options.length,
      artifact: {
        kind: validation.find((item) => item.path === selected.path)?.kind || key,
        path: portablePath(output, selected.path),
        sha256: digest,
        ...(artifactRunId(key, selected.value) ? { runFingerprint: sha256(Buffer.from(artifactRunId(key, selected.value), "utf8")) } : {}),
      },
      facts: evaluated.facts,
      reasons,
    };
  });

  const decision = decisionFromControls(controls);
  const summary = {
    controls: controls.length,
    required: controls.filter((item) => item.required).length,
    passed: controls.filter((item) => item.state === "pass").length,
    review: controls.filter((item) => item.state === "review").length,
    failed: controls.filter((item) => item.state === "fail").length,
    missing: controls.filter((item) => item.state === "missing").length,
    stale: controls.filter((item) => item.state === "stale").length,
    decision,
  };
  const stableIdentity = {
    policy: { maxAgeHours, requiredControls: required },
    controls: controls.map((item) => ({ key: item.key, required: item.required, state: item.state, sha256: item.artifact?.sha256 || null })),
  };
  const id = `RELEASE-${createHash("sha256").update(JSON.stringify(canonical(stableIdentity))).digest("hex").slice(0, 12).toUpperCase()}`;
  return {
    schemaVersion: "1",
    toolVersion: TOOL_VERSION,
    kind: "release-decision",
    id,
    generatedAt: now.toISOString(),
    decision,
    policy: { maxAgeHours, requiredControls: required },
    summary,
    controls,
    warnings: [
      "This decision summarizes selected RealityCheck artifacts; it does not deploy, approve, or prove the absence of defects.",
      "该决策仅汇总所选 RealityCheck 产物；它不会部署、批准发布，也不能证明不存在缺陷。",
      "Directory discovery selects the newest valid artifact per control. Use explicit files when release scope must be exact.",
      "目录发现会为每项控制选择最新有效产物；发布范围必须精确时请传入明确文件。",
    ],
  };
}

export function releaseDecisionExitCode(decision) {
  if (decision === "go") return 0;
  if (decision === "no-go") return 1;
  return 3;
}

export function renderReleaseDecisionMarkdown(bundle, language = "en") {
  const zh = language === "zh-CN";
  const decision = zh ? { go: "可发布", review: "待复核", "no-go": "不可发布" }[bundle.decision] : bundle.decision.toUpperCase();
  const lines = [
    `# ${zh ? "RealityCheck 发布决策" : "RealityCheck release decision"}`,
    "",
    `${zh ? "结论" : "Decision"}: **${decision}** · \`${bundle.id}\``,
    "",
    `- ${zh ? "生成时间" : "Generated"}: ${bundle.generatedAt}`,
    `- ${zh ? "证据时效上限" : "Evidence age limit"}: ${bundle.policy.maxAgeHours} ${zh ? "小时" : "hours"}`,
    `- ${zh ? "必需控制" : "Required controls"}: ${bundle.policy.requiredControls.map((item) => `\`${item}\``).join(", ")}`,
    "",
    `## ${zh ? "控制结论" : "Control decisions"}`,
    "",
    `| ${zh ? "控制" : "Control"} | ${zh ? "要求" : "Required"} | ${zh ? "状态" : "State"} | ${zh ? "时间" : "Age"} | ${zh ? "说明" : "Reason"} |`,
    "| --- | --- | --- | --- | --- |",
    ...bundle.controls.map((item) => {
      const message = item.reasons.map((entry) => zh ? entry.messageZh : entry.message).join(" ") || (zh ? "未发现阻断原因。" : "No blocking reason recorded.");
      return `| ${markdown(zh ? item.labelZh : item.label)} | ${item.required ? (zh ? "是" : "yes") : (zh ? "否" : "no")} | **${markdown(zh ? STATE_LABELS[item.state][1] : STATE_LABELS[item.state][0])}** | ${item.ageHours === null ? "—" : `${item.ageHours}h`} | ${markdown(message)} |`;
    }),
    "",
    `> ${zh ? bundle.warnings[1] : bundle.warnings[0]}`,
    "",
  ];
  return lines.join("\n");
}

export function renderReleaseDecisionHtml(bundle) {
  const decisions = { go: ["GO", "可发布"], review: ["REVIEW", "待复核"], "no-go": ["NO-GO", "不可发布"] };
  const cards = bundle.controls.map((item) => {
    const facts = item.facts.map((entry) => `<div><dt data-en="${html(entry.label)}" data-zh-cn="${html(entry.labelZh)}">${html(entry.label)}</dt><dd>${html(entry.value)}</dd></div>`).join("");
    const reasons = item.reasons.length ? item.reasons.map((entry) => `<li data-en="${html(entry.message)}" data-zh-cn="${html(entry.messageZh)}">${html(entry.message)}</li>`).join("") : `<li data-en="No blocking reason recorded." data-zh-cn="未记录阻断原因。">No blocking reason recorded.</li>`;
    const source = item.artifact ? `<a href="${html(item.artifact.path)}" data-en="Open selected evidence" data-zh-cn="打开所选证据">Open selected evidence</a><code>${html(item.artifact.sha256)}</code>` : `<span data-en="No artifact selected" data-zh-cn="未选择产物">No artifact selected</span>`;
    return `<article class="control ${item.state}" data-state="${item.state}" data-search="${html(`${item.key} ${item.label} ${item.labelZh} ${item.reasons.map((entry) => `${entry.message} ${entry.messageZh}`).join(" ")}`.toLowerCase())}"><div class="control-head"><div><span class="pill" data-en="${STATE_LABELS[item.state][0]}" data-zh-cn="${STATE_LABELS[item.state][1]}">${STATE_LABELS[item.state][0]}</span>${item.required ? `<span class="required" data-en="REQUIRED" data-zh-cn="必需">REQUIRED</span>` : ""}</div><code>${html(item.key)}</code></div><h2 data-en="${html(item.label)}" data-zh-cn="${html(item.labelZh)}">${html(item.label)}</h2><dl>${facts}</dl><ul>${reasons}</ul><footer>${source}<span>${item.ageHours === null ? "—" : `${item.ageHours}h`} · ${item.candidates} candidate(s)</span></footer></article>`;
  }).join("");
  const copyEn = `RealityCheck ${decisions[bundle.decision][0]} · ${bundle.id} · ${bundle.summary.passed} passed · ${bundle.summary.review} review · ${bundle.summary.failed} failed · ${bundle.summary.missing} missing · ${bundle.summary.stale} stale`;
  const copyZh = `RealityCheck ${decisions[bundle.decision][1]} · ${bundle.id} · ${bundle.summary.passed} 通过 · ${bundle.summary.review} 待复核 · ${bundle.summary.failed} 失败 · ${bundle.summary.missing} 缺失 · ${bundle.summary.stale} 过期`;
  const payload = JSON.stringify({
    en: { title: "Release decision", decision: decisions[bundle.decision][0], search: "Search controls", shown: "shown", copy: "Copy decision", copied: "Copied", summary: copyEn },
    "zh-CN": { title: "发布决策", decision: decisions[bundle.decision][1], search: "搜索控制项", shown: "项显示", copy: "复制决策", copied: "已复制", summary: copyZh },
  }).replaceAll("<", "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';script-src 'unsafe-inline';base-uri 'none';form-action 'none';connect-src 'none';img-src 'none'"><title>RealityCheck release decision</title><style>:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#17191e;background:#f1efe9}*{box-sizing:border-box}body{margin:0}header,main,.page-footer{width:min(1080px,calc(100% - 32px));margin:auto}.topbar{display:flex;justify-content:space-between;align-items:center;padding:20px 0;border-bottom:1px solid #d8d3ca}.brand{font-weight:900;letter-spacing:-.02em}.languages,.filters{display:flex;gap:6px;flex-wrap:wrap}button{min-height:38px;padding:0 12px;border:1px solid #d5d0c6;border-radius:8px;background:#fff;cursor:pointer}button[aria-pressed=true]{color:#fff;background:#202229}.hero{padding:62px 0 26px}.eyebrow{color:#a23828;font-size:11px;font-weight:900;letter-spacing:.14em}h1{margin:8px 0;font-size:clamp(45px,8vw,78px);line-height:.94;letter-spacing:-.06em}.decision{display:inline-block;margin-top:14px;padding:9px 13px;border-radius:7px;color:#fff;background:${bundle.decision === "go" ? "#147257" : bundle.decision === "review" ? "#a96900" : "#b32740"};font-weight:900}.summary{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin:28px 0}.summary article{padding:15px;border:1px solid #ddd8cf;border-radius:11px;background:#fff}.summary strong{display:block;font-size:28px}.summary span{color:#6b6e76;font-size:11px}.policy{color:#5f626a;font-size:13px}.toolbar{display:flex;align-items:center;gap:12px;margin:28px 0}.filters{flex:1}.toolbar input{min-height:42px;min-width:220px;padding:0 12px;border:1px solid #d5d0c6;border-radius:8px}.shown{min-width:74px;color:#6b6e76;font-size:11px}.control{margin:12px 0;padding:23px;border:1px solid #ddd8cf;border-left:6px solid #147257;border-radius:12px;background:#fff}.control.review,.control.stale{border-left-color:#a96900}.control.fail,.control.missing{border-left-color:#b32740}.control-head{display:flex;justify-content:space-between}.pill,.required{display:inline-block;margin-right:6px;padding:4px 7px;border-radius:5px;background:#eceae4;font-size:10px;font-weight:900}.required{color:#fff;background:#34363d}.control h2{margin:18px 0 12px}.control dl{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin:0}.control dl div{padding:10px;background:#f6f4ef}.control dt{color:#6b6e76;font-size:10px}.control dd{margin:5px 0 0;font-weight:800}.control ul{padding-left:20px;color:#53565e;line-height:1.55}.control footer{display:flex;justify-content:space-between;gap:12px;align-items:end;margin-top:18px;padding-top:14px;border-top:1px solid #e4e0d8}.control footer a,.control footer span,.control footer code{display:block;font-size:11px}.control footer code{margin-top:5px;color:#777;overflow-wrap:anywhere}.copy-row{display:flex;gap:12px;align-items:center;margin:28px 0}.copy-row .status{color:#147257;font-size:12px}.notice{padding:18px;border-radius:10px;color:#fff;background:#25272d}.page-footer{padding:40px 0;color:#6b6e76}@media(max-width:760px){.summary{grid-template-columns:repeat(3,1fr)}.toolbar{align-items:stretch;flex-direction:column}.toolbar input{width:100%}.control dl{grid-template-columns:1fr 1fr}.control footer{align-items:start;flex-direction:column}}</style></head><body><header class="topbar"><div class="brand">RealityCheck / RELEASE</div><div class="languages" role="group" aria-label="Language" data-aria-en="Language" data-aria-zh-cn="语言"><button type="button" data-language="en" aria-pressed="true">EN</button><button type="button" data-language="zh-CN" aria-pressed="false">中文</button></div></header><main><section class="hero"><p class="eyebrow" data-en="CONSERVATIVE DELIVERY EVIDENCE" data-zh-cn="保守的交付证据">CONSERVATIVE DELIVERY EVIDENCE</p><h1 data-text="title">Release decision</h1><span class="decision" data-text="decision">${decisions[bundle.decision][0]}</span><div class="summary"><article><strong>${bundle.summary.passed}</strong><span data-en="passed" data-zh-cn="通过">passed</span></article><article><strong>${bundle.summary.review}</strong><span data-en="review" data-zh-cn="待复核">review</span></article><article><strong>${bundle.summary.failed}</strong><span data-en="failed" data-zh-cn="失败">failed</span></article><article><strong>${bundle.summary.missing}</strong><span data-en="missing" data-zh-cn="缺失">missing</span></article><article><strong>${bundle.summary.stale}</strong><span data-en="stale" data-zh-cn="过期">stale</span></article><article><strong>${bundle.summary.required}</strong><span data-en="required" data-zh-cn="必需">required</span></article></div><p class="policy"><code>${bundle.id}</code> · max age ${bundle.policy.maxAgeHours}h · required ${bundle.policy.requiredControls.map(html).join(", ")}</p></section><div class="toolbar"><div class="filters" role="group" aria-label="Control state" data-aria-en="Control state" data-aria-zh-cn="控制状态"><button type="button" data-filter="all" aria-pressed="true" data-en="All" data-zh-cn="全部">All</button>${["pass", "review", "fail", "missing", "stale"].map((state) => `<button type="button" data-filter="${state}" aria-pressed="false" data-en="${STATE_LABELS[state][0]}" data-zh-cn="${STATE_LABELS[state][1]}">${STATE_LABELS[state][0]}</button>`).join("")}</div><input type="search" data-search placeholder="Search controls" aria-label="Search controls" data-aria-en="Search controls" data-aria-zh-cn="搜索控制项"><span class="shown" role="status" aria-live="polite" data-shown></span></div><section data-controls>${cards}</section><div class="copy-row"><button type="button" data-copy data-text="copy">Copy decision</button><span class="status" role="status" aria-live="polite" data-copy-status></span></div><p class="notice" data-en="NO AUTOMATIC DEPLOYMENT · This artifact records a decision; it never deploys or approves a release." data-zh-cn="不会自动部署 · 此产物只记录决策，绝不会部署或批准发布。">NO AUTOMATIC DEPLOYMENT · This artifact records a decision; it never deploys or approves a release.</p></main><footer class="page-footer" data-en="RealityCheck · selected evidence, explicit gaps, human accountability." data-zh-cn="RealityCheck · 明确所选证据与缺口，由人承担最终责任。">RealityCheck · selected evidence, explicit gaps, human accountability.</footer><script>const i18n=${payload};let language=localStorage.getItem("realitycheck-release-language")||"en";let filter="all";const apply=()=>{document.documentElement.lang=language;document.querySelectorAll("[data-language]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.language===language)));document.querySelectorAll("[data-en]").forEach(e=>e.textContent=e.dataset[language==="zh-CN"?"zhCn":"en"]);document.querySelectorAll("[data-text]").forEach(e=>e.textContent=i18n[language][e.dataset.text]);document.querySelectorAll("[data-aria-en]").forEach(e=>e.setAttribute("aria-label",e.dataset[language==="zh-CN"?"ariaZhCn":"ariaEn"]));const query=document.querySelector("[data-search]").value.trim().toLowerCase();let shown=0;document.querySelectorAll(".control").forEach(e=>{e.hidden=(filter!=="all"&&e.dataset.state!==filter)||(query&&!e.dataset.search.includes(query));if(!e.hidden)shown+=1});document.querySelector("[data-shown]").textContent=shown+"/"+${bundle.controls.length}+" "+i18n[language].shown};document.querySelectorAll("[data-language]").forEach(b=>b.addEventListener("click",()=>{language=b.dataset.language;localStorage.setItem("realitycheck-release-language",language);document.querySelector("[data-copy-status]").textContent="";apply()}));document.querySelectorAll("[data-filter]").forEach(b=>b.addEventListener("click",()=>{filter=b.dataset.filter;document.querySelectorAll("[data-filter]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));apply()}));document.querySelector("[data-search]").addEventListener("input",apply);document.querySelector("[data-copy]").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(i18n[language].summary);document.querySelector("[data-copy-status]").textContent=i18n[language].copied}catch{document.querySelector("[data-copy-status]").textContent=""}});apply();</script></body></html>`;
}

export function writeReleaseDecision(bundle, outputDirectory) {
  const output = resolve(outputDirectory);
  mkdirSync(output, { recursive: true });
  const jsonPath = join(output, "release-decision.json");
  const markdownPath = join(output, "release-decision.md");
  const markdownZhPath = join(output, "release-decision.zh-CN.md");
  const htmlPath = join(output, "release-decision.html");
  writeFileSync(jsonPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, renderReleaseDecisionMarkdown(bundle, "en"), "utf8");
  writeFileSync(markdownZhPath, renderReleaseDecisionMarkdown(bundle, "zh-CN"), "utf8");
  writeFileSync(htmlPath, renderReleaseDecisionHtml(bundle), "utf8");
  return { jsonPath, markdownPath, markdownZhPath, htmlPath, bundle };
}

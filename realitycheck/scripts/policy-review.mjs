import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { DEFAULT_PROJECT_CONFIG, validateProjectConfig } from "./config.mjs";
import { TOOL_VERSION } from "./version.mjs";

const CLASSIFICATION_ORDER = { weakened: 0, review: 1, strengthened: 2 };
const FAIL_STRICTNESS = { never: 0, critical: 1, major: 2, minor: 3 };
const FINDING_SEVERITY = { info: 0, minor: 1, major: 2, critical: 3 };

function html(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function markdown(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\r", " ").replaceAll("\n", " ");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function fingerprint(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}

function loadConfig(path) {
  const absolute = resolve(path);
  let raw;
  try {
    raw = JSON.parse(readFileSync(absolute, "utf8"));
  } catch (error) {
    throw new Error(`${basename(absolute)} is not valid JSON: ${error.message}`);
  }
  return { path: absolute, value: validateProjectConfig(raw, basename(absolute)) };
}

function effective(config) {
  return {
    mode: config.mode ?? DEFAULT_PROJECT_CONFIG.mode,
    failOn: config.failOn ?? DEFAULT_PROJECT_CONFIG.failOn,
    viewports: config.viewports ?? structuredClone(DEFAULT_PROJECT_CONFIG.viewports),
    routes: config.routes ?? [],
    crawl: { ...DEFAULT_PROJECT_CONFIG.crawl, ...(config.crawl || {}) },
    checks: config.checks ?? [],
    journeys: config.journeys ?? [],
    budgets: config.budgets ?? null,
    network: config.network ?? null,
    links: config.links ?? null,
    metadata: config.metadata ?? null,
    visual: config.visual ? Object.fromEntries(Object.entries(config.visual).filter(([key]) => key !== "baselineDirectoryPath")) : null,
    security: config.security ?? null,
    privacy: config.privacy ?? null,
    waivers: config.waivers ?? [],
    qualityGate: config.qualityGate ?? null,
    baselinePolicy: config.baselinePolicy ?? null,
    owners: config.owners ?? [],
  };
}

function safeValue(value) {
  if (value === null || ["boolean", "number"].includes(typeof value)) return value;
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return text.slice(0, 120);
}

function safeFilename(path) {
  return basename(path).replace(/[\u0000-\u001f\u007f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 255) || "config.json";
}

function stableChangeId(change) {
  const digest = createHash("sha256").update(`${change.classification}\0${change.category}\0${change.key}`).digest("hex").slice(0, 10).toUpperCase();
  return `POLICY-${digest}`;
}

function changeCollector() {
  const changes = [];
  const add = ({ classification, category, key, title, titleZh, rationale, rationaleZh, before = null, after = null }) => {
    const change = {
      classification,
      category,
      key,
      title,
      titleZh,
      rationale,
      rationaleZh,
      before: safeValue(before),
      after: safeValue(after),
    };
    changes.push({ id: stableChangeId(change), ...change });
  };
  return { changes, add };
}

function compareNumber(add, { before, after, category, key, label, labelZh, higherIsStronger }) {
  if (before === after) return;
  if (before === null || before === undefined) {
    add({ classification: "strengthened", category, key, title: `${label} was added`, titleZh: `新增${labelZh}`, rationale: "A previously absent enforceable limit is now explicit.", rationaleZh: "原先缺失的可执行限制现在已显式加入。", before: "not configured", after });
    return;
  }
  if (after === null || after === undefined) {
    add({ classification: "weakened", category, key, title: `${label} was removed`, titleZh: `移除${labelZh}`, rationale: "Removing an enforceable limit reduces policy coverage.", rationaleZh: "移除可执行限制会降低策略覆盖。", before, after: "not configured" });
    return;
  }
  const stronger = higherIsStronger ? after > before : after < before;
  add({ classification: stronger ? "strengthened" : "weakened", category, key, title: `${label} changed from ${before} to ${after}`, titleZh: `${labelZh}从 ${before} 调整为 ${after}`, rationale: stronger ? "The new numeric limit is stricter." : "The new numeric limit allows more risk than before.", rationaleZh: stronger ? "新的数值限制更严格。" : "新的数值限制比以前允许更多风险。", before, after });
}

function compareBoolean(add, { before, after, category, key, label, labelZh, trueIsStronger = true }) {
  if (before === after) return;
  const stronger = after === trueIsStronger;
  add({ classification: stronger ? "strengthened" : "weakened", category, key, title: `${label} was ${after ? "enabled" : "disabled"}`, titleZh: `${labelZh}已${after ? "启用" : "停用"}`, rationale: stronger ? "The reviewed protection is now enforced." : "A previously enforced protection is no longer required.", rationaleZh: stronger ? "现在会执行这项已审核保护。" : "原先强制执行的保护现在不再要求。", before, after });
}

function compareSeverity(add, { before, after, category, key, label, labelZh, ranking }) {
  if (before === after) return;
  const strengthened = ranking[after] > ranking[before];
  add({ classification: strengthened ? "strengthened" : "weakened", category, key, title: `${label} changed from ${before} to ${after}`, titleZh: `${labelZh}从 ${before} 调整为 ${after}`, rationale: strengthened ? "The new severity setting is more likely to block risky evidence." : "The new severity setting is less likely to block risky evidence.", rationaleZh: strengthened ? "新的严重级别设置更容易阻止风险证据。" : "新的严重级别设置更不容易阻止风险证据。", before, after });
}

function comparePolicyPresence(add, before, after, category, label, labelZh) {
  if (!before && !after) return false;
  if (!before && after) {
    add({ classification: "strengthened", category, key: `${category}.policy`, title: `${label} policy was added`, titleZh: `新增${labelZh}策略`, rationale: "A new enforceable policy surface is covered.", rationaleZh: "新增了一类可执行策略覆盖。", before: "not configured", after: "configured" });
    return false;
  }
  if (before && !after) {
    add({ classification: "weakened", category, key: `${category}.policy`, title: `${label} policy was removed`, titleZh: `移除${labelZh}策略`, rationale: "Removing the policy eliminates its release checks.", rationaleZh: "移除该策略会取消对应发布检查。", before: "configured", after: "not configured" });
    return false;
  }
  return true;
}

function compareKeyedCollections(add, before, after, { category, label, labelZh, added = "strengthened", removed = "weakened" }) {
  const left = new Map(before.map((item) => [item.id, item]));
  const right = new Map(after.map((item) => [item.id, item]));
  for (const id of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    if (!left.has(id)) {
      add({ classification: added, category, key: `${category}.${id}`, title: `${label} ${id} was added`, titleZh: `新增${labelZh} ${id}`, rationale: added === "strengthened" ? "The policy now covers an additional declared requirement." : "A new exception can suppress otherwise active release evidence.", rationaleZh: added === "strengthened" ? "策略现在覆盖额外的声明式要求。" : "新增例外可能排除原本有效的发布证据。", before: "absent", after: "present" });
    } else if (!right.has(id)) {
      add({ classification: removed, category, key: `${category}.${id}`, title: `${label} ${id} was removed`, titleZh: `移除${labelZh} ${id}`, rationale: removed === "weakened" ? "A previously declared requirement is no longer covered." : "Removing an exception restores ordinary scoring and gating.", rationaleZh: removed === "weakened" ? "原先声明的要求现在不再覆盖。" : "移除例外会恢复普通评分与门禁。", before: "present", after: "absent" });
    } else if (JSON.stringify(canonical(left.get(id))) !== JSON.stringify(canonical(right.get(id)))) {
      add({ classification: "review", category, key: `${category}.${id}`, title: `${label} ${id} changed`, titleZh: `${labelZh} ${id} 已变更`, rationale: "The declaration changed in a way that needs human review; raw selectors, routes, and reasons are intentionally not copied into this artifact.", rationaleZh: "该声明发生了需要人工复核的变化；原始选择器、路由和原因不会复制到此产物。", before: "configured", after: "changed" });
    }
  }
}

function compareStringSets(add, before, after, { category, key, label, labelZh, additionsStrengthen = true }) {
  const left = new Set(before || []);
  const right = new Set(after || []);
  const added = [...right].filter((item) => !left.has(item));
  const removed = [...left].filter((item) => !right.has(item));
  if (!added.length && !removed.length) return;
  const classification = added.length && removed.length ? "review" : added.length ? (additionsStrengthen ? "strengthened" : "weakened") : (additionsStrengthen ? "weakened" : "strengthened");
  add({ classification, category, key, title: `${label} changed`, titleZh: `${labelZh}已变更`, rationale: classification === "review" ? "The allow/require set changed in both directions and needs human review." : classification === "strengthened" ? "The new set enforces a narrower or broader reviewed protection as intended." : "The new set permits or checks less than before.", rationaleZh: classification === "review" ? "允许/必需集合同时双向变化，需要人工复核。" : classification === "strengthened" ? "新集合按预期实施了更严格或更广的保护。" : "新集合比以前允许更多或检查更少。", before: `${left.size} item(s)`, after: `${right.size} item(s)` });
}

export function buildPolicyReview(beforePath, afterPath, { now = new Date() } = {}) {
  const beforeLoaded = loadConfig(beforePath);
  const afterLoaded = loadConfig(afterPath);
  if (beforeLoaded.path === afterLoaded.path) throw new Error("policy-review requires two different config files");
  const before = effective(beforeLoaded.value);
  const after = effective(afterLoaded.value);
  const { changes, add } = changeCollector();

  compareSeverity(add, { before: before.failOn, after: after.failOn, category: "release-gate", key: "failOn", label: "Failure threshold", labelZh: "失败阈值", ranking: FAIL_STRICTNESS });
  if (before.mode !== after.mode) {
    const strengthened = after.mode === "deep";
    add({ classification: strengthened ? "strengthened" : "weakened", category: "coverage", key: "mode", title: `Scenario mode changed from ${before.mode} to ${after.mode}`, titleZh: `场景模式从 ${before.mode} 调整为 ${after.mode}`, rationale: strengthened ? "Deep mode adds bounded preference, recovery, and accessibility scenarios." : "Quick mode removes Deep-only proving scenarios.", rationaleZh: strengthened ? "Deep 模式增加有边界的偏好、恢复与可访问性场景。" : "Quick 模式会移除仅 Deep 提供的证明场景。", before: before.mode, after: after.mode });
  }

  const beforeViewports = new Map(before.viewports.map((item) => [item.id, item]));
  const afterViewports = new Map(after.viewports.map((item) => [item.id, item]));
  for (const id of [...new Set([...beforeViewports.keys(), ...afterViewports.keys()])].sort()) {
    const left = beforeViewports.get(id);
    const right = afterViewports.get(id);
    if (!left) add({ classification: "strengthened", category: "responsive", key: `viewports.${id}`, title: `Responsive checkpoint ${id} was added`, titleZh: `新增响应式核查点 ${id}`, rationale: "An additional isolated breakpoint will now be proved.", rationaleZh: "现在会额外证明一个隔离断点。", before: "absent", after: `${right.width}x${right.height}` });
    else if (!right) add({ classification: "weakened", category: "responsive", key: `viewports.${id}`, title: `Responsive checkpoint ${id} was removed`, titleZh: `移除响应式核查点 ${id}`, rationale: "A previously reviewed breakpoint will no longer run or produce evidence.", rationaleZh: "原先审核过的断点将不再运行或生成证据。", before: `${left.width}x${left.height}`, after: "absent" });
    else {
      if (left.touch !== right.touch) compareBoolean(add, { before: left.touch, after: right.touch, category: "responsive", key: `viewports.${id}.touch`, label: `${id} touch-target checks`, labelZh: `${id} 触控目标检查` });
      if (left.width !== right.width || left.height !== right.height) add({ classification: "review", category: "responsive", key: `viewports.${id}.dimensions`, title: `Responsive checkpoint ${id} changed dimensions`, titleZh: `响应式核查点 ${id} 更改尺寸`, rationale: "A different breakpoint is not inherently stronger or weaker; confirm it represents supported traffic and devices.", rationaleZh: "不同断点并不天然更强或更弱；请确认它代表受支持的流量与设备。", before: `${left.width}x${left.height}`, after: `${right.width}x${right.height}` });
    }
  }

  compareBoolean(add, { before: before.crawl.enabled, after: after.crawl.enabled, category: "coverage", key: "crawl.enabled", label: "Safe crawl", labelZh: "安全爬取" });
  compareNumber(add, { before: before.crawl.maxPages, after: after.crawl.maxPages, category: "coverage", key: "crawl.maxPages", label: "Crawl page limit", labelZh: "爬取页面上限", higherIsStronger: true });
  compareNumber(add, { before: before.crawl.maxDepth, after: after.crawl.maxDepth, category: "coverage", key: "crawl.maxDepth", label: "Crawl depth", labelZh: "爬取深度", higherIsStronger: true });
  if (JSON.stringify(canonical(before.crawl.include)) !== JSON.stringify(canonical(after.crawl.include)) || JSON.stringify(canonical(before.crawl.exclude)) !== JSON.stringify(canonical(after.crawl.exclude))) add({ classification: "review", category: "coverage", key: "crawl.scope", title: "Crawl route scope changed", titleZh: "爬取路由范围已变更", rationale: "Route globs can overlap, so scope changes require human review and are reported without copying application paths.", rationaleZh: "路由 glob 可能重叠，因此范围变化需要人工复核，且不会复制应用路径。", before: `${before.crawl.include.length} include / ${before.crawl.exclude.length} exclude`, after: `${after.crawl.include.length} include / ${after.crawl.exclude.length} exclude` });
  if (JSON.stringify(canonical(before.routes)) !== JSON.stringify(canonical(after.routes))) add({ classification: after.routes.length > before.routes.length ? "strengthened" : after.routes.length < before.routes.length ? "weakened" : "review", category: "coverage", key: "routes", title: "Explicit route coverage changed", titleZh: "显式路由覆盖已变更", rationale: after.routes.length > before.routes.length ? "More explicitly declared pages will be audited." : after.routes.length < before.routes.length ? "Fewer explicitly declared pages will be audited." : "The route set changed without changing its size and needs review.", rationaleZh: after.routes.length > before.routes.length ? "将核查更多显式声明页面。" : after.routes.length < before.routes.length ? "将核查更少显式声明页面。" : "路由集合在数量不变时发生变化，需要复核。", before: `${before.routes.length} route(s)`, after: `${after.routes.length} route(s)` });

  compareKeyedCollections(add, before.checks, after.checks, { category: "checks", label: "Declarative check", labelZh: "声明式检查" });
  compareKeyedCollections(add, before.journeys, after.journeys, { category: "journeys", label: "Safe journey", labelZh: "安全旅程" });
  compareKeyedCollections(add, before.owners, after.owners, { category: "ownership", label: "Ownership mapping", labelZh: "责任归属映射" });
  compareKeyedCollections(add, before.waivers, after.waivers, { category: "exceptions", label: "Governed waiver", labelZh: "受治理豁免", added: "weakened", removed: "strengthened" });

  if (comparePolicyPresence(add, before.budgets, after.budgets, "performance", "Performance budget", "性能预算")) {
    for (const key of ["navigationMs", "domContentLoadedMs", "ttfbMs", "firstContentfulPaintMs", "largestContentfulPaintMs", "cumulativeLayoutShift", "requests", "transferKb", "domNodes"]) compareNumber(add, { before: before.budgets[key] ?? null, after: after.budgets[key] ?? null, category: "performance", key: `budgets.${key}`, label: `Performance limit ${key}`, labelZh: `性能限制 ${key}`, higherIsStronger: false });
    compareSeverity(add, { before: before.budgets.severity, after: after.budgets.severity, category: "performance", key: "budgets.severity", label: "Performance finding severity", labelZh: "性能问题严重级别", ranking: FINDING_SEVERITY });
  }

  if (comparePolicyPresence(add, before.network, after.network, "network", "Network reliability", "网络可靠性")) {
    if (before.network.scope !== after.network.scope) add({ classification: after.network.scope === "all" ? "strengthened" : "weakened", category: "network", key: "network.scope", title: `Network scope changed from ${before.network.scope} to ${after.network.scope}`, titleZh: `网络范围从 ${before.network.scope} 调整为 ${after.network.scope}`, rationale: after.network.scope === "all" ? "All resource requests are now governed." : "Only API-like requests remain governed.", rationaleZh: after.network.scope === "all" ? "现在会治理全部资源请求。" : "现在仅治理类似 API 的请求。", before: before.network.scope, after: after.network.scope });
    for (const key of ["maxHttpErrors", "maxFailedRequests", "maxSlowRequests", "maxThirdPartyRequests"]) compareNumber(add, { before: before.network[key] ?? null, after: after.network[key] ?? null, category: "network", key: `network.${key}`, label: `Network limit ${key}`, labelZh: `网络限制 ${key}`, higherIsStronger: false });
    compareNumber(add, { before: before.network.slowRequestMs ?? null, after: after.network.slowRequestMs ?? null, category: "network", key: "network.slowRequestMs", label: "Slow-request threshold", labelZh: "慢请求阈值", higherIsStronger: false });
    compareSeverity(add, { before: before.network.severity, after: after.network.severity, category: "network", key: "network.severity", label: "Network finding severity", labelZh: "网络问题严重级别", ranking: FINDING_SEVERITY });
  }

  if (comparePolicyPresence(add, before.links, after.links, "links", "Link integrity", "链接完整性")) {
    compareNumber(add, { before: before.links.maxFailures, after: after.links.maxFailures, category: "links", key: "links.maxFailures", label: "Allowed broken links", labelZh: "允许失效链接数", higherIsStronger: false });
    compareNumber(add, { before: before.links.maxChecked, after: after.links.maxChecked, category: "links", key: "links.maxChecked", label: "Checked-link cap", labelZh: "链接核查上限", higherIsStronger: true });
    compareSeverity(add, { before: before.links.severity, after: after.links.severity, category: "links", key: "links.severity", label: "Link finding severity", labelZh: "链接问题严重级别", ranking: FINDING_SEVERITY });
  }

  if (comparePolicyPresence(add, before.metadata, after.metadata, "metadata", "Publishing metadata", "发布元数据")) {
    for (const key of ["requireCanonical", "requireViewport", "requireLang", "forbidNoindex", "requireSingleH1"]) compareBoolean(add, { before: before.metadata[key] ?? false, after: after.metadata[key] ?? false, category: "metadata", key: `metadata.${key}`, label: `Metadata rule ${key}`, labelZh: `元数据规则 ${key}` });
    for (const key of ["titleMinLength", "descriptionMinLength"]) compareNumber(add, { before: before.metadata[key] ?? null, after: after.metadata[key] ?? null, category: "metadata", key: `metadata.${key}`, label: `Metadata minimum ${key}`, labelZh: `元数据最小限制 ${key}`, higherIsStronger: true });
    for (const key of ["titleMaxLength", "descriptionMaxLength"]) compareNumber(add, { before: before.metadata[key] ?? null, after: after.metadata[key] ?? null, category: "metadata", key: `metadata.${key}`, label: `Metadata maximum ${key}`, labelZh: `元数据最大限制 ${key}`, higherIsStronger: false });
    compareSeverity(add, { before: before.metadata.severity, after: after.metadata.severity, category: "metadata", key: "metadata.severity", label: "Metadata finding severity", labelZh: "元数据问题严重级别", ranking: FINDING_SEVERITY });
  }

  if (comparePolicyPresence(add, before.visual, after.visual, "visual", "Visual regression", "视觉回归")) {
    compareNumber(add, { before: before.visual.maxDiffRatio, after: after.visual.maxDiffRatio, category: "visual", key: "visual.maxDiffRatio", label: "Visual changed-pixel ratio", labelZh: "视觉变化像素比例", higherIsStronger: false });
    compareNumber(add, { before: before.visual.pixelThreshold, after: after.visual.pixelThreshold, category: "visual", key: "visual.pixelThreshold", label: "Visual channel threshold", labelZh: "视觉通道阈值", higherIsStronger: false });
    compareStringSets(add, before.visual.masks, after.visual.masks, { category: "visual", key: "visual.masks", label: "Visual masks", labelZh: "视觉 mask", additionsStrengthen: false });
    compareSeverity(add, { before: before.visual.severity, after: after.visual.severity, category: "visual", key: "visual.severity", label: "Visual finding severity", labelZh: "视觉问题严重级别", ranking: FINDING_SEVERITY });
  }

  if (comparePolicyPresence(add, before.security, after.security, "security", "Security baseline", "安全基线")) {
    compareStringSets(add, before.security.requiredHeaders, after.security.requiredHeaders, { category: "security", key: "security.requiredHeaders", label: "Required security headers", labelZh: "必需安全响应头" });
    compareStringSets(add, before.security.allowedThirdPartyOrigins, after.security.allowedThirdPartyOrigins, { category: "security", key: "security.allowedThirdPartyOrigins", label: "Allowed third-party origins", labelZh: "允许的第三方来源", additionsStrengthen: false });
    for (const key of ["forbidMixedContent", "secureForms"]) compareBoolean(add, { before: before.security[key] ?? false, after: after.security[key] ?? false, category: "security", key: `security.${key}`, label: `Security rule ${key}`, labelZh: `安全规则 ${key}` });
    compareNumber(add, { before: before.security.maxThirdPartyOrigins ?? null, after: after.security.maxThirdPartyOrigins ?? null, category: "security", key: "security.maxThirdPartyOrigins", label: "Third-party origin limit", labelZh: "第三方来源上限", higherIsStronger: false });
    compareSeverity(add, { before: before.security.severity, after: after.security.severity, category: "security", key: "security.severity", label: "Security finding severity", labelZh: "安全问题严重级别", ranking: FINDING_SEVERITY });
  }

  if (comparePolicyPresence(add, before.privacy, after.privacy, "privacy", "Browser storage privacy budget", "浏览器存储隐私预算")) {
    for (const key of ["maxCookies", "maxCookieBytes", "maxThirdPartyCookies", "maxLocalStorageEntries", "maxLocalStorageBytes", "maxSessionStorageEntries", "maxSessionStorageBytes"]) {
      compareNumber(add, { before: before.privacy[key] ?? null, after: after.privacy[key] ?? null, category: "privacy", key: `privacy.${key}`, label: `Privacy budget ${key}`, labelZh: `隐私预算 ${key}`, higherIsStronger: false });
    }
    compareSeverity(add, { before: before.privacy.severity, after: after.privacy.severity, category: "privacy", key: "privacy.severity", label: "Privacy finding severity", labelZh: "隐私问题严重级别", ranking: FINDING_SEVERITY });
  }

  if (comparePolicyPresence(add, before.qualityGate, after.qualityGate, "release-gate", "Numeric release gate", "数值发布门禁")) {
    compareNumber(add, { before: before.qualityGate.minimumScore ?? null, after: after.qualityGate.minimumScore ?? null, category: "release-gate", key: "qualityGate.minimumScore", label: "Minimum score", labelZh: "最低评分", higherIsStronger: true });
    compareNumber(add, { before: before.qualityGate.minimumCoveragePercent ?? null, after: after.qualityGate.minimumCoveragePercent ?? null, category: "release-gate", key: "qualityGate.minimumCoveragePercent", label: "Minimum coverage", labelZh: "最低覆盖率", higherIsStronger: true });
    compareNumber(add, { before: before.qualityGate.maxWaivedFindings ?? null, after: after.qualityGate.maxWaivedFindings ?? null, category: "release-gate", key: "qualityGate.maxWaivedFindings", label: "Maximum active waivers", labelZh: "最大有效豁免数", higherIsStronger: false });
  }

  if (comparePolicyPresence(add, before.baselinePolicy, after.baselinePolicy, "baseline-governance", "Baseline governance", "基线治理")) {
    compareNumber(add, { before: before.baselinePolicy.maxAgeDays ?? null, after: after.baselinePolicy.maxAgeDays ?? null, category: "baseline-governance", key: "baselinePolicy.maxAgeDays", label: "Baseline maximum age", labelZh: "基线最大期限", higherIsStronger: false });
    compareBoolean(add, { before: before.baselinePolicy.requireSamePolicy ?? false, after: after.baselinePolicy.requireSamePolicy ?? false, category: "baseline-governance", key: "baselinePolicy.requireSamePolicy", label: "Same-policy baseline requirement", labelZh: "同策略基线要求" });
  }

  changes.sort((left, right) => CLASSIFICATION_ORDER[left.classification] - CLASSIFICATION_ORDER[right.classification] || left.category.localeCompare(right.category) || left.key.localeCompare(right.key));
  const summary = {
    changes: changes.length,
    weakened: changes.filter((item) => item.classification === "weakened").length,
    strengthened: changes.filter((item) => item.classification === "strengthened").length,
    review: changes.filter((item) => item.classification === "review").length,
    gateFailed: changes.some((item) => item.classification === "weakened"),
  };
  return {
    schemaVersion: "1",
    toolVersion: TOOL_VERSION,
    kind: "policy-review",
    generatedAt: now.toISOString(),
    sources: {
      before: { filename: safeFilename(beforeLoaded.path), fingerprint: fingerprint(before) },
      after: { filename: safeFilename(afterLoaded.path), fingerprint: fingerprint(after) },
    },
    summary,
    changes,
    warnings: ["Policy classification is conservative and structural; route-glob, selector, device-market, legal, and product intent still require human review.", "策略分类是保守的结构化判断；路由 glob、选择器、设备市场、法律与产品意图仍需人工复核。"],
  };
}

export function renderPolicyReviewMarkdown(review, language = "en") {
  const zh = language === "zh-CN";
  const lines = [
    `# ${zh ? "RealityCheck 策略变更审查" : "RealityCheck policy change review"}`,
    "",
    zh ? `门禁：**${review.summary.gateFailed ? "失败" : "通过"}** · 弱化 ${review.summary.weakened} · 加强 ${review.summary.strengthened} · 待复核 ${review.summary.review}` : `Gate: **${review.summary.gateFailed ? "FAILED" : "PASSED"}** · ${review.summary.weakened} weakened · ${review.summary.strengthened} strengthened · ${review.summary.review} review`,
    "",
    `- ${zh ? "之前" : "Before"}: \`${markdown(review.sources.before.filename)}\` (\`${review.sources.before.fingerprint}\`)`,
    `- ${zh ? "之后" : "After"}: \`${markdown(review.sources.after.filename)}\` (\`${review.sources.after.fingerprint}\`)`,
    "",
    `## ${zh ? "变更" : "Changes"}`,
    "",
    `| ${zh ? "分类" : "Class"} | ${zh ? "类别" : "Category"} | ${zh ? "变更" : "Change"} | ${zh ? "原因" : "Why it matters"} |`,
    "| --- | --- | --- | --- |",
    ...review.changes.map((item) => `| ${item.classification} | ${markdown(item.category)} | **${item.id}** ${markdown(zh ? item.titleZh : item.title)} | ${markdown(zh ? item.rationaleZh : item.rationale)} |`),
    "",
    `> ${zh ? review.warnings[1] : review.warnings[0]}`,
    "",
  ];
  if (!review.changes.length) lines.splice(10, 0, zh ? "| unchanged | policy | 未发现结构化策略变化。 | 两份有效策略等价。 |" : "| unchanged | policy | No structural policy changes were found. | The two valid policies are equivalent. |");
  return lines.join("\n");
}

function renderPolicyReviewHtmlBase(review) {
  const cards = review.changes.length ? review.changes.map((item) => `<article class="change ${item.classification}" data-classification="${item.classification}" data-search="${html(`${item.category} ${item.key} ${item.title} ${item.titleZh}`.toLowerCase())}"><div class="top"><span class="pill">${item.classification}</span><code>${html(item.id)}</code></div><h2 data-en="${html(item.title)}" data-zh-cn="${html(item.titleZh)}">${html(item.title)}</h2><p data-en="${html(item.rationale)}" data-zh-cn="${html(item.rationaleZh)}">${html(item.rationale)}</p><dl><div><dt data-en="Category" data-zh-cn="类别">Category</dt><dd>${html(item.category)}</dd></div><div><dt data-en="Key" data-zh-cn="策略键">Key</dt><dd><code>${html(item.key)}</code></dd></div><div><dt data-en="Before" data-zh-cn="之前">Before</dt><dd>${html(item.before)}</dd></div><div><dt data-en="After" data-zh-cn="之后">After</dt><dd>${html(item.after)}</dd></div></dl></article>`).join("") : `<article class="change strengthened"><h2 data-en="No structural policy changes" data-zh-cn="未发现结构化策略变化">No structural policy changes</h2><p data-en="The two validated policies are equivalent." data-zh-cn="两份已验证策略等价。">The two validated policies are equivalent.</p></article>`;
  const payload = JSON.stringify({ en: { title: "Policy change review", gate: review.summary.gateFailed ? "WEAKENING BLOCKED" : "NO WEAKENING", search: "Search policy changes", all: "All" }, "zh-CN": { title: "策略变更审查", gate: review.summary.gateFailed ? "已阻止策略弱化" : "未发现策略弱化", search: "搜索策略变更", all: "全部" } }).replaceAll("<", "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';script-src 'unsafe-inline';base-uri 'none';form-action 'none'"><title>RealityCheck policy review</title><style>:root{font-family:Inter,system-ui,sans-serif;color:#191a1f;background:#f4f1eb}*{box-sizing:border-box}body{margin:0}header,main,footer{width:min(1100px,calc(100% - 32px));margin:auto}header{display:flex;justify-content:space-between;align-items:center;padding:22px 0;border-bottom:1px solid #d9d4ca}.brand{font-weight:900}.languages,.filters{display:flex;gap:6px;flex-wrap:wrap}button{min-height:38px;border:1px solid #d5d0c7;border-radius:8px;padding:0 12px;background:#fff;cursor:pointer}button[aria-pressed=true]{color:#fff;background:#202127}.hero{padding:64px 0 30px}.eyebrow{color:#b53b1c;font-size:11px;font-weight:900;letter-spacing:.12em}h1{max-width:800px;margin:8px 0;font-size:clamp(42px,8vw,76px);line-height:.95;letter-spacing:-.055em}.gate{display:inline-block;margin-top:16px;padding:8px 11px;border-radius:7px;color:#fff;background:${review.summary.gateFailed ? "#b4233c" : "#17745a"};font-weight:850}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:26px 0}.summary article{padding:18px;border:1px solid #ddd8cf;border-radius:12px;background:#fff}.summary strong{display:block;font-size:30px}.toolbar{display:flex;justify-content:space-between;gap:16px;align-items:center;margin:26px 0}.toolbar input{min-height:42px;flex:1;border:1px solid #d5d0c7;border-radius:9px;padding:0 12px}.change{margin:12px 0;padding:24px;border:1px solid #ddd8cf;border-left:6px solid #777;border-radius:13px;background:#fff}.change.weakened{border-left-color:#b4233c}.change.strengthened{border-left-color:#17745a}.change.review{border-left-color:#b77708}.top{display:flex;justify-content:space-between}.pill{padding:4px 7px;border-radius:5px;background:#eee;font-size:10px;font-weight:900;text-transform:uppercase}.change h2{margin:20px 0 8px}.change p{color:#60636c;line-height:1.6}.change dl{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:20px 0 0}.change dl div{padding:10px;background:#f5f3ee}.change dt{font-size:10px;color:#71747d}.change dd{margin:5px 0 0;overflow-wrap:anywhere}footer{padding:40px 0;color:#6a6d75}@media(max-width:700px){.summary,.change dl{grid-template-columns:1fr 1fr}.toolbar{align-items:stretch;flex-direction:column}}</style></head><body><header><div class="brand">RealityCheck / POLICY</div><div class="languages" role="group" aria-label="Language"><button type="button" data-language="en" aria-pressed="true">EN</button><button type="button" data-language="zh-CN" aria-pressed="false">中文</button></div></header><main><section class="hero"><p class="eyebrow" data-en="ENTERPRISE GOVERNANCE" data-zh-cn="企业治理">ENTERPRISE GOVERNANCE</p><h1 data-text="title">Policy change review</h1><span class="gate" data-text="gate">${review.summary.gateFailed ? "WEAKENING BLOCKED" : "NO WEAKENING"}</span><div class="summary"><article><strong>${review.summary.changes}</strong><span data-en="changes" data-zh-cn="项变化">changes</span></article><article><strong>${review.summary.weakened}</strong><span data-en="weakened" data-zh-cn="项弱化">weakened</span></article><article><strong>${review.summary.strengthened}</strong><span data-en="strengthened" data-zh-cn="项加强">strengthened</span></article><article><strong>${review.summary.review}</strong><span data-en="review" data-zh-cn="项待复核">review</span></article></div></section><div class="toolbar"><div class="filters" role="group" aria-label="Classification"><button type="button" data-filter="all" data-en="All" data-zh-cn="全部" aria-pressed="true">All</button><button type="button" data-filter="weakened" data-en="Weakened" data-zh-cn="弱化">Weakened</button><button type="button" data-filter="strengthened" data-en="Strengthened" data-zh-cn="加强">Strengthened</button><button type="button" data-filter="review" data-en="Review" data-zh-cn="待复核">Review</button></div><input type="search" data-search placeholder="Search policy changes" aria-label="Search policy changes"></div><section data-changes>${cards}</section></main><footer data-en="RealityCheck · structural policy evidence, not a substitute for human approval." data-zh-cn="RealityCheck · 结构化策略证据不能替代人工批准。">RealityCheck · structural policy evidence, not a substitute for human approval.</footer><script>const i18n=${payload};let language=localStorage.getItem("realitycheck-policy-language")||"en";let filter="all";const apply=()=>{document.documentElement.lang=language;document.querySelectorAll("[data-language]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.language===language)));document.querySelectorAll("[data-text]").forEach(e=>e.textContent=i18n[language][e.dataset.text]);document.querySelector("[data-search]").placeholder=i18n[language].search;const query=document.querySelector("[data-search]").value.trim().toLowerCase();document.querySelectorAll(".change[data-classification]").forEach(e=>e.hidden=(filter!=="all"&&e.dataset.classification!==filter)||(query&&!e.dataset.search.includes(query)));document.querySelectorAll("[data-en]").forEach(e=>e.textContent=e.dataset[language==="zh-CN"?"zhCn":"en"])};document.querySelectorAll("[data-language]").forEach(b=>b.addEventListener("click",()=>{language=b.dataset.language;localStorage.setItem("realitycheck-policy-language",language);apply()}));document.querySelectorAll("[data-filter]").forEach(b=>b.addEventListener("click",()=>{filter=b.dataset.filter;document.querySelectorAll("[data-filter]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));apply()}));document.querySelector("[data-search]").addEventListener("input",apply);apply();</script></body></html>`;
}

export function renderPolicyReviewHtml(review) {
  const classificationZh = { weakened: "弱化", strengthened: "加强", review: "待复核" };
  const sources = `<div class="sources"><article><span data-en="Before policy" data-zh-cn="变更前策略">Before policy</span><strong>${html(review.sources.before.filename)}</strong><code>${html(review.sources.before.fingerprint)}</code></article><article><span data-en="After policy" data-zh-cn="变更后策略">After policy</span><strong>${html(review.sources.after.filename)}</strong><code>${html(review.sources.after.fingerprint)}</code></article></div>`;
  return renderPolicyReviewHtmlBase(review)
    .replace(/<span class="pill">(weakened|strengthened|review)<\/span>/g, (_match, classification) => `<span class="pill" data-en="${classification}" data-zh-cn="${classificationZh[classification]}">${classification}</span>`)
    .replace("</div></section><div class=\"toolbar\">", `</div>${sources}</section><div class="toolbar">`)
    .replace("</style>", ".sources{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.sources article{min-width:0;padding:14px 16px;border:1px solid #ddd8cf;border-radius:10px;background:#fff}.sources span,.sources strong{display:block}.sources span{color:#6a6d75;font-size:10px}.sources strong{margin:6px 0;font-size:13px}.sources code{display:block;font-size:10px;overflow-wrap:anywhere}.count{min-width:86px;color:#6a6d75;font-size:11px}@media(max-width:700px){.sources{grid-template-columns:1fr}.count{min-width:0}}</style>")
    .replace('role="group" aria-label="Language"', 'role="group" aria-label="Language" data-aria-en="Language" data-aria-zh-cn="语言"')
    .replace('role="group" aria-label="Classification"', 'role="group" aria-label="Classification" data-aria-en="Classification" data-aria-zh-cn="变更分类"')
    .replace('aria-label="Search policy changes"></div>', 'aria-label="Search policy changes" data-aria-en="Search policy changes" data-aria-zh-cn="搜索策略变更"><span class="count" role="status" aria-live="polite" data-count></span></div>')
    .replace('document.querySelector("[data-search]").placeholder=i18n[language].search;', 'document.querySelector("[data-search]").placeholder=i18n[language].search;document.querySelectorAll("[data-aria-en]").forEach(e=>e.setAttribute("aria-label",e.dataset[language==="zh-CN"?"ariaZhCn":"ariaEn"]));')
    .replace('document.querySelectorAll(".change[data-classification]").forEach(e=>e.hidden=(filter!=="all"&&e.dataset.classification!==filter)||(query&&!e.dataset.search.includes(query)));', `let shown=0;document.querySelectorAll(".change[data-classification]").forEach(e=>{e.hidden=(filter!=="all"&&e.dataset.classification!==filter)||(query&&!e.dataset.search.includes(query));if(!e.hidden)shown+=1});document.querySelector("[data-count]").textContent=language==="zh-CN"?"显示 "+shown+"/${review.changes.length} 项":shown+"/${review.changes.length} shown";`);
}

export function writePolicyReview(review, outputDirectory) {
  const output = resolve(outputDirectory);
  mkdirSync(output, { recursive: true });
  const jsonPath = join(output, "policy-review.json");
  const markdownPath = join(output, "policy-review.md");
  const markdownZhPath = join(output, "policy-review.zh-CN.md");
  const htmlPath = join(output, "policy-review.html");
  writeFileSync(jsonPath, `${JSON.stringify(review, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, renderPolicyReviewMarkdown(review, "en"), "utf8");
  writeFileSync(markdownZhPath, renderPolicyReviewMarkdown(review, "zh-CN"), "utf8");
  writeFileSync(htmlPath, renderPolicyReviewHtml(review), "utf8");
  return { jsonPath, markdownPath, markdownZhPath, htmlPath, review };
}

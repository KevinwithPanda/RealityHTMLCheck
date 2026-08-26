const SKIPPED_SCHEMES = /^(?:data:|blob:|mailto:|tel:|sms:|about:|javascript:)/i;

function normalizePath(value) {
  const output = [];
  for (const part of String(value || "").replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!output.length) return null;
      output.pop();
    } else output.push(part);
  }
  return output.join("/");
}

function decodePath(value) { try { return decodeURIComponent(value); } catch (_) { return value; } }
function lineAt(source, index) { return source.slice(0, index).split("\n").length; }
function compact(value, maximum = 150) { const text = String(value || "").replace(/\s+/g, " ").trim(); return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text; }
function splitReference(reference) {
  const value = String(reference || "");
  const hash = value.indexOf("#");
  const beforeHash = hash < 0 ? value : value.slice(0, hash);
  return { path: beforeHash.split("?", 1)[0], fragment: hash < 0 ? "" : decodePath(value.slice(hash + 1)) };
}
function resolveReference(sourcePath, reference) {
  const clean = decodePath(reference).replaceAll("\\", "/");
  if (clean.startsWith("/") || clean.startsWith("\\")) return { path: null, unsafe: true };
  const directory = normalizePath(sourcePath)?.split("/").slice(0, -1).join("/") ?? "";
  const path = normalizePath(`${directory}/${clean}`);
  return { path, unsafe: path === null };
}
function localReference(value) {
  const reference = String(value || "").trim();
  return reference && !reference.startsWith("#") && !SKIPPED_SCHEMES.test(reference) && !/^(?:https?:)?\/\//i.test(reference) && !/^[a-z][a-z0-9+.-]*:/i.test(reference);
}
function packageFinding(ruleId, level, title, summary, remediation, occurrences) {
  return { id: `NOTE-${ruleId.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`, ruleId, level, category: "portability", title: { en: title[0], zhCN: title[1] }, summary: { en: summary[0], zhCN: summary[1] }, remediation: { en: remediation[0], zhCN: remediation[1] }, affectedCount: occurrences.length, evidence: occurrences.slice(0, 8), evidenceTruncated: occurrences.length > 8, safeFix: false };
}
function decodeEntities(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", quot: '"' };
  return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, token) => {
    if (token[0] !== "#") return named[token.toLowerCase()] ?? match;
    const hex = token[1]?.toLowerCase() === "x";
    const code = Number.parseInt(token.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}
function anchors(html) {
  const result = new Set();
  const pattern = /<(?:[a-z][\w:-]*)\b[^>]*\b(?:id|name)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi;
  let match;
  while ((match = pattern.exec(html))) result.add(decodePath(decodeEntities(match[1] ?? match[2] ?? match[3])));
  return result;
}
function htmlLinks(path, html) {
  const result = [];
  const pattern = /<link\b[^>]*>|<a\b[^>]*>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const href = match[0].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!href) continue;
    const value = (href[1] ?? href[2] ?? href[3] ?? "").trim();
    const rel = match[0].match(/\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const relValue = (rel?.[1] ?? rel?.[2] ?? rel?.[3] ?? "").toLowerCase().split(/\s+/);
    if (/^<link/i.test(match[0]) && relValue.includes("stylesheet") && localReference(value)) result.push({ source: path, value, line: lineAt(html, match.index), excerpt: match[0], kind: "stylesheet" });
    if (/^<a/i.test(match[0])) {
      const parts = splitReference(value);
      if (parts.path && parts.fragment && localReference(value) && /\.html?$/i.test(parts.path)) result.push({ source: path, value, line: lineAt(html, match.index), excerpt: match[0], kind: "fragment", fragment: parts.fragment });
    }
  }
  return result;
}
function cssReferences(path, css) {
  const result = [];
  const occupiedImports = [];
  const stringRanges = [];
  let quote = null, stringStart = -1;
  for (let cursor = 0; cursor < css.length; cursor += 1) {
    const character = css[cursor];
    if (quote) {
      if (character === quote && css[cursor - 1] !== "\\") { stringRanges.push([stringStart, cursor + 1]); quote = null; }
    } else if (character === '"' || character === "'") { quote = character; stringStart = cursor; }
  }
  const insideString = (index) => {
    let low = 0, high = stringRanges.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const [start, end] = stringRanges[middle];
      if (index < start) high = middle - 1;
      else if (index >= end) low = middle + 1;
      else return true;
    }
    return false;
  };
  let match;
  const imports = /@import\s+(?:url\(\s*(?:(['"])(.*?)\1|([^\s)'";]+))\s*\)|(['"])(.*?)\4)/gi;
  while ((match = imports.exec(css))) {
    if (insideString(match.index)) continue;
    occupiedImports.push([match.index, imports.lastIndex]);
    const value = (match[2] ?? match[3] ?? match[5] ?? "").trim();
    if (value && !SKIPPED_SCHEMES.test(value)) result.push({ source: path, value, line: lineAt(css, match.index), excerpt: match[0], kind: "stylesheet", remote: /^(?:https?:)?\/\//i.test(value), insecure: /^http:\/\//i.test(value) });
  }
  const urls = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
  while ((match = urls.exec(css))) {
    if (occupiedImports.some(([start, end]) => match.index >= start && match.index < end)) continue;
    if (insideString(match.index)) continue;
    const value = match[2].trim();
    if (localReference(value) || /^(?:https?:)?\/\//i.test(value)) result.push({ source: path, value, line: lineAt(css, match.index), excerpt: match[0], kind: "asset", remote: /^(?:https?:)?\/\//i.test(value), insecure: /^http:\/\//i.test(value) });
  }
  return result;
}
function removeMinMedia(css) {
  let output = css;
  const pattern = /@media\s*\([^)]*\bmin-width\s*:[^)]*\)\s*\{/gi;
  for (let match = pattern.exec(output); match; match = pattern.exec(output)) {
    let index = pattern.lastIndex, depth = 1;
    for (; index < output.length && depth; index += 1) { if (output[index] === "{") depth += 1; else if (output[index] === "}") depth -= 1; }
    output = `${output.slice(0, match.index)}${" ".repeat(index - match.index)}${output.slice(index)}`;
    pattern.lastIndex = match.index;
  }
  return output;
}
function maskCssComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, (value) => value.replace(/[^\n]/g, " ")); }

/** Analyze dependencies reachable from selected HTML entries. */
export function analyzeNotePackage({ entries, knownFiles }) {
  if (!Array.isArray(entries) || !Array.isArray(knownFiles)) throw new TypeError("entries and knownFiles must be arrays");
  const normalizedEntries = entries.map((entry) => ({ ...entry, path: normalizePath(entry.path) })).filter((entry) => entry.path);
  const textByPath = new Map(normalizedEntries.map((entry) => [entry.path, entry]));
  const exact = new Set(knownFiles.map(normalizePath).filter(Boolean));
  const byLower = new Map();
  for (const path of exact) { const key = path.toLowerCase(); if (!byLower.has(key)) byLower.set(key, []); byLower.get(key).push(path); }
  const htmlEntries = normalizedEntries.filter((entry) => entry.kind === "html");
  const reachableCss = new Set();
  const processedCss = new Set();
  const queue = [];
  const unsafe = [], missing = [], caseMismatch = [], unverified = [], crossFragment = [], wideCss = [], remote = [], insecureRemote = [];
  const enqueue = (path) => { if (!reachableCss.has(path)) { reachableCss.add(path); queue.push(path); } };
  const resolveKnown = (reference, source) => {
    const { path, unsafe: outside } = resolveReference(source, splitReference(reference).path);
    if (outside || !path) return { state: "unsafe", path: null };
    if (exact.has(path)) return { state: "exact", path };
    const candidates = byLower.get(path.toLowerCase()) ?? [];
    if (candidates.length === 1) return { state: "case", path: candidates[0] };
    if (candidates.length > 1) return { state: "ambiguous", path: null };
    return { state: "missing", path };
  };
  for (const entry of htmlEntries) for (const reference of htmlLinks(entry.path, entry.text)) {
    const resolved = resolveKnown(reference.value, entry.path);
    if (reference.kind === "stylesheet") {
      if (resolved.state === "exact") enqueue(resolved.path);
      else if (resolved.state === "case") enqueue(resolved.path);
    } else if (reference.kind === "fragment" && ["exact", "case"].includes(resolved.state)) {
      const target = textByPath.get(resolved.path);
      if (!target || target.kind !== "html") unverified.push({ path: entry.path, line: reference.line, excerpt: compact(reference.excerpt) });
      else if (!anchors(target.text).has(reference.fragment)) crossFragment.push({ path: entry.path, line: reference.line, excerpt: compact(reference.excerpt) });
    }
  }
  while (queue.length) {
    const cssPath = queue.shift();
    if (processedCss.has(cssPath)) continue;
    processedCss.add(cssPath);
    const entry = textByPath.get(cssPath);
    if (!entry || entry.kind !== "css" || typeof entry.text !== "string") { unverified.push({ path: cssPath, line: 1, excerpt: "stylesheet content was not read" }); continue; }
    const scannableCss = maskCssComments(entry.text);
    for (const match of removeMinMedia(scannableCss).matchAll(/min-width\s*:\s*(\d+(?:\.\d+)?)px/gi)) if (Number(match[1]) > 480) wideCss.push({ path: cssPath, line: lineAt(entry.text, match.index), excerpt: match[0] });
    for (const reference of cssReferences(cssPath, scannableCss)) {
      if (reference.remote) {
        const item = { path: cssPath, line: reference.line, excerpt: compact(reference.excerpt) };
        remote.push(item);
        if (reference.insecure) insecureRemote.push(item);
        continue;
      }
      const resolved = resolveKnown(reference.value, cssPath);
      const item = { path: cssPath, line: reference.line, excerpt: compact(reference.excerpt) };
      if (resolved.state === "exact") {
        if (reference.kind === "stylesheet") enqueue(resolved.path);
      } else if (resolved.state === "case") { caseMismatch.push({ ...item, excerpt: compact(`${reference.value} → ${resolved.path}`) }); if (reference.kind === "stylesheet") enqueue(resolved.path); }
      else if (resolved.state === "missing") missing.push(item);
      else unsafe.push(item);
    }
  }
  const findings = [];
  if (missing.length) findings.push(packageFinding("css-missing-local-file", "error", ["A stylesheet dependency is missing", "样式表引用的本地资源不存在"], ["A reachable CSS file points to an image, font, or imported stylesheet outside the selected package inventory.", "可达 CSS 文件引用的图片、字体或导入样式表不在所选文件包清单中。"], ["Restore the dependency or correct the CSS path, then check the whole folder again.", "恢复依赖或修正 CSS 路径，然后重新检查整个文件夹。"], missing));
  if (insecureRemote.length) findings.push(packageFinding("css-insecure-remote-dependency", "error", ["A stylesheet loads content over insecure HTTP", "样式表通过不安全的 HTTP 加载内容"], ["A reachable CSS import or asset can be blocked or changed in transit.", "可达 CSS 导入或资源可能被浏览器阻止，或在传输途中被篡改。"], ["Bundle it locally or use a reviewed HTTPS source.", "把资源放到本地，或使用经过审核的 HTTPS 来源。"], insecureRemote));
  if (remote.length) findings.push(packageFinding("css-remote-dependency", "warning", ["A stylesheet depends on remote content", "样式表依赖远程内容"], ["A reachable CSS import, image, or font may fail offline and reveal the reader's IP address.", "可达 CSS 导入、图片或字体离线时可能失效，并可能暴露读者 IP。"], ["Bundle essential content locally or document the intentional privacy and availability trade-off.", "把必要内容放到本地，或明确记录这一隐私与可用性取舍。"], remote));
  if (unsafe.length) findings.push(packageFinding("unsafe-package-path", "error", ["A package reference is unsafe or ambiguous", "文件包引用不安全或存在歧义"], ["A dependency escapes the selected package root, uses a root-relative path, or has multiple case-only matches.", "依赖越过所选文件包根目录、使用根相对路径，或存在多个仅大小写不同的候选。"], ["Keep dependencies inside the note folder and use one exact relative path.", "把依赖保留在笔记文件夹内，并使用唯一且大小写准确的相对路径。"], unsafe));
  if (caseMismatch.length) findings.push(packageFinding("css-path-case-mismatch", "warning", ["A package path uses different letter casing", "文件包路径的字母大小写不一致"], ["The dependency may work on Windows but fail on case-sensitive systems.", "该依赖可能在 Windows 上可用，但在区分大小写的系统中失效。"], ["Match the real file name exactly.", "让引用与真实文件名的大小写完全一致。"], caseMismatch));
  if (unverified.length) findings.push(packageFinding("package-content-not-verified", "warning", ["Part of the package could not be inspected", "文件包中有内容未能核验"], ["A linked HTML or stylesheet exists, but its text was unavailable or above the safe read limit.", "关联 HTML 或样式表虽然存在，但文本不可用或超过安全读取上限。"], ["Select the complete readable folder or reduce oversized text files, then check again.", "选择完整且可读取的文件夹，或缩小超大文本文件后重新检查。"], unverified));
  if (crossFragment.length) findings.push(packageFinding("broken-cross-document-fragment", "error", ["A linked note section does not exist", "链接的笔记章节不存在"], ["A cross-note link opens an existing HTML file but points to a missing ID or named anchor.", "跨笔记链接能打开现有 HTML 文件，但指向的 ID 或命名锚点不存在。"], ["Correct the fragment or add the intended unique ID in the destination note.", "修正片段标识，或在目标笔记中添加预期的唯一 ID。"], crossFragment));
  if (wideCss.length) findings.push(packageFinding("external-css-wide-fixed-layout", "warning", ["An external stylesheet can force horizontal scrolling", "外部样式表可能强制横向滚动"], ["A reachable stylesheet sets a minimum width wider than a typical phone viewport outside a matching desktop-only media query.", "可达样式表在匹配的桌面媒体查询之外设置了宽于常见手机视口的最小宽度。"], ["Use a fluid width or max-width and confine necessary overflow.", "使用流式宽度或 max-width，并限制必要的溢出范围。"], wideCss));
  return findings;
}

export function mergePackageFindings(report, findings) {
  if (!findings.length) return report;
  const order = { error: 0, warning: 1, advice: 2 };
  const merged = [...report.findings, ...findings].sort((left, right) => order[left.level] - order[right.level] || left.ruleId.localeCompare(right.ruleId));
  const counts = { ...report.counts };
  let deduction = 0;
  for (const finding of findings) { counts[finding.level] += finding.affectedCount; deduction += ({ error: 7, warning: 2, advice: 1 })[finding.level] * Math.min(finding.affectedCount, 3); }
  return { ...report, score: Math.max(0, report.score - deduction), status: counts.error ? "needs-fix" : counts.warning ? "review" : "ready", counts, findings: merged };
}

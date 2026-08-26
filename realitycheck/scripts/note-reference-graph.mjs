import { posix } from "node:path";

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();
const HTML_EXTENSIONS = /\.html?$/i;
const CSS_EXTENSION = /\.css$/i;
const SKIPPED_SCHEMES = /^(?:data:|blob:|mailto:|tel:|sms:|about:|javascript:|vbscript:)/i;
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function sortedByteEntries(input) {
  const values = input instanceof Map
    ? [...input].map(([path, bytes]) => ({ path, bytes }))
    : [...input];
  return values.map((entry) => {
    if (!entry || typeof entry.path !== "string" || !entry.path || !(entry.bytes instanceof Uint8Array)) {
      throw new TypeError("reference repair entries require path and Uint8Array bytes");
    }
    return { path: entry.path, bytes: entry.bytes };
  }).sort((left, right) => compareText(left.path, right.path));
}

function lineAt(source, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) if (source.charCodeAt(cursor) === 10) line += 1;
  return line;
}

function splitSuffix(value) {
  const query = value.indexOf("?");
  const hash = value.indexOf("#");
  const cut = query < 0 ? hash : hash < 0 ? query : Math.min(query, hash);
  return cut < 0 ? { pathname: value, suffix: "" } : { pathname: value.slice(0, cut), suffix: value.slice(cut) };
}

function resolveWithinRoot(sourcePath, pathname) {
  if (!pathname || pathname.startsWith("/") || pathname.startsWith("\\") || /^[a-z]:[\\/]/i.test(pathname) || pathname.startsWith("//")) return null;
  const directory = posix.dirname(sourcePath) === "." ? "" : posix.dirname(sourcePath);
  const output = directory ? directory.split("/") : [];
  for (const part of pathname.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!output.length) return null;
      output.pop();
    } else output.push(part);
  }
  return output.join("/");
}

function relativeReference(sourcePath, targetPath, originalPathname) {
  const directory = posix.dirname(sourcePath) === "." ? "" : posix.dirname(sourcePath);
  let relative = posix.relative(directory || ".", targetPath);
  if (!relative) relative = posix.basename(targetPath);
  if (originalPathname.startsWith("./") && !relative.startsWith(".")) relative = `./${relative}`;
  return relative;
}

function htmlReferences(path, text) {
  const references = [];
  const appendCss = (css, absoluteOffset, tag, attribute) => {
    for (const reference of cssReferences(path, css)) {
      references.push({
        ...reference,
        sourceKind: "html",
        tag,
        attribute: `${attribute}:${reference.attribute}`,
        start: absoluteOffset + reference.start,
        end: absoluteOffset + reference.end,
        line: lineAt(text, absoluteOffset + reference.start),
      });
    }
  };
  const tags = /<!--[\s\S]*?-->|<[^>]+>/g;
  let tag;
  while ((tag = tags.exec(text))) {
    if (tag[0].startsWith("<!--") || /^<\s*\//.test(tag[0])) continue;
    const name = tag[0].match(/^<\s*([a-z][\w:-]*)/i)?.[1]?.toLowerCase() || "unknown";
    const attributes = /\b(href|src|poster|data|srcset|style)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
    let attribute;
    while ((attribute = attributes.exec(tag[0]))) {
      const attributeName = attribute[1].toLowerCase();
      const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? "";
      const valueOffset = attribute.index + attribute[0].indexOf(value, attribute[0].indexOf("=") + 1);
      const absoluteOffset = tag.index + valueOffset;
      if (attributeName === "style") {
        appendCss(value, absoluteOffset, name, "style");
        continue;
      }
      if (attributeName !== "srcset") {
        references.push({ sourcePath: path, sourceKind: "html", tag: name, attribute: attributeName, start: absoluteOffset, end: absoluteOffset + value.length, rawValue: value, line: lineAt(text, absoluteOffset) });
        continue;
      }
      const candidates = /(?:^|,)\s*([^\s,]+)(?=\s|,|$)/g;
      let candidate;
      while ((candidate = candidates.exec(value))) {
        const relativeOffset = candidate.index + candidate[0].indexOf(candidate[1]);
        references.push({ sourcePath: path, sourceKind: "html", tag: name, attribute: attributeName, start: absoluteOffset + relativeOffset, end: absoluteOffset + relativeOffset + candidate[1].length, rawValue: candidate[1], line: lineAt(text, absoluteOffset + relativeOffset) });
      }
    }
  }
  const styles = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  let style;
  while ((style = styles.exec(text))) {
    const css = style[1];
    appendCss(css, style.index + style[0].indexOf(css), "style", "block");
  }
  return references;
}

function cssReferences(path, text) {
  const references = [];
  const importRanges = [];
  const ignoredRanges = [];
  let state = "code";
  let rangeStart = -1;
  for (let index = 0; index < text.length; index += 1) {
    if (state === "comment") {
      if (text[index] === "*" && text[index + 1] === "/") { ignoredRanges.push([rangeStart, index + 2]); index += 1; state = "code"; }
      continue;
    }
    if (state === "single" || state === "double") {
      const quote = state === "single" ? "'" : '"';
      if (text[index] === quote && text[index - 1] !== "\\") { ignoredRanges.push([rangeStart, index + 1]); state = "code"; }
      continue;
    }
    if (text[index] === "/" && text[index + 1] === "*") { rangeStart = index; index += 1; state = "comment"; }
    else if (text[index] === "'") { rangeStart = index; state = "single"; }
    else if (text[index] === '"') { rangeStart = index; state = "double"; }
  }
  if (state !== "code") ignoredRanges.push([rangeStart, text.length]);
  const inside = (index, ranges = ignoredRanges) => ranges.some(([start, end]) => index >= start && index < end);
  const add = (match, value, attribute) => {
    const relativeOffset = match[0].indexOf(value);
    const start = match.index + relativeOffset;
    references.push({ sourcePath: path, sourceKind: "css", tag: "style", attribute, start, end: start + value.length, rawValue: value, line: lineAt(text, start) });
  };
  const imports = /@import\s+(?:url\(\s*(?:(["'])(.*?)\1|([^\s)'";]+))\s*\)|(["'])(.*?)\4)/gi;
  let match;
  while ((match = imports.exec(text))) {
    if (inside(match.index)) continue;
    importRanges.push([match.index, imports.lastIndex]);
    add(match, match[2] ?? match[3] ?? match[5] ?? "", "@import");
  }
  const urls = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
  while ((match = urls.exec(text))) {
    const value = match[2] ?? "";
    if (inside(match.index) || inside(match.index, importRanges)) continue;
    add(match, value, "url");
  }
  return references;
}

function classifyReference(reference, exact, lower) {
  const leading = reference.rawValue.match(/^\s*/)?.[0] || "";
  const trailing = reference.rawValue.match(/\s*$/)?.[0] || "";
  const rawValue = reference.rawValue.slice(leading.length, reference.rawValue.length - trailing.length);
  const { pathname, suffix } = splitSuffix(rawValue);
  const base = { ...reference, pathname, suffix, targetPath: null, replacement: null };
  if (!rawValue || (!pathname && suffix.startsWith("#"))) return { ...base, resolution: "fragment" };
  if (SKIPPED_SCHEMES.test(rawValue) || /^(?:https?:)?\/\//i.test(rawValue) || /^[a-z][a-z0-9+.-]*:/i.test(rawValue)) return { ...base, resolution: "remote" };
  if (pathname.includes("%") || pathname.includes("&")) return { ...base, resolution: "encoded-or-entity" };
  const resolved = resolveWithinRoot(reference.sourcePath, pathname);
  if (resolved === null) return { ...base, resolution: "escape" };
  const usedBackslash = pathname.includes("\\");
  let targetPath = exact.has(resolved) ? resolved : null;
  if (!targetPath) {
    const candidates = lower.get(resolved.normalize("NFC").toLowerCase()) || [];
    if (candidates.length > 1) return { ...base, resolution: "ambiguous" };
    if (!candidates.length) return { ...base, resolution: "missing" };
    [targetPath] = candidates;
  }
  const caseChanged = targetPath !== resolved;
  const resolution = usedBackslash && caseChanged ? "case-and-backslash" : usedBackslash ? "backslash-only" : caseChanged ? "case-only" : "exact";
  const replacement = resolution === "exact" ? null : `${leading}${relativeReference(reference.sourcePath, targetPath, pathname)}${suffix}${trailing}`;
  return { ...base, resolution, targetPath, replacement };
}

/** Build a source-offset reference graph for HTML and CSS without executing either. */
export function buildNoteReferenceGraph(input) {
  const entries = sortedByteEntries(input);
  const exact = new Set(entries.map((entry) => entry.path));
  const lower = new Map();
  for (const path of exact) {
    const key = path.normalize("NFC").toLowerCase();
    if (!lower.has(key)) lower.set(key, []);
    lower.get(key).push(path);
  }
  const sources = new Map();
  const references = [];
  for (const entry of entries) {
    if (!HTML_EXTENSIONS.test(entry.path) && !CSS_EXTENSION.test(entry.path)) continue;
    let text;
    try {
      text = decoder.decode(entry.bytes);
    } catch (error) {
      throw new Error(`Refused to edit non-UTF-8 HTML/CSS: ${entry.path} (${error.message})`);
    }
    sources.set(entry.path, text);
    const scanned = HTML_EXTENSIONS.test(entry.path) ? htmlReferences(entry.path, text) : cssReferences(entry.path, text);
    references.push(...scanned.map((reference) => classifyReference(reference, exact, lower)));
  }
  return { entries, sources, references };
}

/** Apply only unique case/backslash repairs, validating exact spans and overlap. */
export function applySafeReferenceRepairs(input) {
  const graph = buildNoteReferenceGraph(input);
  const editsByPath = new Map();
  for (const reference of graph.references) {
    if (!new Set(["case-only", "backslash-only", "case-and-backslash"]).has(reference.resolution)) continue;
    if (!reference.replacement || /[\u0000-\u001f\u007f]/.test(reference.replacement)) continue;
    if (!editsByPath.has(reference.sourcePath)) editsByPath.set(reference.sourcePath, []);
    editsByPath.get(reference.sourcePath).push(reference);
  }
  const output = new Map(graph.entries.map((entry) => [entry.path, entry.bytes]));
  const changes = [];
  for (const [path, edits] of editsByPath) {
    let text = graph.sources.get(path);
    const ordered = [...edits].sort((left, right) => right.start - left.start || right.end - left.end);
    let previousStart = text.length + 1;
    for (const edit of ordered) {
      if (edit.end > previousStart) throw new Error(`Overlapping reference repairs were refused in ${path}`);
      if (text.slice(edit.start, edit.end) !== edit.rawValue) throw new Error(`Reference source changed before repair in ${path}:${edit.line}`);
      text = `${text.slice(0, edit.start)}${edit.replacement}${text.slice(edit.end)}`;
      previousStart = edit.start;
      changes.push({ path, line: edit.line, attribute: edit.attribute, resolution: edit.resolution, before: edit.rawValue, after: edit.replacement, targetPath: edit.targetPath });
    }
    output.set(path, encoder.encode(text));
  }
  changes.sort((left, right) => compareText(left.path, right.path) || left.line - right.line || compareText(left.before, right.before));
  return { entries: output, graph, changes };
}

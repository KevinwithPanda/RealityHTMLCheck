// Keep the score useful as a prioritization aid instead of turning a realistic
// AI export into an unrecoverable-looking zero. Status and explicit counts
// still preserve the hard error boundary.
const LEVEL_WEIGHT = Object.freeze({ error: 7, warning: 2, advice: 1 });
const RESOURCE_TAGS = new Set(["audio", "embed", "iframe", "img", "input", "link", "object", "script", "source", "track", "video"]);
const SKIPPED_SCHEMES = /^(?:data:|blob:|mailto:|tel:|sms:|about:)/i;

function normalizePath(value) {
  const parts = String(value || "").replaceAll("\\", "/").split("/");
  const output = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") output.pop();
    else output.push(part);
  }
  return output.join("/");
}

function withoutQueryOrHash(value) {
  return String(value || "").split("#", 1)[0].split("?", 1)[0];
}

function decodePath(value) {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return value;
  }
}

function resolveReference(documentPath, reference) {
  const clean = decodePath(withoutQueryOrHash(reference)).replaceAll("\\", "/");
  if (clean.startsWith("/")) return null;
  const directory = normalizePath(documentPath).split("/").slice(0, -1).join("/");
  const output = [];
  for (const part of `${directory}/${clean}`.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!output.length) return null;
      output.pop();
    } else output.push(part);
  }
  return output.join("/");
}

function lineAt(source, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) if (source.charCodeAt(cursor) === 10) line += 1;
  return line;
}

function compactText(value, maximum = 150) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
}

function decodeEntities(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, token) => {
    if (token[0] === "#") {
      const hexadecimal = token[1]?.toLowerCase() === "x";
      const code = Number.parseInt(token.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return named[token.toLowerCase()] ?? match;
  });
}

function visibleText(value) {
  return decodeEntities(String(value || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function scanTags(source) {
  const tags = [];
  let cursor = 0;
  let rawTextTag = null;
  while (cursor < source.length) {
    const start = source.indexOf("<", cursor);
    if (start < 0) break;
    if (rawTextTag) {
      const closingPattern = new RegExp(`^<\\s*\\/\\s*${rawTextTag}\\b`, "i");
      if (!closingPattern.test(source.slice(start))) {
        cursor = start + 1;
        continue;
      }
    }
    if (source.startsWith("<!--", start)) {
      const end = source.indexOf("-->", start + 4);
      cursor = end < 0 ? source.length : end + 3;
      continue;
    }
    let end = start + 1;
    let quote = null;
    for (; end < source.length; end += 1) {
      const character = source[end];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") quote = character;
      else if (character === ">") break;
    }
    if (end >= source.length) break;
    const raw = source.slice(start, end + 1);
    const match = raw.match(/^<\s*(\/)?\s*([a-z][\w:-]*)\b([\s\S]*?)\/?\s*>$/i);
    if (match) {
      const tag = {
        name: match[2].toLowerCase(),
        closing: Boolean(match[1]),
        raw,
        attributes: match[1] ? {} : parseAttributes(match[3]),
        index: start,
        line: lineAt(source, start),
      };
      tags.push(tag);
      if (tag.closing && tag.name === rawTextTag) rawTextTag = null;
      else if (!tag.closing && new Set(["script", "style", "textarea", "title"]).has(tag.name)) rawTextTag = tag.name;
    }
    cursor = end + 1;
  }
  return tags;
}

function parseAttributes(source) {
  const attributes = {};
  const pattern = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(source))) {
    const name = match[1].toLowerCase();
    if (!(name in attributes)) attributes[name] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function evidence(path, line, excerpt) {
  return { path, line, excerpt: compactText(excerpt) };
}

function localized(en, zhCN) {
  return { en, zhCN };
}

function createFinding({ ruleId, level, category, title, summary, remediation, occurrences, safeFix = false }) {
  return {
    id: `NOTE-${ruleId.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`,
    ruleId,
    level,
    category,
    title: localized(title[0], title[1]),
    summary: localized(summary[0], summary[1]),
    remediation: localized(remediation[0], remediation[1]),
    affectedCount: occurrences.length,
    evidence: occurrences.slice(0, 8),
    evidenceTruncated: occurrences.length > 8,
    safeFix,
  };
}

function countWords(text) {
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
  const nonCjk = text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, " ");
  const words = nonCjk.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  return cjk + words;
}

function localReferenceKind(tag, attribute) {
  if (tag === "a" && attribute === "href") return "document";
  return RESOURCE_TAGS.has(tag) ? "asset" : "reference";
}

function collectReferences(tags, source, path) {
  const references = [];
  for (const tag of tags.filter((item) => !item.closing)) {
    for (const attribute of ["href", "src", "poster", "data"]) {
      const value = tag.attributes[attribute];
      if (value === undefined || !value.trim()) continue;
      references.push({ tag: tag.name, attribute, value: value.trim(), line: tag.line, raw: tag.raw, kind: localReferenceKind(tag.name, attribute) });
    }
    if (tag.attributes.srcset) {
      for (const candidate of tag.attributes.srcset.split(",")) {
        const value = candidate.trim().split(/\s+/, 1)[0];
        if (value) references.push({ tag: tag.name, attribute: "srcset", value, line: tag.line, raw: tag.raw, kind: "asset" });
      }
    }
  }
  const styleSources = [];
  const styleBlockPattern = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  let styleMatch;
  while ((styleMatch = styleBlockPattern.exec(source))) styleSources.push({ css: styleMatch[1], offset: styleMatch.index });
  for (const tag of tags.filter((item) => !item.closing && item.attributes.style)) styleSources.push({ css: tag.attributes.style, offset: tag.index });
  for (const style of styleSources) {
    const cssPattern = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
    let cssMatch;
    while ((cssMatch = cssPattern.exec(style.css))) {
      const value = cssMatch[2].trim();
      if (value) references.push({ tag: "style", attribute: "url", value, line: lineAt(source, style.offset + cssMatch.index), raw: cssMatch[0], kind: "asset" });
    }
  }
  return references.map((item) => ({ ...item, path }));
}

function hasScheme(value) {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function isAbsoluteLocalPath(value) {
  return /^(?:file:\/{0,3}|[a-z]:[\\/]|\\\\|\/Users\/|\/home\/)/i.test(value);
}

function isExternal(value) {
  return /^(?:https?:)?\/\//i.test(value);
}

function getElementMatches(source, tagPattern) {
  const matches = [];
  const expression = new RegExp(`<(${tagPattern})\\b[^>]*>([\\s\\S]*?)<\\/\\1\\s*>`, "gi");
  let match;
  while ((match = expression.exec(source))) matches.push({ name: match[1].toLowerCase(), text: visibleText(match[2]), raw: match[0], line: lineAt(source, match.index) });
  return matches;
}

function removeMinWidthMediaQueries(css) {
  let output = "";
  let cursor = 0;
  const pattern = /@media\s*\([^)]*\bmin-width\s*:[^)]*\)\s*\{/gi;
  let match;
  while ((match = pattern.exec(css))) {
    output += css.slice(cursor, match.index);
    let depth = 1;
    let index = pattern.lastIndex;
    let quote = null;
    for (; index < css.length && depth; index += 1) {
      const character = css[index];
      if (quote) {
        if (character === quote && css[index - 1] !== "\\") quote = null;
      } else if (character === '"' || character === "'") quote = character;
      else if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
    }
    output += " ".repeat(index - match.index);
    cursor = index;
    pattern.lastIndex = index;
  }
  return output + css.slice(cursor);
}

export function analyzeHtmlNote({ path = "note.html", html, knownFiles = null }) {
  if (typeof html !== "string") throw new TypeError("html must be a string");
  const documentPath = normalizePath(path) || "note.html";
  const tags = scanTags(html);
  const openTags = tags.filter((tag) => !tag.closing);
  const known = knownFiles ? new Set([...knownFiles].map(normalizePath)) : null;
  const knownLower = known ? new Map([...known].map((item) => [item.toLowerCase(), item])) : null;
  const findings = [];
  const add = (definition) => {
    if (definition.occurrences.length) findings.push(createFinding(definition));
  };

  add({
    ruleId: "encoding-replacement-character", level: "error", category: "integrity",
    title: ["Text contains replacement characters", "文本中出现乱码替代字符"],
    summary: ["The Unicode replacement character usually means bytes were decoded with the wrong encoding or content was already corrupted.", "Unicode 替代字符通常表示文件使用了错误编码解码，或者文本已经损坏。"],
    remediation: ["Reopen the original source with its correct encoding and save a new UTF-8 copy. Do not replace the visible symbols blindly.", "使用原始文件的正确编码重新打开，再另存为 UTF-8；不要直接批量替换可见符号。"],
    occurrences: [...html.matchAll(/�/g)].map((match) => evidence(documentPath, lineAt(html, match.index), "�")),
  });
  add({
    ruleId: "missing-doctype", level: "warning", category: "structure",
    title: ["The document has no HTML5 doctype", "文档缺少 HTML5 doctype"],
    summary: ["Without a doctype, browsers may render the note in compatibility mode with inconsistent layout rules.", "缺少 doctype 时，浏览器可能进入兼容模式，造成布局规则不一致。"],
    remediation: ["Add <!doctype html> as the first line.", "在第一行添加 <!doctype html>。"],
    occurrences: /^\s*<!doctype\s+html\b/i.test(html) ? [] : [evidence(documentPath, 1, html.slice(0, 80))], safeFix: !html.includes("�"),
  });
  const htmlTag = openTags.find((tag) => tag.name === "html");
  add({
    ruleId: "missing-document-language", level: "warning", category: "accessibility",
    title: ["The note language is not declared", "笔记没有声明语言"],
    summary: ["Screen readers, translation tools, and search engines cannot reliably choose pronunciation and language rules.", "屏幕阅读器、翻译工具和搜索引擎无法可靠选择发音与语言规则。"],
    remediation: ["Add a valid lang attribute to the html element, such as lang=\"zh-CN\" or lang=\"en\".", "在 html 元素上添加有效的 lang，例如 lang=\"zh-CN\" 或 lang=\"en\"。"],
    occurrences: htmlTag && htmlTag.attributes.lang?.trim() ? [] : [evidence(documentPath, htmlTag?.line ?? 1, htmlTag?.raw ?? "<html>")], safeFix: Boolean(htmlTag) && !html.includes("�"),
  });
  const charsetTag = openTags.find((tag) => tag.name === "meta" && (tag.attributes.charset || String(tag.attributes["http-equiv"] || "").toLowerCase() === "content-type"));
  const headTag = openTags.find((tag) => tag.name === "head");
  add({
    ruleId: "missing-charset", level: "error", category: "integrity",
    title: ["The character encoding is not declared", "没有声明字符编码"],
    summary: ["A shared or reopened note can decode Chinese, symbols, and emoji incorrectly when UTF-8 is not declared early.", "共享或重新打开笔记时，如果没有尽早声明 UTF-8，中文、符号和 emoji 可能被错误解码。"],
    remediation: ["Add <meta charset=\"utf-8\"> near the start of head.", "在 head 开头附近添加 <meta charset=\"utf-8\">。"],
    occurrences: charsetTag ? [] : [evidence(documentPath, headTag?.line ?? 1, headTag?.raw ?? "<head>")], safeFix: Boolean(headTag) && !html.includes("�"),
  });
  if (charsetTag && charsetTag.index > 1024) add({
    ruleId: "late-charset", level: "warning", category: "integrity",
    title: ["The encoding declaration appears too late", "字符编码声明出现得太晚"],
    summary: ["Browsers inspect the beginning of a document to determine its encoding; a late declaration can be ignored.", "浏览器通过文件开头判断编码，过晚的声明可能被忽略。"],
    remediation: ["Move the charset declaration into the first 1024 bytes of head.", "把 charset 声明移动到 head 的前 1024 字节内。"],
    occurrences: [evidence(documentPath, charsetTag.line, charsetTag.raw)],
  });

  const titles = getElementMatches(html, "title");
  add({
    ruleId: "missing-title", level: "warning", category: "findability",
    title: ["The note has no useful title", "笔记缺少有效标题"],
    summary: ["Browser tabs, bookmarks, search results, and exported files need a concise title.", "浏览器标签、书签、搜索结果和导出文件都需要简洁标题。"],
    remediation: ["Add one descriptive title element inside head.", "在 head 中添加一个能够描述内容的 title 元素。"],
    occurrences: titles.length === 1 && titles[0].text ? [] : [evidence(documentPath, titles[0]?.line ?? headTag?.line ?? 1, titles[0]?.raw ?? "<head>")],
  });

  // Restrict balance checking to containers whose end tags are mandatory in
  // HTML. Optional-end-tag elements such as p, li, tr, head, and body are
  // deliberately excluded to avoid flagging valid compact HTML.
  const requiredContainers = new Set(["article", "aside", "blockquote", "div", "footer", "form", "header", "main", "nav", "ol", "pre", "section", "table", "ul"]);
  const containerStack = [];
  const unbalancedContainers = [];
  for (const tag of tags.filter((item) => requiredContainers.has(item.name))) {
    if (!tag.closing && !/\/\s*>$/.test(tag.raw)) {
      containerStack.push(tag);
      continue;
    }
    if (!tag.closing) continue;
    let matchingIndex = -1;
    for (let index = containerStack.length - 1; index >= 0; index -= 1) {
      if (containerStack[index].name === tag.name) {
        matchingIndex = index;
        break;
      }
    }
    if (matchingIndex < 0) unbalancedContainers.push(evidence(documentPath, tag.line, tag.raw));
    else {
      if (matchingIndex !== containerStack.length - 1) unbalancedContainers.push(evidence(documentPath, tag.line, tag.raw));
      containerStack.splice(matchingIndex);
    }
  }
  unbalancedContainers.push(...containerStack.map((tag) => evidence(documentPath, tag.line, tag.raw)));
  add({
    ruleId: "unbalanced-container", level: "error", category: "structure",
    title: ["A structural container is not closed correctly", "结构容器没有正确闭合"],
    summary: ["The browser will guess how to repair mismatched or unclosed containers, which can move sections and break later layout.", "浏览器会自行猜测如何修复错配或未闭合容器，可能移动章节并破坏后续布局。"],
    remediation: ["Match each reported opening container with the correct closing tag and keep nesting properly ordered.", "为报告中的每个开始容器补上正确结束标签，并保持嵌套顺序。"],
    occurrences: unbalancedContainers,
  });

  const ids = new Map();
  for (const tag of openTags) {
    const id = tag.attributes.id?.trim();
    if (!id) continue;
    if (!ids.has(id)) ids.set(id, []);
    ids.get(id).push(tag);
  }
  const duplicateIds = [...ids.entries()].filter(([, values]) => values.length > 1).flatMap(([id, values]) => values.slice(1).map((tag) => evidence(documentPath, tag.line, `${tag.name}#${id}`)));
  add({
    ruleId: "duplicate-id", level: "error", category: "navigation",
    title: ["Multiple elements use the same ID", "多个元素使用了相同 ID"],
    summary: ["Duplicate IDs make table-of-contents links, footnotes, labels, and scripts target the wrong element.", "重复 ID 会让目录、脚注、标签和脚本定位到错误元素。"],
    remediation: ["Give every ID a unique stable value and update links that point to it.", "为每个 ID 设置唯一且稳定的值，并同步更新指向它的链接。"],
    occurrences: duplicateIds,
  });

  const anchors = new Set([...ids.keys(), ...openTags.filter((tag) => tag.name === "a" && tag.attributes.name).map((tag) => tag.attributes.name)]);
  const fragmentOccurrences = [];
  for (const tag of openTags.filter((item) => item.name === "a" && item.attributes.href?.startsWith("#"))) {
    const fragment = decodePath(tag.attributes.href.slice(1));
    if (fragment && !anchors.has(fragment)) fragmentOccurrences.push(evidence(documentPath, tag.line, tag.raw));
  }
  add({
    ruleId: "broken-fragment", level: "error", category: "navigation",
    title: ["An internal note link has no destination", "笔记内部链接没有目标"],
    summary: ["A table-of-contents, footnote, or cross-reference points to an ID that does not exist.", "目录、脚注或交叉引用指向了不存在的 ID。"],
    remediation: ["Correct the href fragment or add the intended unique ID to the destination heading or section.", "修正 href 片段，或为目标标题、章节补上对应的唯一 ID。"],
    occurrences: fragmentOccurrences,
  });

  const headings = getElementMatches(html, "h[1-6]");
  const skipped = [];
  let previousLevel = null;
  for (const heading of headings) {
    const level = Number(heading.name.slice(1));
    if (previousLevel !== null && level > previousLevel + 1) skipped.push(evidence(documentPath, heading.line, heading.raw));
    previousLevel = level;
  }
  add({
    ruleId: "heading-level-skip", level: "warning", category: "structure",
    title: ["The heading outline skips a level", "标题层级发生跳跃"],
    summary: ["A skipped level makes long notes harder to navigate with a table of contents or assistive technology.", "标题层级跳跃会让长笔记的目录和辅助技术导航更难理解。"],
    remediation: ["Use headings as a nested outline and change one level at a time; do not choose heading levels for visual size.", "把标题作为嵌套大纲使用，每次只变化一级；不要为了字号选择标题级别。"],
    occurrences: skipped,
  });
  add({
    ruleId: "empty-heading", level: "warning", category: "structure",
    title: ["A heading has no readable text", "标题没有可读文本"],
    summary: ["Empty headings create blank entries in outlines and screen-reader navigation.", "空标题会在大纲和屏幕阅读器导航中产生空白条目。"],
    remediation: ["Add a concise heading or remove the empty heading element.", "补充简洁标题，或者删除空标题元素。"],
    occurrences: headings.filter((heading) => !heading.text).map((heading) => evidence(documentPath, heading.line, heading.raw)),
  });
  const h1s = headings.filter((heading) => heading.name === "h1");
  add({
    ruleId: "ambiguous-primary-heading", level: "advice", category: "structure",
    title: ["The note does not have one clear primary heading", "笔记没有唯一清晰的主标题"],
    summary: ["A single descriptive H1 makes a standalone note easier to scan, index, and export.", "一个清晰的 H1 能让独立笔记更容易浏览、索引和导出。"],
    remediation: ["Use one H1 for the note title, then organize sections beneath it.", "使用一个 H1 作为笔记主标题，再在其下组织章节。"],
    occurrences: h1s.length === 1 ? [] : [evidence(documentPath, h1s[1]?.line ?? 1, `${h1s.length} H1 elements`)],
  });

  const images = openTags.filter((tag) => tag.name === "img");
  add({
    ruleId: "image-missing-alt", level: "warning", category: "accessibility",
    title: ["An image has no alt attribute", "图片缺少 alt 属性"],
    summary: ["The note does not tell screen-reader and text-only users whether the image is meaningful or decorative.", "笔记没有告诉屏幕阅读器和纯文本用户图片是否有含义或只是装饰。"],
    remediation: ["Write concise alternative text for meaningful images; use alt=\"\" only for decorative images.", "为有含义的图片编写简洁替代文本；只有装饰图片才使用 alt=\"\"。"],
    occurrences: images.filter((tag) => !("alt" in tag.attributes)).map((tag) => evidence(documentPath, tag.line, tag.raw)),
  });

  const references = collectReferences(openTags, html, documentPath);
  const absoluteLocal = references.filter((item) => isAbsoluteLocalPath(item.value));
  add({
    ruleId: "machine-specific-path", level: "error", category: "portability",
    title: ["A link only works on one computer", "链接只能在某一台电脑上使用"],
    summary: ["The note contains a file URL, drive letter, home directory, or network-share path that will break when shared.", "笔记包含 file URL、盘符、用户目录或网络共享路径，分享后会失效。"],
    remediation: ["Copy the resource into the note folder and replace the reference with a relative path.", "把资源复制到笔记文件夹，并把引用改为相对路径。"],
    occurrences: absoluteLocal.map((item) => evidence(documentPath, item.line, item.raw)),
  });
  const insecure = references.filter((item) => /^http:\/\//i.test(item.value) && item.kind === "asset");
  add({
    ruleId: "insecure-remote-asset", level: "error", category: "safety",
    title: ["A remote asset uses insecure HTTP", "远程资源使用了不安全的 HTTP"],
    summary: ["The resource can be blocked on HTTPS pages or changed in transit.", "该资源在 HTTPS 页面中可能被阻止，也可能在传输途中被篡改。"],
    remediation: ["Bundle the asset locally or use a trusted HTTPS source.", "把资源保存到本地，或者改用可信的 HTTPS 来源。"],
    occurrences: insecure.map((item) => evidence(documentPath, item.line, item.raw)),
  });
  const externalAssets = references.filter((item) => isExternal(item.value) && item.kind === "asset");
  add({
    ruleId: "remote-dependency", level: "warning", category: "portability",
    title: ["The note depends on remote content", "笔记依赖远程内容"],
    summary: ["Images, fonts, styles, frames, or scripts may disappear offline and can reveal the reader's IP address when opened.", "图片、字体、样式、框架或脚本在离线时可能消失，并可能在打开笔记时暴露读者 IP。"],
    remediation: ["Bundle essential assets in the note folder. Keep remote resources only when the privacy and availability trade-off is intentional.", "把必要资源放入笔记文件夹；只有在明确接受隐私与可用性取舍时才保留远程资源。"],
    occurrences: externalAssets.map((item) => evidence(documentPath, item.line, `${item.tag} ${item.attribute} → ${item.value.replace(/[?#].*$/, "")}`)),
  });

  const localCandidates = references.filter((item) => {
    const value = item.value.trim();
    return value && !value.startsWith("#") && !SKIPPED_SCHEMES.test(value) && !isExternal(value) && !isAbsoluteLocalPath(value) && !hasScheme(value);
  });
  if (known) {
    const missing = [];
    const caseMismatch = [];
    const unsafePaths = [];
    for (const item of localCandidates) {
      const resolved = resolveReference(documentPath, item.value);
      if (!resolved) {
        unsafePaths.push(evidence(documentPath, item.line, item.raw));
        continue;
      }
      if (resolved.endsWith("/")) continue;
      if (known.has(resolved)) continue;
      if (knownLower.has(resolved.toLowerCase())) caseMismatch.push(evidence(documentPath, item.line, `${item.value} → ${knownLower.get(resolved.toLowerCase())}`));
      else missing.push(evidence(documentPath, item.line, item.raw));
    }
    add({
      ruleId: "unsafe-package-path", level: "error", category: "portability",
      title: ["A reference escapes the selected note folder", "引用越过了所选笔记文件夹"],
      summary: ["Root-relative or parent traversal paths can point outside the shared note package and behave differently after moving it.", "根相对路径或越级父目录路径可能指向共享笔记包之外，移动后行为也会变化。"],
      remediation: ["Copy the dependency inside the selected note folder and use an exact relative path that stays within it.", "把依赖复制到所选笔记文件夹内，并使用不会越界且大小写准确的相对路径。"],
      occurrences: unsafePaths,
    });
    add({
      ruleId: "missing-local-file", level: "error", category: "portability",
      title: ["A referenced local file is missing", "引用的本地文件不存在"],
      summary: ["An image, stylesheet, attachment, or linked note was not found in the selected folder.", "在所选文件夹中找不到图片、样式表、附件或被链接的笔记。"],
      remediation: ["Restore the file or correct the relative path, including its extension and letter case.", "恢复该文件，或者修正相对路径、扩展名和字母大小写。"],
      occurrences: missing,
    });
    add({
      ruleId: "path-case-mismatch", level: "warning", category: "portability",
      title: ["A path uses different letter casing", "路径的字母大小写不一致"],
      summary: ["The link may work on Windows but fail after moving the note to Linux, a server, or a case-sensitive archive.", "该链接可能在 Windows 上可用，但迁移到 Linux、服务器或区分大小写的归档后失效。"],
      remediation: ["Make the HTML reference match the file name exactly.", "让 HTML 引用与真实文件名的大小写完全一致。"],
      occurrences: caseMismatch,
    });
  } else if (localCandidates.length) {
    add({
    ruleId: "local-files-not-verified", level: "warning", category: "portability",
      title: ["Local attachments were not verified", "本地附件尚未核验"],
      summary: ["Only one HTML file was selected, so the browser cannot confirm whether sibling images and attachments exist.", "目前只选择了一个 HTML 文件，因此浏览器无法确认同目录图片和附件是否存在。"],
      remediation: ["Choose the whole note folder to verify every local dependency without uploading it.", "选择整个笔记文件夹，即可在不上传的情况下核验所有本地依赖。"],
      occurrences: [evidence(documentPath, localCandidates[0].line, `${localCandidates.length} local references`) ],
    });
  }

  const scripts = openTags.filter((tag) => tag.name === "script" && String(tag.attributes.type || "").toLowerCase() !== "application/ld+json");
  add({
    ruleId: "executable-script", level: "warning", category: "safety",
    title: ["The note can execute JavaScript", "笔记可以执行 JavaScript"],
    summary: ["Scripts can modify content, access browser storage, make network requests, or behave differently later.", "脚本可以修改内容、访问浏览器存储、发起网络请求，或者在以后产生不同的行为。"],
    remediation: ["Remove scripts from archival notes. If interactivity is required, keep only reviewed code and document why it is trusted.", "归档笔记应删除脚本；如果确实需要交互，只保留经过审查的代码并说明信任理由。"],
    occurrences: scripts.map((tag) => evidence(documentPath, tag.line, tag.raw)),
  });
  const eventHandlers = openTags.flatMap((tag) => Object.keys(tag.attributes).filter((name) => /^on[a-z]+$/i.test(name)).map((name) => evidence(documentPath, tag.line, `<${tag.name} ${name}=…>`)));
  add({
    ruleId: "inline-event-handler", level: "warning", category: "safety",
    title: ["The note contains inline executable handlers", "笔记包含内联可执行事件"],
    summary: ["Inline onclick/onload-style code is difficult to review and can run just by opening or interacting with the note.", "onclick、onload 等内联代码难以审查，打开或操作笔记时就可能执行。"],
    remediation: ["Remove the handler for static notes or move reviewed behavior into one documented local script.", "静态笔记应删除事件；必要行为应移入一个有说明且经过审查的本地脚本。"],
    occurrences: eventHandlers,
  });
  const javascriptLinks = references.filter((item) => /^javascript:/i.test(item.value));
  add({
    ruleId: "javascript-link", level: "error", category: "safety",
    title: ["A link executes JavaScript", "链接会执行 JavaScript"],
    summary: ["A javascript: URL is unsafe to share and is often produced by copied or generated HTML without review.", "javascript: URL 不适合安全分享，也常见于未经审查的复制或生成式 HTML。"],
    remediation: ["Replace it with a normal link or a real button whose reviewed behavior is defined separately.", "把它替换为普通链接，或使用行为单独定义且经过审查的真实按钮。"],
    occurrences: javascriptLinks.map((item) => evidence(documentPath, item.line, item.raw)),
  });

  const emptyLinks = openTags.filter((tag) => tag.name === "a" && (!tag.attributes.href?.trim() || tag.attributes.href.trim() === "#"));
  add({
    ruleId: "empty-link", level: "warning", category: "navigation",
    title: ["A link has no useful destination", "链接没有有效目标"],
    summary: ["Empty and placeholder links interrupt keyboard navigation and make exported notes feel unfinished.", "空链接和占位链接会干扰键盘导航，也会让导出的笔记显得未完成。"],
    remediation: ["Add the intended destination or replace the link with plain text.", "补充真实目标，或者把链接改成普通文本。"],
    occurrences: emptyLinks.map((tag) => evidence(documentPath, tag.line, tag.raw)),
  });
  const blankTargets = openTags.filter((tag) => tag.name === "a" && tag.attributes.target?.toLowerCase() === "_blank" && !String(tag.attributes.rel || "").toLowerCase().split(/\s+/).includes("noopener"));
  add({
    ruleId: "blank-link-without-noopener", level: "advice", category: "safety",
    title: ["A new-tab link lacks an explicit opener boundary", "新标签链接没有显式隔离 opener"],
    summary: ["Modern browsers usually protect these links, but an explicit rel value makes the intent portable and reviewable.", "现代浏览器通常会保护此类链接，但显式 rel 能让意图更可移植、可审查。"],
    remediation: ["Add rel=\"noopener noreferrer\" when opening an untrusted external page in a new tab.", "在新标签打开不可信外部页面时添加 rel=\"noopener noreferrer\"。"],
    occurrences: blankTargets.map((tag) => evidence(documentPath, tag.line, tag.raw)),
  });

  const tables = getElementMatches(html, "table");
  add({
    ruleId: "table-without-header", level: "warning", category: "accessibility",
    title: ["A data table has no header cells", "数据表格没有表头单元格"],
    summary: ["Readers using assistive technology cannot determine what each row or column represents.", "使用辅助技术的读者无法判断每行或每列代表什么。"],
    remediation: ["Use th cells and scope=\"col\" or scope=\"row\" for genuine data-table headers.", "为真实数据表格使用 th，并设置 scope=\"col\" 或 scope=\"row\"。"],
    occurrences: tables.filter((table) => !/<th\b/i.test(table.raw)).map((table) => evidence(documentPath, table.line, table.raw)),
  });
  const viewport = openTags.find((tag) => tag.name === "meta" && String(tag.attributes.name || "").toLowerCase() === "viewport");
  add({
    ruleId: "missing-viewport", level: "warning", category: "readability",
    title: ["The note is not configured for phone screens", "笔记没有适配手机屏幕"],
    summary: ["Mobile browsers may shrink the page into a desktop-width canvas, making text and controls difficult to use.", "移动浏览器可能把页面缩放成桌面宽度，导致文字和控件难以使用。"],
    remediation: ["Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">.", "添加 <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">。"],
    occurrences: viewport ? [] : [evidence(documentPath, headTag?.line ?? 1, headTag?.raw ?? "<head>")],
  });
  const cssForLayout = [
    ...[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((match) => ({ css: match[1], offset: match.index })),
    ...openTags.filter((tag) => tag.attributes.style).map((tag) => ({ css: tag.attributes.style, offset: tag.index })),
  ];
  const wideMinimums = cssForLayout.flatMap(({ css, offset }) => [...removeMinWidthMediaQueries(css).matchAll(/min-width\s*:\s*(\d+(?:\.\d+)?)px/gi)]
    .filter((match) => Number(match[1]) > 480)
    .map((match) => ({ ...match, absoluteIndex: offset + match.index })));
  add({
    ruleId: "wide-fixed-layout", level: "warning", category: "readability",
    title: ["A fixed minimum width can force horizontal scrolling", "固定最小宽度可能强制横向滚动"],
    summary: ["A container wider than a typical phone viewport makes long notes difficult to read on mobile devices.", "容器宽于常见手机视口时，长笔记在移动端会难以阅读。"],
    remediation: ["Use max-width with a fluid width, and allow tables and code blocks to scroll independently.", "使用 max-width 配合流式宽度，并让表格、代码块单独滚动。"],
    occurrences: wideMinimums.map((match) => evidence(documentPath, lineAt(html, match.absoluteIndex), match[0])),
  });
  const longTokens = [...visibleText(html).matchAll(/\S{100,}/g)];
  add({
    ruleId: "unbreakable-long-text", level: "warning", category: "readability",
    title: ["Very long text may overflow the page", "超长文本可能溢出页面"],
    summary: ["Long URLs, hashes, or generated strings without break opportunities can make the entire note wider than the screen.", "没有换行机会的长 URL、哈希或生成字符串可能让整篇笔记宽于屏幕。"],
    remediation: ["Allow overflow-wrap:anywhere for prose and horizontal scrolling for pre/code blocks.", "正文可使用 overflow-wrap:anywhere，pre/code 块则允许独立横向滚动。"],
    occurrences: longTokens.slice(0, 20).map((match) => evidence(documentPath, 1, match[0])),
  });

  const placeholderPattern = /(?:\{\{[^{}]{1,100}\}\}|\[(?:TODO|TBD)\]|\b(?:TODO|TBD|FIXME)\b|lorem ipsum|example\.invalid)/gi;
  const placeholders = [...html.matchAll(placeholderPattern)];
  add({
    ruleId: "unfinished-placeholder", level: "warning", category: "ai-hygiene",
    title: ["The note still contains placeholder content", "笔记仍包含占位内容"],
    summary: ["Template markers, TODOs, and example-only values are common signs that generated HTML was exported before review.", "模板标记、TODO 和仅供示例的值通常说明生成式 HTML 在复核前就被导出了。"],
    remediation: ["Replace each placeholder with real content or remove the unfinished section before sharing.", "分享前把每个占位内容替换为真实内容，或删除未完成章节。"],
    occurrences: placeholders.map((match) => evidence(documentPath, lineAt(html, match.index), match[0])),
  });

  const text = visibleText(html);
  add({
    ruleId: "almost-empty-note", level: "warning", category: "integrity",
    title: ["The note contains almost no readable content", "笔记几乎没有可读内容"],
    summary: ["The file may be an incomplete export, a shell that depends on a failed script, or the wrong document.", "该文件可能是不完整导出、依赖失败脚本的空壳，或者选错了文档。"],
    remediation: ["Open the source application and export a self-contained note with its visible content included in HTML.", "回到来源应用，重新导出一个把可见内容包含在 HTML 中的完整笔记。"],
    occurrences: text.length >= 40 ? [] : [evidence(documentPath, 1, text || "empty document")],
  });

  findings.sort((left, right) => {
    const order = { error: 0, warning: 1, advice: 2 };
    return order[left.level] - order[right.level] || left.ruleId.localeCompare(right.ruleId);
  });
  const counts = { error: 0, warning: 0, advice: 0, autoFixable: 0 };
  let deduction = 0;
  for (const finding of findings) {
    counts[finding.level] += finding.affectedCount;
    if (finding.safeFix) counts.autoFixable += 1;
    deduction += LEVEL_WEIGHT[finding.level] * Math.min(finding.affectedCount, 3);
  }
  const localAssetCount = localCandidates.filter((item) => item.kind === "asset").length;
  return {
    schemaVersion: "1",
    kind: "html-note-check",
    path: documentPath,
    score: Math.max(0, 100 - deduction),
    status: counts.error ? "needs-fix" : counts.warning ? "review" : "ready",
    counts,
    metrics: {
      bytes: new TextEncoder().encode(html).byteLength,
      characters: text.length,
      words: countWords(text),
      headings: headings.length,
      links: openTags.filter((tag) => tag.name === "a").length,
      images: images.length,
      localAssets: localAssetCount,
      remoteAssets: externalAssets.length,
    },
    findings,
  };
}

export function applySafeNoteFixes(html) {
  if (typeof html !== "string") throw new TypeError("html must be a string");
  // A replacement character means the original bytes may already have been
  // decoded incorrectly. Re-encoding that text would make the damage durable.
  if (html.includes("�")) return { html, changes: [] };
  let output = html;
  const changes = [];
  if (!/^\s*<!doctype\s+html\b/i.test(output)) {
    output = `<!doctype html>\n${output}`;
    changes.push("missing-doctype");
  }
  const text = visibleText(output);
  const han = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  const kana = text.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0;
  const hangul = text.match(/\p{Script=Hangul}/gu)?.length ?? 0;
  const language = kana >= 3 ? "ja" : hangul >= 3 ? "ko" : han >= Math.max(4, text.length * 0.08) ? "zh-CN" : "en";
  output = output.replace(/<html\b([^>]*)>/i, (match, attributes) => {
    if (/\blang\s*=/i.test(attributes)) return match;
    changes.push("missing-document-language");
    return `<html lang="${language}"${attributes}>`;
  });
  if (!/<meta\b[^>]*(?:charset\s*=|http-equiv\s*=\s*["']?content-type)/i.test(output) && /<head\b[^>]*>/i.test(output)) {
    output = output.replace(/<head\b([^>]*)>/i, (match) => {
      changes.push("missing-charset");
      return `${match}\n  <meta charset="utf-8">`;
    });
  }
  return { html: output, changes };
}

export function buildRepairTask(report, language = "zh-CN") {
  const zh = language === "zh-CN";
  const active = report.findings.filter((finding) => finding.level !== "advice");
  const lines = zh
    ? [`请修复 HTML 笔记 ${report.path} 中以下问题。保留原始内容含义，先备份或生成差异，不要通过删除内容、隐藏溢出或关闭检查来过关。`, ""]
    : [`Repair the following problems in HTML note ${report.path}. Preserve the original meaning, create a backup or diff first, and do not pass by deleting content, hiding overflow, or disabling checks.`, ""];
  for (const finding of active) {
    lines.push(`- [${finding.id}] ${zh ? finding.title.zhCN : finding.title.en}`);
    lines.push(`  ${zh ? "建议" : "Remediation"}: ${zh ? finding.remediation.zhCN : finding.remediation.en}`);
    for (const item of finding.evidence.slice(0, 3)) lines.push(`  ${item.path}:${item.line} — ${item.excerpt}`);
  }
  lines.push("");
  lines.push(zh ? "完成后重新运行同一检查，并确认原有错误消失且没有新增错误。" : "Rerun the same check and confirm the original errors are gone with no new errors.");
  return lines.join("\n");
}

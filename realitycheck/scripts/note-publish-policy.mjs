const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export const PUBLISH_PROFILE = "passive-static-v1";
export const PUBLISH_LIMITS = Object.freeze({
  maxArchiveBytes: 64 * 1024 * 1024,
  maxFiles: 1000,
  maxSourceFiles: 994,
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
  maxSourceTotalBytes: 48 * 1024 * 1024,
  maxPathCharacters: 500,
  maxPathBytes: 1024,
  netlifyRecommendedFileBytes: 10 * 1024 * 1024,
});

const ACTIVE_HTML_PATTERNS = Object.freeze([
  ["active-script", /<script\b|<link\b[^>]*\brel\s*=\s*["']?modulepreload/i],
  ["inline-event-handler", /\son[a-z0-9_-]+\s*=/i],
  ["active-url-scheme", /\b(?:href|src|action)\s*=\s*["']?\s*(?:javascript|vbscript):/i],
  ["meta-refresh", /<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i],
  ["embedded-active-content", /<(?:iframe|object|embed)\b/i],
  ["media-autoplay", /<(?:audio|video)\b[^>]*\bautoplay(?:\s|=|>|\/)/i],
  ["form-submission", /<form\b|\bformaction\s*=/i],
  ["base-url-rewrite", /<base\b/i],
]);

const ACTIVE_SVG_PATTERNS = Object.freeze([
  ["svg-script", /<script\b/i],
  ["svg-event-handler", /\son[a-z0-9_-]+\s*=/i],
  ["svg-foreign-object", /<foreignObject\b/i],
  ["svg-active-url", /\b(?:href|xlink:href)\s*=\s*["']?\s*(?:javascript|vbscript):/i],
]);

const SERVER_PATH = /^(?:functions|netlify\/functions|api)(?:\/|$)|(?:^|\/)_worker\.js$|\.(?:php|py|rb|pl|cgi|asp|aspx|jsp|war|jar)$/i;
const ACTIVE_FILE = /\.(?:js|mjs|cjs|wasm)$/i;

function normalizedEntries(input) {
  const values = input instanceof Map ? [...input].map(([path, bytes]) => ({ path, bytes })) : [...input];
  return values.map((entry) => {
    if (!entry || typeof entry.path !== "string" || !entry.path || !(entry.bytes instanceof Uint8Array)) throw new TypeError("publish entries require path and Uint8Array bytes");
    return { path: entry.path, bytes: entry.bytes };
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

function markupTags(text) {
  const withoutComments = text.replace(/<!--[\s\S]*?(?:-->|$)/g, (value) => value.replace(/[^\r\n]/g, " "));
  const tags = [];
  let cursor = 0;
  while (cursor < withoutComments.length) {
    const start = withoutComments.indexOf("<", cursor);
    if (start < 0) break;
    let quote = null;
    let end = start + 1;
    for (; end < withoutComments.length; end += 1) {
      const character = withoutComments[end];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") quote = character;
      else if (character === ">") break;
    }
    if (end >= withoutComments.length) break;
    tags.push(withoutComments.slice(start, end + 1));
    cursor = end + 1;
  }
  return tags;
}

function matchedMarkupCodes(text, patterns) {
  const tags = markupTags(text);
  return patterns.filter(([, pattern]) => tags.some((tag) => pattern.test(tag))).map(([code]) => code);
}

function decodeMarkup(path, bytes) {
  try { return decoder.decode(bytes); }
  catch (error) { throw new Error(`Publishable HTML/SVG must be valid UTF-8: ${path} (${error.message})`); }
}

export function inspectPassiveStaticEntries(input) {
  const entries = normalizedEntries(input);
  const blockers = [];
  let totalBytes = 0;
  for (const entry of entries) {
    totalBytes += entry.bytes.byteLength;
    if (entry.path === "realitycheck-proof" || entry.path.startsWith("realitycheck-proof/")) blockers.push({ code: "reserved-proof-path", path: entry.path });
    if (SERVER_PATH.test(entry.path)) blockers.push({ code: "server-runtime-file", path: entry.path });
    if (ACTIVE_FILE.test(entry.path)) blockers.push({ code: "active-code-file", path: entry.path });
    if (entry.bytes.byteLength > PUBLISH_LIMITS.maxFileBytes) blockers.push({ code: "cloudflare-file-limit", path: entry.path, actual: entry.bytes.byteLength, limit: PUBLISH_LIMITS.maxFileBytes });
    const lower = entry.path.toLowerCase();
    if (/\.html?$/.test(lower)) {
      const text = decodeMarkup(entry.path, entry.bytes);
      for (const code of matchedMarkupCodes(text, ACTIVE_HTML_PATTERNS)) blockers.push({ code, path: entry.path });
    } else if (lower.endsWith(".svg")) {
      const text = decodeMarkup(entry.path, entry.bytes);
      for (const code of matchedMarkupCodes(text, ACTIVE_SVG_PATTERNS)) blockers.push({ code, path: entry.path });
    }
  }
  if (entries.length > PUBLISH_LIMITS.maxFiles) blockers.push({ code: "cloudflare-file-count", actual: entries.length, limit: PUBLISH_LIMITS.maxFiles });
  if (totalBytes > PUBLISH_LIMITS.maxTotalBytes) blockers.push({ code: "publish-total-limit", actual: totalBytes, limit: PUBLISH_LIMITS.maxTotalBytes });
  return { profile: PUBLISH_PROFILE, blockers, files: entries.length, bytes: totalBytes, maxFileBytes: entries.reduce((max, entry) => Math.max(max, entry.bytes.byteLength), 0) };
}

export function choosePublishEntry(paths, requested = null) {
  const htmlPaths = [...paths].filter((path) => /\.html?$/i.test(path)).sort();
  if (!htmlPaths.length) throw new Error("Publish input contains no HTML entry page");
  if (requested !== null) {
    if (typeof requested !== "string" || !htmlPaths.includes(requested)) throw new Error(`Requested publish entry is not a selected HTML file: ${requested}`);
    if (htmlPaths.includes("index.html") && requested !== "index.html") throw new Error("A root index.html already exists; refusing to replace it with a different entry page");
    return { entry: requested, selectedBy: "explicit", htmlPaths };
  }
  if (htmlPaths.includes("index.html")) return { entry: "index.html", selectedBy: "root-index", htmlPaths };
  if (htmlPaths.length === 1) return { entry: htmlPaths[0], selectedBy: "only-html", htmlPaths };
  throw new Error(`Publish input contains ${htmlPaths.length} HTML files and no root index.html; pass --entry with one exact path`);
}

function encodedPath(path) {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function gatewayHtml(target) {
  const safe = encodedPath(target);
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0; url=${safe}"><title>Open published HTML</title></head><body><main><h1>Open published HTML</h1><p><a href="${safe}">Continue to the selected entry page</a></p></main></body></html>\n`;
}

function notFoundHtml(target) {
  const safe = encodedPath(target);
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found</title></head><body><main><h1>Page not found</h1><p><a href="${safe}">Open the site entry page</a></p></main></body></html>\n`;
}

export function buildPublishLayout(input, entry) {
  const entries = new Map(normalizedEntries(input).map((item) => [item.path, item.bytes]));
  if (!entries.has(entry)) throw new Error(`Publish entry is missing from the final source map: ${entry}`);
  const gatewayGenerated = entry !== "index.html";
  if (gatewayGenerated) {
    if (entries.has("index.html")) throw new Error("Refused to overwrite an existing root index.html");
    entries.set("index.html", encoder.encode(gatewayHtml(entry)));
  }
  if (!entries.has("404.html")) entries.set("404.html", encoder.encode(notFoundHtml(entry)));
  if (!entries.has(".nojekyll")) entries.set(".nojekyll", new Uint8Array());
  return { entries, entry, launchPath: gatewayGenerated ? entry : "index.html", gatewayGenerated };
}

export function publishPlatformDecisions({ files, bytes, maxFileBytes, hasRootIndex, browserProofPassed, projectMountPassed, blockers = [] }) {
  const baseBlocked = blockers.length > 0 || !hasRootIndex || !browserProofPassed;
  const netlifyReasons = [];
  if (baseBlocked) netlifyReasons.push("required-gate-failed");
  if (bytes >= 50 * 1024 * 1024) netlifyReasons.push("netlify-total-recommendation");
  if (maxFileBytes > PUBLISH_LIMITS.netlifyRecommendedFileBytes) netlifyReasons.push("netlify-file-recommendation");
  const cloudflareReasons = [];
  if (baseBlocked) cloudflareReasons.push("required-gate-failed");
  if (files > 1000) cloudflareReasons.push("cloudflare-file-count");
  if (maxFileBytes > 25 * 1024 * 1024) cloudflareReasons.push("cloudflare-file-size");
  cloudflareReasons.push("cloudflare-direct-upload-cannot-switch-to-git");
  const githubReasons = [];
  if (baseBlocked || !projectMountPassed) githubReasons.push("required-gate-failed");
  githubReasons.push("github-pages-zip-requires-extraction-or-action");
  return {
    netlifyDrop: { status: netlifyReasons.length ? (baseBlocked ? "block" : "review") : "pass", reasons: netlifyReasons },
    cloudflarePagesDirectUpload: { status: baseBlocked || files > 1000 || maxFileBytes > 25 * 1024 * 1024 ? "block" : "review", reasons: cloudflareReasons },
    githubPages: { status: baseBlocked || !projectMountPassed ? "block" : "review", reasons: githubReasons },
  };
}

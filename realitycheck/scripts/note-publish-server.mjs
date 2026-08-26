import { createServer } from "node:http";

const MIME = new Map([
  [".html", "text/html; charset=utf-8"], [".htm", "text/html; charset=utf-8"], [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"], [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".gif", "image/gif"], [".webp", "image/webp"], [".avif", "image/avif"], [".ico", "image/x-icon"],
  [".json", "application/json; charset=utf-8"], [".xml", "application/xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"], [".md", "text/markdown; charset=utf-8"], [".pdf", "application/pdf"],
  [".woff", "font/woff"], [".woff2", "font/woff2"], [".ttf", "font/ttf"], [".otf", "font/otf"],
  [".mp3", "audio/mpeg"], [".mp4", "video/mp4"], [".webm", "video/webm"], [".wav", "audio/wav"],
]);

export const PUBLISH_SERVER_LIMITS = Object.freeze({
  maxRequests: 10_000,
  maxRecordedPathCharacters: 500,
});

const ALLOWED_MOUNTS = Object.freeze(["/project/", "/"]);
const FORBIDDEN_ENCODED_PATH = /%(?:00|2f|5c)/i;
const FORBIDDEN_DOT_SEGMENT = /(?:^|\/)(?:(?:\.|%2e){1,2})(?:\/|$)/i;

export function publishContentType(path) {
  const dot = path.lastIndexOf(".");
  return MIME.get(dot >= 0 ? path.slice(dot).toLowerCase() : "") || "application/octet-stream";
}

function validEntryMap(entries) {
  if (!(entries instanceof Map) || entries.size === 0) throw new TypeError("publish byte server requires a non-empty entry Map");
  for (const [path, bytes] of entries) {
    if (typeof path !== "string" || !path || !(bytes instanceof Uint8Array)) throw new TypeError("publish byte server entries require a path and Uint8Array bytes");
  }
}

function mountFor(pathname) {
  if (pathname === "/project" || pathname.startsWith("/project/")) return "/project/";
  if (pathname === "/offline" || pathname.startsWith("/offline/")) return null;
  return pathname.startsWith("/") ? "/" : null;
}

/** Resolve one request without filesystem access or implicit directory listing. */
export function resolvePublishRequest(rawUrl, entries, { entrypoint = "index.html" } = {}) {
  const rawPath = typeof rawUrl === "string" ? rawUrl.split(/[?#]/, 1)[0] : "";
  if (!rawPath || FORBIDDEN_ENCODED_PATH.test(rawPath) || FORBIDDEN_DOT_SEGMENT.test(rawPath)) return null;
  let url;
  try { url = new URL(rawUrl, "http://127.0.0.1"); } catch (_) { return null; }
  const mount = mountFor(url.pathname);
  if (!mount) return null;
  let encodedRelative;
  if (mount === "/project/") {
    if (url.pathname === "/project") encodedRelative = "";
    else encodedRelative = url.pathname.slice(mount.length);
  } else encodedRelative = url.pathname.slice(1);
  let path;
  try { path = decodeURIComponent(encodedRelative); } catch (_) { return null; }
  if (!path || path.endsWith("/")) {
    if (path) return null;
    path = entrypoint;
  }
  if (path.includes("\\") || path.startsWith("/") || path.split("/").some((part) => !part || part === "." || part === "..")) return null;
  if (!entries.has(path)) return null;
  return { mount, path, hadQuery: Boolean(url.search), hadFragment: Boolean(url.hash) };
}

function ensureTracker(tracker) {
  if (!tracker || typeof tracker !== "object") throw new TypeError("publish byte server tracker must be an object");
  if (!Number.isSafeInteger(tracker.count) || tracker.count < 0) tracker.count = 0;
  if (!Array.isArray(tracker.requests)) tracker.requests = [];
  if (typeof tracker.truncated !== "boolean") tracker.truncated = false;
  return tracker;
}

function recordRequest(tracker, limits, record) {
  tracker.count += 1;
  if (tracker.requests.length < limits.maxRequests) {
    tracker.requests.push({
      ...record,
      path: typeof record.path === "string" ? record.path.slice(0, limits.maxRecordedPathCharacters) : null,
    });
  } else tracker.truncated = true;
}

function configuredLimits(input = {}) {
  const limits = {};
  for (const [name, fallback] of Object.entries(PUBLISH_SERVER_LIMITS)) {
    const value = input[name] ?? fallback;
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer`);
    limits[name] = value;
  }
  return limits;
}

/**
 * Serve only immutable entry bytes on loopback. The server never rewrites HTML,
 * falls back to another file, lists a directory, or listens on a non-loopback interface.
 */
export async function startPublishByteServer(entries, tracker = { count: 0 }, options = {}) {
  validEntryMap(entries);
  const entrypoint = options.entrypoint ?? "index.html";
  if (typeof entrypoint !== "string" || !entries.has(entrypoint)) throw new Error(`Publish entrypoint is missing from the exact byte map: ${entrypoint}`);
  const limits = configuredLimits(options.limits);
  ensureTracker(tracker);
  const server = createServer((request, response) => {
    const method = request.method || "GET";
    const resolved = resolvePublishRequest(request.url || "/", entries, { entrypoint });
    if (!new Set(["GET", "HEAD"]).has(method)) {
      recordRequest(tracker, limits, { method, mount: resolved?.mount || null, path: resolved?.path || null, status: 405, bytes: 0, hadQuery: resolved?.hadQuery || false });
      response.writeHead(405, { allow: "GET, HEAD", "cache-control": "no-store", "x-content-type-options": "nosniff" }).end();
      return;
    }
    if (!resolved) {
      recordRequest(tracker, limits, { method, mount: null, path: null, status: 404, bytes: 0, hadQuery: false });
      response.writeHead(404, { "cache-control": "no-store", "x-content-type-options": "nosniff" }).end("not found");
      return;
    }
    if (tracker.count >= limits.maxRequests) {
      recordRequest(tracker, limits, { method, mount: resolved.mount, path: resolved.path, status: 429, bytes: 0, hadQuery: resolved.hadQuery });
      response.writeHead(429, { "cache-control": "no-store", "x-content-type-options": "nosniff" }).end("request evidence limit exceeded");
      return;
    }
    const body = entries.get(resolved.path);
    recordRequest(tracker, limits, { method, mount: resolved.mount, path: resolved.path, status: 200, bytes: method === "HEAD" ? 0 : body.byteLength, hadQuery: resolved.hadQuery });
    response.writeHead(200, {
      "content-type": publishContentType(resolved.path),
      "content-length": body.byteLength,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    if (method === "HEAD") response.end();
    else response.end(Buffer.from(body.buffer, body.byteOffset, body.byteLength));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string" || address.address !== "127.0.0.1") {
    await new Promise((resolve) => server.close(resolve));
    throw new Error("Publish byte server did not bind to IPv4 loopback");
  }
  let closed = false;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    entrypoint,
    allowedMounts: [...ALLOWED_MOUNTS],
    close: () => closed ? Promise.resolve() : new Promise((resolve, reject) => {
      closed = true;
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

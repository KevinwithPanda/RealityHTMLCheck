const CONTROL_OR_PLATFORM_PATTERN = /[\u0000-\u001f\u007f\\\[\]{}!<>:"|]/;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function escapeRegex(character) {
  return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
}

/** Validate one small, deterministic, platform-neutral HTML path glob. */
export function normalizeHtmlExcludeGlob(value, label = "--exclude-html") {
  if (typeof value !== "string" || !value.length) throw new TypeError(`${label} must not be empty`);
  if (value !== value.trim()) throw new TypeError(`${label} cannot start or end with whitespace`);
  if (value.length > 512) throw new TypeError(`${label} must be at most 512 characters`);
  if (CONTROL_OR_PLATFORM_PATTERN.test(value)) throw new TypeError(`${label} must use portable forward-slash glob syntax`);
  if (value.startsWith("/") || value.startsWith("//") || /^[A-Za-z]:/.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
    throw new TypeError(`${label} must be a relative portable glob`);
  }
  if (value.startsWith("-")) throw new TypeError(`${label} cannot start with a dash`);
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment === "~")) {
    throw new TypeError(`${label} cannot contain empty, dot, parent, or home-relative path segments`);
  }
  for (const segment of segments) {
    if (segment.endsWith(".") || segment.endsWith(" ")) throw new TypeError(`${label} contains a platform-specific trailing character`);
    if (/\*{3,}/.test(segment) || (segment.includes("**") && segment !== "**")) {
      throw new TypeError(`${label} may use ** only as a complete path segment`);
    }
    const literal = segment.replace(/[?*]/g, "");
    if (WINDOWS_RESERVED.test(literal)) throw new TypeError(`${label} contains a platform-reserved path segment`);
  }
  return value;
}

function globRegex(pattern) {
  let source = "^";
  for (let index = 0; index < pattern.length;) {
    if (pattern.slice(index, index + 3) === "**/") {
      source += "(?:.*/)?";
      index += 3;
      continue;
    }
    if (pattern.slice(index, index + 2) === "**") {
      source += ".*";
      index += 2;
      continue;
    }
    if (pattern[index] === "*") source += "[^/]*";
    else if (pattern[index] === "?") source += "[^/]";
    else source += escapeRegex(pattern[index]);
    index += 1;
  }
  return new RegExp(`${source}$`, "u");
}

/** Compile repeated CLI patterns once and expose their normalized audit form. */
export function compileHtmlExcludeGlobs(values = []) {
  if (!Array.isArray(values)) throw new TypeError("exclude HTML patterns must be an array");
  if (values.length > 100) throw new TypeError("no more than 100 --exclude-html patterns are allowed");
  const patterns = [...new Set(values.map((value, index) => normalizeHtmlExcludeGlob(value, `--exclude-html #${index + 1}`)))];
  const matchers = patterns.map(globRegex);
  return {
    patterns,
    matches(path) {
      const portable = String(path ?? "");
      return matchers.some((matcher) => matcher.test(portable));
    },
  };
}

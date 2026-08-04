import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { resolveVisualBaselineDirectory } from "./visual-regression.mjs";
import { SECURITY_HEADER_POLICY_KEYS, SUPPORTED_CSP_DIRECTIVES, SUPPORTED_CSP_FORBIDDEN_TOKENS, SUPPORTED_PERMISSIONS_POLICY_FEATURES, SUPPORTED_REFERRER_POLICIES } from "./security-headers.mjs";

export const CONFIG_FILENAME = "realitycheck.config.json";

export const DEFAULT_VIEWPORTS = Object.freeze([
  Object.freeze({ id: "mobile-375", width: 375, height: 812, touch: true }),
]);

export const DEFAULT_PROJECT_CONFIG = Object.freeze({
  $schema: "./node_modules/realitycheck-web-audit/realitycheck/assets/config.schema.json",
  baseUrl: "http://127.0.0.1:3000",
  mode: "quick",
  failOn: "major",
  output: ".realitycheck/runs",
  routes: [],
  viewports: DEFAULT_VIEWPORTS,
  crawl: {
    enabled: false,
    maxPages: 10,
    maxDepth: 2,
    include: ["/**"],
    exclude: [
      "/logout/**",
      "/signout/**",
      "/delete/**",
      "/remove/**",
      "/unsubscribe/**",
      "/purchase/**",
      "/checkout/**",
      "/oauth/**",
    ],
  },
  checks: [],
  journeys: [],
  waivers: [],
  owners: [],
});

const TOP_LEVEL_KEYS = new Set(["$schema", "baseUrl", "mode", "failOn", "output", "routes", "viewports", "crawl", "checks", "journeys", "budgets", "network", "links", "metadata", "visual", "security", "privacy", "waivers", "qualityGate", "baselinePolicy", "owners"]);
const VIEWPORT_KEYS = new Set(["id", "width", "height", "touch"]);
const RESERVED_VIEWPORT_IDS = new Set(["baseline", "long-text", "rtl-arabic", "image-failure", "keyboard-tab", "page-zoom-200", "reduced-motion", "dark-scheme", "slow-api", "api-error", "empty-data", "axe"]);
const CRAWL_KEYS = new Set(["enabled", "maxPages", "maxDepth", "include", "exclude"]);
const CHECK_KEYS = new Set(["id", "selector", "assertion", "severity", "title", "titleZh", "remediation", "remediationZh", "include", "exclude", "options"]);
const CHECK_OPTION_KEYS = new Set(["min", "max", "attribute", "equals", "contains", "minWidth", "minHeight"]);
const CHECK_ASSERTIONS = new Set(["exists", "visible", "enabled", "accessible-name", "attribute", "count", "no-horizontal-overflow", "minimum-size"]);
const JOURNEY_KEYS = new Set(["id", "title", "titleZh", "startPath", "severity", "steps"]);
const JOURNEY_STEP_KEYS = new Set(["action", "path", "selector", "assertion", "options", "key"]);
const JOURNEY_ACTIONS = new Set(["goto", "click", "press", "assert", "assert-url"]);
const JOURNEY_KEYS_ALLOWED = new Set(["Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Tab", "Shift+Tab"]);
const BUDGET_KEYS = new Set([
  "severity",
  "navigationMs",
  "domContentLoadedMs",
  "ttfbMs",
  "firstContentfulPaintMs",
  "largestContentfulPaintMs",
  "cumulativeLayoutShift",
  "requests",
  "transferKb",
  "domNodes",
]);
const SECURITY_KEYS = new Set(["severity", "requiredHeaders", "headerPolicies", "forbidMixedContent", "secureForms", "requireSubresourceIntegrity", "maxThirdPartyOrigins", "allowedThirdPartyOrigins"]);
const SECURITY_HEADERS = new Set(["content-security-policy", "strict-transport-security", "x-content-type-options", "referrer-policy", "permissions-policy"]);
const HEADER_POLICY_KEYS = new Set(SECURITY_HEADER_POLICY_KEYS);
const PRIVACY_KEYS = new Set(["severity", "maxCookies", "maxCookieBytes", "maxThirdPartyCookies", "maxLocalStorageEntries", "maxLocalStorageBytes", "maxSessionStorageEntries", "maxSessionStorageBytes"]);
const NETWORK_KEYS = new Set(["severity", "scope", "maxHttpErrors", "maxFailedRequests", "slowRequestMs", "maxSlowRequests", "maxThirdPartyRequests"]);
const LINK_POLICY_KEYS = new Set(["severity", "maxFailures", "maxChecked", "timeoutMs"]);
const METADATA_POLICY_KEYS = new Set(["severity", "titleMinLength", "titleMaxLength", "descriptionMinLength", "descriptionMaxLength", "requireCanonical", "requireViewport", "requireLang", "forbidNoindex", "requireSingleH1"]);
const VISUAL_POLICY_KEYS = new Set(["severity", "baselineDirectory", "maxDiffRatio", "pixelThreshold", "masks"]);
const WAIVER_KEYS = new Set(["id", "ruleId", "selector", "reason", "owner", "expires", "include", "exclude"]);
const QUALITY_GATE_KEYS = new Set(["minimumScore", "minimumCoveragePercent", "maxWaivedFindings"]);
const BASELINE_POLICY_KEYS = new Set(["maxAgeDays", "requireSamePolicy"]);
const OWNER_KEYS = new Set(["id", "name", "ruleIds", "include", "exclude"]);

export class ConfigError extends Error {}

function assertKnownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new ConfigError(`${label} contains unknown property ${JSON.stringify(key)}`);
  }
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new ConfigError(`${label} must be an array of non-empty strings`);
  }
  return [...new Set(value.map((item) => item.trim()))];
}

function boundedInteger(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ConfigError(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function boundedNumber(value, label, minimum, maximum) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ConfigError(`${label} must be a number from ${minimum} to ${maximum}`);
  }
  return value;
}

function validateViewports(value, source) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) throw new ConfigError(`${source}.viewports must contain 1 to 6 entries`);
  const ids = new Set();
  const dimensions = new Set();
  return value.map((raw, index) => {
    const label = `${source}.viewports[${index}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ConfigError(`${label} must be an object`);
    assertKnownKeys(raw, VIEWPORT_KEYS, label);
    if (typeof raw.id !== "string" || !/^[a-z][a-z0-9-]{1,31}$/.test(raw.id)) throw new ConfigError(`${label}.id must match ^[a-z][a-z0-9-]{1,31}$`);
    if (RESERVED_VIEWPORT_IDS.has(raw.id) || raw.id.startsWith("journey-")) throw new ConfigError(`${label}.id collides with a built-in scenario`);
    if (ids.has(raw.id)) throw new ConfigError(`${source}.viewports contains duplicate id ${JSON.stringify(raw.id)}`);
    ids.add(raw.id);
    const width = boundedInteger(raw.width, `${label}.width`, 240, 2560);
    const height = boundedInteger(raw.height, `${label}.height`, 320, 2560);
    const dimensionKey = `${width}x${height}`;
    if (dimensions.has(dimensionKey)) throw new ConfigError(`${source}.viewports contains duplicate dimensions ${dimensionKey}`);
    dimensions.add(dimensionKey);
    if (raw.touch !== undefined && typeof raw.touch !== "boolean") throw new ConfigError(`${label}.touch must be a boolean`);
    return { id: raw.id, width, height, touch: raw.touch ?? width <= 1024 };
  });
}

function validateCustomChecks(value, source) {
  if (!Array.isArray(value)) throw new ConfigError(`${source}.checks must be an array`);
  if (value.length > 100) throw new ConfigError(`${source}.checks cannot contain more than 100 rules`);
  const ids = new Set();
  return value.map((raw, index) => {
    const label = `${source}.checks[${index}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ConfigError(`${label} must be an object`);
    assertKnownKeys(raw, CHECK_KEYS, label);
    if (typeof raw.id !== "string" || !/^[a-z][a-z0-9-]{1,63}$/.test(raw.id)) {
      throw new ConfigError(`${label}.id must match ^[a-z][a-z0-9-]{1,63}$`);
    }
    if (ids.has(raw.id)) throw new ConfigError(`${source}.checks contains duplicate id ${JSON.stringify(raw.id)}`);
    ids.add(raw.id);
    if (typeof raw.selector !== "string" || !raw.selector.trim() || raw.selector.length > 500) {
      throw new ConfigError(`${label}.selector must be a non-empty CSS selector up to 500 characters`);
    }
    if (!CHECK_ASSERTIONS.has(raw.assertion)) throw new ConfigError(`${label}.assertion is not supported`);
    const severity = raw.severity ?? "major";
    if (!new Set(["critical", "major", "minor", "info"]).has(severity)) throw new ConfigError(`${label}.severity is not supported`);
    const normalized = { id: raw.id, selector: raw.selector.trim(), assertion: raw.assertion, severity };
    for (const key of ["title", "titleZh", "remediation", "remediationZh"]) {
      if (raw[key] !== undefined) {
        if (typeof raw[key] !== "string" || !raw[key].trim() || raw[key].length > 500) throw new ConfigError(`${label}.${key} must be a non-empty string up to 500 characters`);
        normalized[key] = raw[key].trim();
      }
    }
    normalized.include = raw.include === undefined ? ["/**"] : stringArray(raw.include, `${label}.include`);
    normalized.exclude = raw.exclude === undefined ? [] : stringArray(raw.exclude, `${label}.exclude`);
    if (raw.options !== undefined) {
      if (!raw.options || typeof raw.options !== "object" || Array.isArray(raw.options)) throw new ConfigError(`${label}.options must be an object`);
      assertKnownKeys(raw.options, CHECK_OPTION_KEYS, `${label}.options`);
      normalized.options = {};
      for (const key of ["min", "max", "minWidth", "minHeight"]) {
        if (raw.options[key] !== undefined) normalized.options[key] = boundedInteger(raw.options[key], `${label}.options.${key}`, 0, 100_000);
      }
      for (const key of ["attribute", "equals", "contains"]) {
        if (raw.options[key] !== undefined) {
          if (typeof raw.options[key] !== "string" || !raw.options[key].trim() || raw.options[key].length > 500) throw new ConfigError(`${label}.options.${key} must be a non-empty string up to 500 characters`);
          normalized.options[key] = raw.options[key].trim();
        }
      }
    }
    if (raw.assertion === "attribute" && !normalized.options?.attribute) throw new ConfigError(`${label}.options.attribute is required for the attribute assertion`);
    return normalized;
  });
}

function validateJourneySelector(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 500) {
    throw new ConfigError(`${label} must be a non-empty CSS selector up to 500 characters`);
  }
  return value.trim();
}

function validateJourneyOptions(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConfigError(`${label} must be an object`);
  assertKnownKeys(value, CHECK_OPTION_KEYS, label);
  const normalized = {};
  for (const key of ["min", "max", "minWidth", "minHeight"]) {
    if (value[key] !== undefined) normalized[key] = boundedInteger(value[key], `${label}.${key}`, 0, 100_000);
  }
  for (const key of ["attribute", "equals", "contains"]) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== "string" || !value[key].trim() || value[key].length > 500) throw new ConfigError(`${label}.${key} must be a non-empty string up to 500 characters`);
      normalized[key] = value[key].trim();
    }
  }
  return normalized;
}

function validateJourneys(value, source) {
  if (!Array.isArray(value)) throw new ConfigError(`${source}.journeys must be an array`);
  if (value.length > 20) throw new ConfigError(`${source}.journeys cannot contain more than 20 journeys`);
  const ids = new Set();
  return value.map((raw, index) => {
    const label = `${source}.journeys[${index}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ConfigError(`${label} must be an object`);
    assertKnownKeys(raw, JOURNEY_KEYS, label);
    if (typeof raw.id !== "string" || !/^[a-z][a-z0-9-]{1,63}$/.test(raw.id)) throw new ConfigError(`${label}.id must match ^[a-z][a-z0-9-]{1,63}$`);
    if (ids.has(raw.id)) throw new ConfigError(`${source}.journeys contains duplicate id ${JSON.stringify(raw.id)}`);
    ids.add(raw.id);
    const normalized = { id: raw.id };
    for (const key of ["title", "titleZh"]) {
      if (raw[key] !== undefined) {
        if (typeof raw[key] !== "string" || !raw[key].trim() || raw[key].length > 200) throw new ConfigError(`${label}.${key} must be a non-empty string up to 200 characters`);
        normalized[key] = raw[key].trim();
      }
    }
    const startPath = raw.startPath ?? "/";
    if (typeof startPath !== "string" || !startPath.startsWith("/") || startPath.startsWith("//") || startPath.length > 1_000) throw new ConfigError(`${label}.startPath must be a same-origin absolute path`);
    normalized.startPath = startPath;
    normalized.severity = raw.severity ?? "major";
    if (!new Set(["critical", "major", "minor"]).has(normalized.severity)) throw new ConfigError(`${label}.severity is not supported`);
    if (!Array.isArray(raw.steps) || !raw.steps.length || raw.steps.length > 50) throw new ConfigError(`${label}.steps must contain 1 to 50 steps`);
    normalized.steps = raw.steps.map((step, stepIndex) => {
      const stepLabel = `${label}.steps[${stepIndex}]`;
      if (!step || typeof step !== "object" || Array.isArray(step)) throw new ConfigError(`${stepLabel} must be an object`);
      assertKnownKeys(step, JOURNEY_STEP_KEYS, stepLabel);
      if (!JOURNEY_ACTIONS.has(step.action)) throw new ConfigError(`${stepLabel}.action must be goto, click, press, assert, or assert-url`);
      if (step.action === "goto" || step.action === "assert-url") {
        if (typeof step.path !== "string" || !step.path.startsWith("/") || step.path.startsWith("//") || step.path.length > 1_000) throw new ConfigError(`${stepLabel}.path must be a same-origin absolute path`);
        if (step.action === "assert-url" && /[?#]/.test(step.path)) throw new ConfigError(`${stepLabel}.path must be a query-free pathname without a fragment`);
        if (step.selector !== undefined || step.assertion !== undefined || step.options !== undefined || step.key !== undefined) throw new ConfigError(`${stepLabel} contains fields that are not valid for ${step.action}`);
        return { action: step.action, path: step.path };
      }
      const normalizedStep = { action: step.action, selector: validateJourneySelector(step.selector, `${stepLabel}.selector`) };
      if (step.action === "click") {
        if (step.path !== undefined || step.assertion !== undefined || step.options !== undefined || step.key !== undefined) throw new ConfigError(`${stepLabel} contains fields that are not valid for click`);
        return normalizedStep;
      }
      if (step.action === "press") {
        if (!JOURNEY_KEYS_ALLOWED.has(step.key)) throw new ConfigError(`${stepLabel}.key must be Escape, an Arrow key, Home, End, Tab, or Shift+Tab`);
        if (step.path !== undefined || step.assertion !== undefined || step.options !== undefined) throw new ConfigError(`${stepLabel} contains fields that are not valid for press`);
        normalizedStep.key = step.key;
        return normalizedStep;
      }
      if (!CHECK_ASSERTIONS.has(step.assertion)) throw new ConfigError(`${stepLabel}.assertion is not supported`);
      normalizedStep.assertion = step.assertion;
      if (step.options !== undefined) normalizedStep.options = validateJourneyOptions(step.options, `${stepLabel}.options`);
      if (step.path !== undefined || step.key !== undefined) throw new ConfigError(`${stepLabel}.path and .key are not valid for assert`);
      if (step.assertion === "attribute" && !normalizedStep.options?.attribute) throw new ConfigError(`${stepLabel}.options.attribute is required for the attribute assertion`);
      return normalizedStep;
    });
    if (!normalized.steps.some((step) => ["assert", "assert-url"].includes(step.action))) throw new ConfigError(`${label}.steps must include at least one assert or assert-url action`);
    return normalized;
  });
}

function validateBudgets(value, source) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConfigError(`${source}.budgets must be an object`);
  assertKnownKeys(value, BUDGET_KEYS, `${source}.budgets`);
  const normalized = { severity: value.severity ?? "major" };
  if (!new Set(["critical", "major", "minor"]).has(normalized.severity)) throw new ConfigError(`${source}.budgets.severity is not supported`);
  for (const key of ["navigationMs", "domContentLoadedMs", "ttfbMs", "firstContentfulPaintMs", "largestContentfulPaintMs", "requests", "transferKb", "domNodes"]) {
    if (value[key] !== undefined) normalized[key] = boundedInteger(value[key], `${source}.budgets.${key}`, 0, 10_000_000);
  }
  if (value.cumulativeLayoutShift !== undefined) {
    normalized.cumulativeLayoutShift = boundedNumber(value.cumulativeLayoutShift, `${source}.budgets.cumulativeLayoutShift`, 0, 100);
  }
  if (Object.keys(normalized).length === 1) throw new ConfigError(`${source}.budgets must define at least one numeric limit`);
  return normalized;
}

function validateHeaderPolicies(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConfigError(`${label} must be an object`);
  assertKnownKeys(value, HEADER_POLICY_KEYS, label);
  const normalized = {};
  const enumArray = (candidate, field, allowed, maximum) => {
    const items = stringArray(candidate, field);
    if (!items.length || items.length > maximum) throw new ConfigError(`${field} must contain 1 to ${maximum} unique values`);
    const unsupported = items.find((item) => !allowed.has(item));
    if (unsupported) throw new ConfigError(`${field} contains unsupported value ${JSON.stringify(unsupported)}`);
    return items;
  };
  if (value.contentSecurityPolicy !== undefined) {
    const field = `${label}.contentSecurityPolicy`;
    const candidate = value.contentSecurityPolicy;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new ConfigError(`${field} must be an object`);
    assertKnownKeys(candidate, new Set(["requiredDirectives", "forbiddenTokens"]), field);
    const policy = {};
    if (candidate.requiredDirectives !== undefined) policy.requiredDirectives = enumArray(candidate.requiredDirectives, `${field}.requiredDirectives`, new Set(SUPPORTED_CSP_DIRECTIVES), 13);
    if (candidate.forbiddenTokens !== undefined) policy.forbiddenTokens = enumArray(candidate.forbiddenTokens, `${field}.forbiddenTokens`, new Set(SUPPORTED_CSP_FORBIDDEN_TOKENS), 5);
    if (!Object.keys(policy).length) throw new ConfigError(`${field} must define requiredDirectives or forbiddenTokens`);
    normalized.contentSecurityPolicy = policy;
  }
  if (value.strictTransportSecurity !== undefined) {
    const field = `${label}.strictTransportSecurity`;
    const candidate = value.strictTransportSecurity;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new ConfigError(`${field} must be an object`);
    assertKnownKeys(candidate, new Set(["minMaxAgeSeconds", "requireIncludeSubDomains", "requirePreload"]), field);
    const policy = {};
    if (candidate.minMaxAgeSeconds !== undefined) policy.minMaxAgeSeconds = boundedInteger(candidate.minMaxAgeSeconds, `${field}.minMaxAgeSeconds`, 0, 63_072_000);
    for (const key of ["requireIncludeSubDomains", "requirePreload"]) {
      if (candidate[key] !== undefined) {
        if (candidate[key] !== true) throw new ConfigError(`${field}.${key} must be true when configured`);
        policy[key] = true;
      }
    }
    if (!Object.keys(policy).length) throw new ConfigError(`${field} must define at least one HSTS requirement`);
    normalized.strictTransportSecurity = policy;
  }
  if (value.xContentTypeOptions !== undefined) {
    const field = `${label}.xContentTypeOptions`;
    const candidate = value.xContentTypeOptions;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new ConfigError(`${field} must be an object`);
    assertKnownKeys(candidate, new Set(["requireNosniff"]), field);
    if (candidate.requireNosniff !== true) throw new ConfigError(`${field}.requireNosniff must be true`);
    normalized.xContentTypeOptions = { requireNosniff: true };
  }
  if (value.referrerPolicy !== undefined) {
    const field = `${label}.referrerPolicy`;
    const candidate = value.referrerPolicy;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new ConfigError(`${field} must be an object`);
    assertKnownKeys(candidate, new Set(["allowedValues"]), field);
    normalized.referrerPolicy = { allowedValues: enumArray(candidate.allowedValues, `${field}.allowedValues`, new Set(SUPPORTED_REFERRER_POLICIES), 8) };
  }
  if (value.permissionsPolicy !== undefined) {
    const field = `${label}.permissionsPolicy`;
    const candidate = value.permissionsPolicy;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new ConfigError(`${field} must be an object`);
    assertKnownKeys(candidate, new Set(["disabledFeatures"]), field);
    normalized.permissionsPolicy = { disabledFeatures: enumArray(candidate.disabledFeatures, `${field}.disabledFeatures`, new Set(SUPPORTED_PERMISSIONS_POLICY_FEATURES), 15) };
  }
  if (!Object.keys(normalized).length) throw new ConfigError(`${label} must define at least one header policy`);
  return normalized;
}

function validateSecurityPolicy(value, source) {
  const label = `${source}.security`;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConfigError(`${label} must be an object`);
  assertKnownKeys(value, SECURITY_KEYS, label);
  const normalized = { severity: value.severity ?? "major" };
  if (!new Set(["critical", "major", "minor"]).has(normalized.severity)) throw new ConfigError(`${label}.severity is not supported`);
  if (value.requiredHeaders !== undefined) {
    normalized.requiredHeaders = stringArray(value.requiredHeaders, `${label}.requiredHeaders`);
    if (normalized.requiredHeaders.some((header) => header !== header.toLowerCase())) throw new ConfigError(`${label}.requiredHeaders must use lowercase header names`);
    const unsupported = normalized.requiredHeaders.find((header) => !SECURITY_HEADERS.has(header));
    if (unsupported) throw new ConfigError(`${label}.requiredHeaders contains unsupported header ${JSON.stringify(unsupported)}`);
  }
  if (value.headerPolicies !== undefined) normalized.headerPolicies = validateHeaderPolicies(value.headerPolicies, `${label}.headerPolicies`);
  for (const key of ["forbidMixedContent", "secureForms", "requireSubresourceIntegrity"]) {
    if (value[key] !== undefined) {
      if (value[key] !== true) throw new ConfigError(`${label}.${key} must be true when configured`);
      normalized[key] = true;
    }
  }
  if (value.maxThirdPartyOrigins !== undefined) normalized.maxThirdPartyOrigins = boundedInteger(value.maxThirdPartyOrigins, `${label}.maxThirdPartyOrigins`, 0, 100);
  if (value.allowedThirdPartyOrigins !== undefined) {
    const origins = stringArray(value.allowedThirdPartyOrigins, `${label}.allowedThirdPartyOrigins`);
    normalized.allowedThirdPartyOrigins = origins.map((raw, index) => {
      let url;
      try { url = new URL(raw); } catch (_) { throw new ConfigError(`${label}.allowedThirdPartyOrigins[${index}] must be an HTTPS origin`); }
      if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new ConfigError(`${label}.allowedThirdPartyOrigins[${index}] must be an HTTPS origin without a path`);
      return url.origin;
    });
  }
  if (Object.keys(normalized).length === 1) throw new ConfigError(`${label} must define at least one security policy`);
  return normalized;
}

function validatePrivacyPolicy(value, source) {
  const label = `${source}.privacy`;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConfigError(`${label} must be an object`);
  assertKnownKeys(value, PRIVACY_KEYS, label);
  const normalized = { severity: value.severity ?? "major" };
  if (!new Set(["critical", "major", "minor"]).has(normalized.severity)) throw new ConfigError(`${label}.severity is not supported`);
  for (const key of ["maxCookies", "maxThirdPartyCookies"]) {
    if (value[key] !== undefined) normalized[key] = boundedInteger(value[key], `${label}.${key}`, 0, 500);
  }
  if (value.maxCookieBytes !== undefined) normalized.maxCookieBytes = boundedInteger(value.maxCookieBytes, `${label}.maxCookieBytes`, 0, 1_000_000);
  for (const key of ["maxLocalStorageEntries", "maxSessionStorageEntries"]) {
    if (value[key] !== undefined) normalized[key] = boundedInteger(value[key], `${label}.${key}`, 0, 10_000);
  }
  for (const key of ["maxLocalStorageBytes", "maxSessionStorageBytes"]) {
    if (value[key] !== undefined) normalized[key] = boundedInteger(value[key], `${label}.${key}`, 0, 10_000_000);
  }
  if (Object.keys(normalized).length === 1) throw new ConfigError(`${label} must define at least one storage or cookie budget`);
  return normalized;
}

function validateNetworkPolicy(value, source) {
  const label = `${source}.network`;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConfigError(`${label} must be an object`);
  assertKnownKeys(value, NETWORK_KEYS, label);
  const normalized = {
    severity: value.severity ?? "major",
    scope: value.scope ?? "api",
  };
  if (!new Set(["critical", "major", "minor"]).has(normalized.severity)) throw new ConfigError(`${label}.severity is not supported`);
  if (!new Set(["api", "all"]).has(normalized.scope)) throw new ConfigError(`${label}.scope must be api or all`);
  for (const key of ["maxHttpErrors", "maxFailedRequests", "maxSlowRequests", "maxThirdPartyRequests"]) {
    if (value[key] !== undefined) normalized[key] = boundedInteger(value[key], `${label}.${key}`, 0, 10_000);
  }
  if (value.slowRequestMs !== undefined) normalized.slowRequestMs = boundedInteger(value.slowRequestMs, `${label}.slowRequestMs`, 1, 120_000);
  if ((value.slowRequestMs === undefined) !== (value.maxSlowRequests === undefined)) {
    throw new ConfigError(`${label}.slowRequestMs and ${label}.maxSlowRequests must be configured together`);
  }
  if (!["maxHttpErrors", "maxFailedRequests", "maxSlowRequests", "maxThirdPartyRequests"].some((key) => normalized[key] !== undefined)) {
    throw new ConfigError(`${label} must define at least one request limit`);
  }
  return normalized;
}

function validateLinkPolicy(value, source) {
  const label = `${source}.links`;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConfigError(`${label} must be an object`);
  assertKnownKeys(value, LINK_POLICY_KEYS, label);
  if (value.maxFailures === undefined) throw new ConfigError(`${label}.maxFailures is required`);
  const normalized = {
    severity: value.severity ?? "major",
    maxFailures: boundedInteger(value.maxFailures, `${label}.maxFailures`, 0, 100),
    maxChecked: value.maxChecked === undefined ? 50 : boundedInteger(value.maxChecked, `${label}.maxChecked`, 1, 100),
    timeoutMs: value.timeoutMs === undefined ? 5_000 : boundedInteger(value.timeoutMs, `${label}.timeoutMs`, 500, 15_000),
  };
  if (!new Set(["critical", "major", "minor"]).has(normalized.severity)) throw new ConfigError(`${label}.severity is not supported`);
  return normalized;
}

function validateMetadataPolicy(value, source) {
  const label = `${source}.metadata`;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConfigError(`${label} must be an object`);
  assertKnownKeys(value, METADATA_POLICY_KEYS, label);
  const normalized = { severity: value.severity ?? "major" };
  if (!new Set(["critical", "major", "minor"]).has(normalized.severity)) throw new ConfigError(`${label}.severity is not supported`);
  for (const key of ["titleMinLength", "titleMaxLength", "descriptionMinLength", "descriptionMaxLength"]) {
    if (value[key] !== undefined) normalized[key] = boundedInteger(value[key], `${label}.${key}`, 0, 1_000);
  }
  for (const key of ["requireCanonical", "requireViewport", "requireLang", "forbidNoindex", "requireSingleH1"]) {
    if (value[key] !== undefined) {
      if (value[key] !== true) throw new ConfigError(`${label}.${key} must be true when configured`);
      normalized[key] = true;
    }
  }
  if (normalized.titleMinLength !== undefined && normalized.titleMaxLength !== undefined && normalized.titleMinLength > normalized.titleMaxLength) throw new ConfigError(`${label}.titleMinLength cannot exceed titleMaxLength`);
  if (normalized.descriptionMinLength !== undefined && normalized.descriptionMaxLength !== undefined && normalized.descriptionMinLength > normalized.descriptionMaxLength) throw new ConfigError(`${label}.descriptionMinLength cannot exceed descriptionMaxLength`);
  if (Object.keys(normalized).length === 1) throw new ConfigError(`${label} must define at least one metadata rule`);
  return normalized;
}

function validateVisualPolicy(value, source) {
  const label = `${source}.visual`;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConfigError(`${label} must be an object`);
  assertKnownKeys(value, VISUAL_POLICY_KEYS, label);
  if (typeof value.baselineDirectory !== "string" || !value.baselineDirectory.trim()) throw new ConfigError(`${label}.baselineDirectory must be a non-empty relative path`);
  const baselineDirectory = value.baselineDirectory.trim();
  if (isAbsolute(baselineDirectory) || baselineDirectory.split(/[\\/]+/).includes("..") || baselineDirectory === ".") throw new ConfigError(`${label}.baselineDirectory must be a child path inside the project`);
  if (value.maxDiffRatio === undefined) throw new ConfigError(`${label}.maxDiffRatio is required`);
  const normalized = {
    severity: value.severity ?? "major",
    baselineDirectory,
    maxDiffRatio: boundedNumber(value.maxDiffRatio, `${label}.maxDiffRatio`, 0, 1),
    pixelThreshold: value.pixelThreshold === undefined ? 32 : boundedInteger(value.pixelThreshold, `${label}.pixelThreshold`, 0, 255),
    masks: value.masks === undefined ? [] : stringArray(value.masks, `${label}.masks`),
  };
  if (!new Set(["critical", "major", "minor"]).has(normalized.severity)) throw new ConfigError(`${label}.severity is not supported`);
  if (normalized.masks.length > 20) throw new ConfigError(`${label}.masks cannot contain more than 20 selectors`);
  if (normalized.masks.some((selector) => selector.length > 500)) throw new ConfigError(`${label}.masks selectors cannot exceed 500 characters`);
  return normalized;
}

function validateWaivers(value, source) {
  if (!Array.isArray(value)) throw new ConfigError(`${source}.waivers must be an array`);
  if (value.length > 100) throw new ConfigError(`${source}.waivers cannot contain more than 100 entries`);
  const ids = new Set();
  return value.map((raw, index) => {
    const label = `${source}.waivers[${index}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ConfigError(`${label} must be an object`);
    assertKnownKeys(raw, WAIVER_KEYS, label);
    if (typeof raw.id !== "string" || !/^[a-z][a-z0-9-]{1,63}$/.test(raw.id)) throw new ConfigError(`${label}.id must match ^[a-z][a-z0-9-]{1,63}$`);
    if (ids.has(raw.id)) throw new ConfigError(`${source}.waivers contains duplicate id ${JSON.stringify(raw.id)}`);
    ids.add(raw.id);
    for (const key of ["ruleId", "reason", "expires"]) {
      if (typeof raw[key] !== "string" || !raw[key].trim()) throw new ConfigError(`${label}.${key} must be a non-empty string`);
    }
    if (raw.ruleId.length > 200) throw new ConfigError(`${label}.ruleId cannot exceed 200 characters`);
    if (raw.reason.length > 500) throw new ConfigError(`${label}.reason cannot exceed 500 characters`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.expires) || Number.isNaN(Date.parse(`${raw.expires}T23:59:59.999Z`))) {
      throw new ConfigError(`${label}.expires must be a valid YYYY-MM-DD date`);
    }
    const normalized = {
      id: raw.id,
      ruleId: raw.ruleId.trim(),
      reason: raw.reason.trim(),
      expires: raw.expires,
      include: raw.include === undefined ? ["/**"] : stringArray(raw.include, `${label}.include`),
      exclude: raw.exclude === undefined ? [] : stringArray(raw.exclude, `${label}.exclude`),
    };
    for (const key of ["selector", "owner"]) {
      if (raw[key] !== undefined) {
        if (typeof raw[key] !== "string" || !raw[key].trim() || raw[key].length > 500) throw new ConfigError(`${label}.${key} must be a non-empty string up to 500 characters`);
        normalized[key] = raw[key].trim();
      }
    }
    return normalized;
  });
}

function validateQualityGate(value, source) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConfigError(`${source}.qualityGate must be an object`);
  assertKnownKeys(value, QUALITY_GATE_KEYS, `${source}.qualityGate`);
  if (!Object.keys(value).length) throw new ConfigError(`${source}.qualityGate must define at least one policy limit`);
  const normalized = {};
  if (value.minimumScore !== undefined) normalized.minimumScore = boundedInteger(value.minimumScore, `${source}.qualityGate.minimumScore`, 0, 100);
  if (value.minimumCoveragePercent !== undefined) normalized.minimumCoveragePercent = boundedInteger(value.minimumCoveragePercent, `${source}.qualityGate.minimumCoveragePercent`, 0, 100);
  if (value.maxWaivedFindings !== undefined) normalized.maxWaivedFindings = boundedInteger(value.maxWaivedFindings, `${source}.qualityGate.maxWaivedFindings`, 0, 100);
  return normalized;
}

function validateBaselinePolicy(value, source) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConfigError(`${source}.baselinePolicy must be an object`);
  assertKnownKeys(value, BASELINE_POLICY_KEYS, `${source}.baselinePolicy`);
  if (!Object.keys(value).length) throw new ConfigError(`${source}.baselinePolicy must define at least one policy`);
  const normalized = {};
  if (value.maxAgeDays !== undefined) normalized.maxAgeDays = boundedInteger(value.maxAgeDays, `${source}.baselinePolicy.maxAgeDays`, 1, 3650);
  if (value.requireSamePolicy !== undefined) {
    if (typeof value.requireSamePolicy !== "boolean") throw new ConfigError(`${source}.baselinePolicy.requireSamePolicy must be a boolean`);
    normalized.requireSamePolicy = value.requireSamePolicy;
  }
  if (normalized.maxAgeDays === undefined && normalized.requireSamePolicy !== true) throw new ConfigError(`${source}.baselinePolicy must set maxAgeDays or requireSamePolicy to true`);
  return normalized;
}

function validateOwners(value, source) {
  if (!Array.isArray(value)) throw new ConfigError(`${source}.owners must be an array`);
  if (value.length > 100) throw new ConfigError(`${source}.owners cannot contain more than 100 entries`);
  const ids = new Set();
  return value.map((raw, index) => {
    const label = `${source}.owners[${index}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ConfigError(`${label} must be an object`);
    assertKnownKeys(raw, OWNER_KEYS, label);
    if (typeof raw.id !== "string" || !/^[a-z][a-z0-9-]{1,63}$/.test(raw.id)) throw new ConfigError(`${label}.id must match ^[a-z][a-z0-9-]{1,63}$`);
    if (ids.has(raw.id)) throw new ConfigError(`${source}.owners contains duplicate id ${JSON.stringify(raw.id)}`);
    ids.add(raw.id);
    if (typeof raw.name !== "string" || !raw.name.trim() || raw.name.length > 200) throw new ConfigError(`${label}.name must be a non-empty string up to 200 characters`);
    return {
      id: raw.id,
      name: raw.name.trim(),
      ruleIds: raw.ruleIds === undefined ? [] : stringArray(raw.ruleIds, `${label}.ruleIds`),
      include: raw.include === undefined ? ["/**"] : stringArray(raw.include, `${label}.include`),
      exclude: raw.exclude === undefined ? [] : stringArray(raw.exclude, `${label}.exclude`),
    };
  });
}

export function validateProjectConfig(value, source = CONFIG_FILENAME) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError(`${source} must contain a JSON object`);
  }
  assertKnownKeys(value, TOP_LEVEL_KEYS, source);
  const normalized = {};
  if (value.$schema !== undefined) {
    if (typeof value.$schema !== "string") throw new ConfigError(`${source}.$schema must be a string`);
    normalized.$schema = value.$schema;
  }
  if (value.baseUrl !== undefined) {
    if (typeof value.baseUrl !== "string" || !value.baseUrl.trim()) throw new ConfigError(`${source}.baseUrl must be a non-empty string`);
    normalized.baseUrl = value.baseUrl.trim();
  }
  if (value.mode !== undefined) {
    if (!new Set(["quick", "deep"]).has(value.mode)) throw new ConfigError(`${source}.mode must be quick or deep`);
    normalized.mode = value.mode;
  }
  if (value.failOn !== undefined) {
    if (!new Set(["critical", "major", "minor", "never"]).has(value.failOn)) {
      throw new ConfigError(`${source}.failOn must be critical, major, minor, or never`);
    }
    normalized.failOn = value.failOn;
  }
  if (value.output !== undefined) {
    if (typeof value.output !== "string" || !value.output.trim()) throw new ConfigError(`${source}.output must be a non-empty string`);
    normalized.output = value.output.trim();
  }
  if (value.routes !== undefined) normalized.routes = stringArray(value.routes, `${source}.routes`);
  if (value.viewports !== undefined) normalized.viewports = validateViewports(value.viewports, source);
  if (value.checks !== undefined) normalized.checks = validateCustomChecks(value.checks, source);
  if (value.journeys !== undefined) normalized.journeys = validateJourneys(value.journeys, source);
  if (value.budgets !== undefined) normalized.budgets = validateBudgets(value.budgets, source);
  if (value.network !== undefined) normalized.network = validateNetworkPolicy(value.network, source);
  if (value.links !== undefined) normalized.links = validateLinkPolicy(value.links, source);
  if (value.metadata !== undefined) normalized.metadata = validateMetadataPolicy(value.metadata, source);
  if (value.visual !== undefined) normalized.visual = validateVisualPolicy(value.visual, source);
  if (value.security !== undefined) normalized.security = validateSecurityPolicy(value.security, source);
  if (value.privacy !== undefined) normalized.privacy = validatePrivacyPolicy(value.privacy, source);
  if (value.waivers !== undefined) normalized.waivers = validateWaivers(value.waivers, source);
  if (value.qualityGate !== undefined) normalized.qualityGate = validateQualityGate(value.qualityGate, source);
  if (value.baselinePolicy !== undefined) normalized.baselinePolicy = validateBaselinePolicy(value.baselinePolicy, source);
  if (value.owners !== undefined) normalized.owners = validateOwners(value.owners, source);
  if (value.crawl !== undefined) {
    if (!value.crawl || typeof value.crawl !== "object" || Array.isArray(value.crawl)) {
      throw new ConfigError(`${source}.crawl must be an object`);
    }
    assertKnownKeys(value.crawl, CRAWL_KEYS, `${source}.crawl`);
    normalized.crawl = {};
    if (value.crawl.enabled !== undefined) {
      if (typeof value.crawl.enabled !== "boolean") throw new ConfigError(`${source}.crawl.enabled must be a boolean`);
      normalized.crawl.enabled = value.crawl.enabled;
    }
    if (value.crawl.maxPages !== undefined) normalized.crawl.maxPages = boundedInteger(value.crawl.maxPages, `${source}.crawl.maxPages`, 1, 100);
    if (value.crawl.maxDepth !== undefined) normalized.crawl.maxDepth = boundedInteger(value.crawl.maxDepth, `${source}.crawl.maxDepth`, 0, 8);
    if (value.crawl.include !== undefined) normalized.crawl.include = stringArray(value.crawl.include, `${source}.crawl.include`);
    if (value.crawl.exclude !== undefined) normalized.crawl.exclude = stringArray(value.crawl.exclude, `${source}.crawl.exclude`);
  }
  return normalized;
}

export function discoverConfig(startDirectory = process.cwd()) {
  let current = resolve(startDirectory);
  while (true) {
    const candidate = join(current, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function loadProjectConfig(path, cwd = process.cwd()) {
  const discovered = path ? resolve(cwd, path) : discoverConfig(cwd);
  if (!discovered) return { path: null, directory: resolve(cwd), cwd: resolve(cwd), config: {} };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(discovered, "utf8"));
  } catch (error) {
    throw new ConfigError(`Could not read ${discovered}: ${error.message}`);
  }
  return {
    path: discovered,
    directory: dirname(discovered),
    cwd: resolve(cwd),
    config: validateProjectConfig(parsed, discovered),
  };
}

function resolveFrom(directory, value) {
  return isAbsolute(value) ? resolve(value) : resolve(directory, value);
}

export function mergeProjectOptions(cli, loaded) {
  const project = loaded.config;
  const crawl = { ...DEFAULT_PROJECT_CONFIG.crawl, ...(project.crawl || {}) };
  crawl.include = project.crawl?.include || DEFAULT_PROJECT_CONFIG.crawl.include;
  crawl.exclude = [...new Set([...DEFAULT_PROJECT_CONFIG.crawl.exclude, ...(project.crawl?.exclude || [])])];
  if (cli.crawl !== undefined) crawl.enabled = cli.crawl;
  if (cli.maxPages !== undefined) crawl.maxPages = boundedInteger(cli.maxPages, "--max-pages", 1, 100);
  if (cli.maxDepth !== undefined) crawl.maxDepth = boundedInteger(cli.maxDepth, "--max-depth", 0, 8);
  const routes = cli.routes?.length ? cli.routes : (project.routes || []);
  const outputValue = cli.output ?? project.output ?? DEFAULT_PROJECT_CONFIG.output;
  const storageStateValue = cli.storageState ?? process.env.REALITYCHECK_STORAGE_STATE ?? null;
  const outputBase = cli.output ? (loaded.cwd || process.cwd()) : loaded.directory;
  const storageStateBase = cli.storageState || process.env.REALITYCHECK_STORAGE_STATE ? (loaded.cwd || process.cwd()) : loaded.directory;
  return {
    ...cli,
    target: cli.target ?? project.baseUrl ?? null,
    mode: cli.mode ?? project.mode ?? DEFAULT_PROJECT_CONFIG.mode,
    failOn: cli.failOn ?? project.failOn ?? DEFAULT_PROJECT_CONFIG.failOn,
    output: resolveFrom(outputBase, outputValue),
    routes,
    viewports: structuredClone(project.viewports || DEFAULT_VIEWPORTS),
    crawl,
    checks: project.checks || [],
    journeys: project.journeys || [],
    budgets: project.budgets || null,
    network: project.network || null,
    links: project.links || null,
    metadata: project.metadata || null,
    visual: project.visual ? {
      ...project.visual,
      baselineDirectoryPath: resolveVisualBaselineDirectory(loaded.directory, project.visual.baselineDirectory),
    } : null,
    security: project.security || null,
    privacy: project.privacy || null,
    waivers: project.waivers || [],
    qualityGate: project.qualityGate || null,
    baselinePolicy: project.baselinePolicy || null,
    owners: project.owners || [],
    storageState: storageStateValue ? resolveFrom(storageStateBase, storageStateValue) : null,
    configPath: loaded.path,
  };
}

export function globToRegExp(pattern) {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      expression += ".*";
      index += 1;
    } else if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += character.replace(/[\\^$+.()|{}[\]]/g, "\\$&");
  }
  return new RegExp(`${expression}$`);
}

export function applyFindingWaivers(findings, target, waivers = [], now = new Date()) {
  const pathname = new URL(target).pathname;
  const expiredIds = new Set();
  let appliedCount = 0;
  for (const waiver of waivers) {
    if (new Date(`${waiver.expires}T23:59:59.999Z`) < now) expiredIds.add(waiver.id);
  }
  for (const finding of findings) {
    const matched = waivers.find((waiver) => {
      if (expiredIds.has(waiver.id) || waiver.ruleId !== finding.ruleId) return false;
      if (waiver.selector && waiver.selector !== finding.selector) return false;
      const included = waiver.include.some((pattern) => globToRegExp(pattern).test(pathname));
      const excluded = waiver.exclude.some((pattern) => globToRegExp(pattern).test(pathname));
      return included && !excluded;
    });
    if (!matched) continue;
    finding.waiver = {
      id: matched.id,
      reason: matched.reason,
      expires: matched.expires,
      ...(matched.owner ? { owner: matched.owner } : {}),
    };
    appliedCount += 1;
  }
  return { appliedCount, expiredIds: [...expiredIds].sort() };
}

export function applyFindingOwnership(findings, target, owners = []) {
  const pathname = new URL(target).pathname;
  let appliedCount = 0;
  let ambiguousCount = 0;
  for (const finding of findings) {
    const matches = owners.filter((owner) => {
      if (owner.ruleIds.length && !owner.ruleIds.includes(finding.ruleId)) return false;
      const included = owner.include.some((pattern) => globToRegExp(pattern).test(pathname));
      const excluded = owner.exclude.some((pattern) => globToRegExp(pattern).test(pathname));
      return included && !excluded;
    });
    if (matches.length > 1) {
      ambiguousCount += 1;
      continue;
    }
    if (matches.length === 1) {
      finding.ownership = { id: matches[0].id, name: matches[0].name };
      appliedCount += 1;
    }
  }
  return { appliedCount, ambiguousCount };
}

export function routeAllowed(pathname, crawl) {
  let decoded = pathname;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch (_) {
      break;
    }
  }
  decoded = decoded.replaceAll("\\", "/");
  if (/(?:^|\/)(?:logout|signout|delete|remove|unsubscribe|purchase|checkout|oauth)(?:\/|$)/i.test(decoded)) return false;
  const matches = (pattern, candidate) => globToRegExp(pattern).test(candidate)
    || (pattern.endsWith("/**") && candidate === pattern.slice(0, -3));
  const included = crawl.include.some((pattern) => matches(pattern, pathname) || matches(pattern, decoded));
  const excluded = crawl.exclude.some((pattern) => matches(pattern, pathname) || matches(pattern.toLowerCase(), decoded.toLowerCase()));
  return included && !excluded;
}

export function resolveRoute(baseUrl, route) {
  const base = new URL(baseUrl);
  const resolved = new URL(route, base);
  if (resolved.origin !== base.origin) throw new ConfigError(`Configured route must stay on ${base.origin}: ${route}`);
  resolved.hash = "";
  return resolved.toString();
}

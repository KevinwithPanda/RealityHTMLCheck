const CSP_DIRECTIVES = new Set(["default-src", "base-uri", "object-src", "form-action", "frame-ancestors", "script-src", "style-src", "img-src", "connect-src", "font-src", "media-src", "worker-src", "manifest-src"]);
const CSP_FORBIDDEN_TOKENS = new Set(["'unsafe-inline'", "'unsafe-eval'", "*", "data:", "http:"]);
const REFERRER_POLICIES = new Set(["no-referrer", "no-referrer-when-downgrade", "origin", "origin-when-cross-origin", "same-origin", "strict-origin", "strict-origin-when-cross-origin", "unsafe-url"]);
const PERMISSIONS_POLICY_FEATURES = new Set(["camera", "microphone", "geolocation", "payment", "usb", "fullscreen", "display-capture", "clipboard-read", "clipboard-write", "publickey-credentials-get", "screen-wake-lock", "accelerometer", "gyroscope", "magnetometer", "interest-cohort"]);

export const SECURITY_HEADER_POLICY_KEYS = Object.freeze(["contentSecurityPolicy", "strictTransportSecurity", "xContentTypeOptions", "referrerPolicy", "permissionsPolicy"]);
export const SUPPORTED_CSP_DIRECTIVES = Object.freeze([...CSP_DIRECTIVES]);
export const SUPPORTED_CSP_FORBIDDEN_TOKENS = Object.freeze([...CSP_FORBIDDEN_TOKENS]);
export const SUPPORTED_REFERRER_POLICIES = Object.freeze([...REFERRER_POLICIES]);
export const SUPPORTED_PERMISSIONS_POLICY_FEATURES = Object.freeze([...PERMISSIONS_POLICY_FEATURES]);

const POLICY_HEADERS = Object.freeze({
  contentSecurityPolicy: "content-security-policy",
  strictTransportSecurity: "strict-transport-security",
  xContentTypeOptions: "x-content-type-options",
  referrerPolicy: "referrer-policy",
  permissionsPolicy: "permissions-policy",
});

function normalizedHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [String(name).toLowerCase(), String(value ?? "")]));
}

function cspFacts(value, policy) {
  const directives = new Map();
  for (const segment of value.split(";")) {
    const tokens = segment.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const [name, ...sources] = tokens;
    if (!directives.has(name)) directives.set(name, []);
    directives.get(name).push(...sources);
  }
  const directiveNames = [...directives.keys()].filter((name) => CSP_DIRECTIVES.has(name)).sort();
  const missingDirectives = (policy.requiredDirectives || []).filter((name) => !directives.has(name));
  const configuredForbidden = new Set(policy.forbiddenTokens || []);
  const forbiddenTokens = [...new Set([...directives.values()].flat().filter((token) => configuredForbidden.has(token)))].sort();
  return {
    facts: { directiveNames, directiveCount: directiveNames.length, missingDirectives, forbiddenTokens },
    violations: [
      ...(missingDirectives.length ? ["missing-required-directive"] : []),
      ...(forbiddenTokens.length ? ["forbidden-source-token"] : []),
    ],
  };
}

function hstsFacts(value, policy) {
  const tokens = value.split(";").map((item) => item.trim()).filter(Boolean);
  const maxAgeToken = tokens.find((item) => /^max-age\s*=/i.test(item));
  const match = maxAgeToken?.match(/^max-age\s*=\s*(\d+)$/i);
  const maxAgeSeconds = match && Number.isSafeInteger(Number(match[1])) ? Number(match[1]) : null;
  const includeSubDomains = tokens.some((item) => /^includesubdomains$/i.test(item));
  const preload = tokens.some((item) => /^preload$/i.test(item));
  const violations = [];
  if (policy.minMaxAgeSeconds !== undefined && (maxAgeSeconds === null || maxAgeSeconds < policy.minMaxAgeSeconds)) violations.push("max-age-too-short");
  if (policy.requireIncludeSubDomains && !includeSubDomains) violations.push("include-subdomains-missing");
  if (policy.requirePreload && !preload) violations.push("preload-missing");
  return { facts: { maxAgeSeconds, includeSubDomains, preload }, violations };
}

function contentTypeFacts(value) {
  const nosniff = value.trim().toLowerCase() === "nosniff";
  return { facts: { nosniff }, violations: nosniff ? [] : ["nosniff-required"] };
}

function referrerFacts(value, policy) {
  const recognized = value.split(",").map((item) => item.trim().toLowerCase()).filter((item) => REFERRER_POLICIES.has(item));
  const effectiveValue = recognized.at(-1) || null;
  const allowed = new Set(policy.allowedValues || []);
  return {
    facts: { effectiveValue: effectiveValue || "unrecognized", recognizedValues: [...new Set(recognized)] },
    violations: effectiveValue && allowed.has(effectiveValue) ? [] : ["referrer-policy-not-allowed"],
  };
}

function permissionsFacts(value, policy) {
  const declarations = new Map();
  for (const segment of value.split(",")) {
    const match = segment.trim().match(/^([a-z0-9-]+)\s*=\s*(\(.*\))$/i);
    if (!match) continue;
    const feature = match[1].toLowerCase();
    if (!PERMISSIONS_POLICY_FEATURES.has(feature)) continue;
    declarations.set(feature, match[2].replace(/\s+/g, "") === "()");
  }
  const declaredFeatures = [...declarations.keys()].sort();
  const disabledFeatures = declaredFeatures.filter((feature) => declarations.get(feature));
  const missingDisabledFeatures = (policy.disabledFeatures || []).filter((feature) => !declarations.get(feature));
  return {
    facts: { declaredFeatures, disabledFeatures, missingDisabledFeatures },
    violations: missingDisabledFeatures.length ? ["feature-not-disabled"] : [],
  };
}

export function requiredSecurityHeaders(policy = {}) {
  const required = new Set(policy.requiredHeaders || []);
  for (const key of SECURITY_HEADER_POLICY_KEYS) if (policy.headerPolicies?.[key]) required.add(POLICY_HEADERS[key]);
  return [...required].sort();
}

export function evaluateSecurityHeaderPolicies(headers, policy = {}, { documentUrl = null } = {}) {
  const normalized = normalizedHeaders(headers);
  const configured = policy.headerPolicies || {};
  return SECURITY_HEADER_POLICY_KEYS.filter((key) => configured[key]).map((key) => {
    const header = POLICY_HEADERS[key];
    const value = normalized[header] || "";
    if (!value.trim()) return { key, header, present: false, passed: false, violations: ["missing-header"], facts: {} };
    const evaluation = key === "contentSecurityPolicy" ? cspFacts(value, configured[key])
      : key === "strictTransportSecurity" ? hstsFacts(value, configured[key])
        : key === "xContentTypeOptions" ? contentTypeFacts(value)
          : key === "referrerPolicy" ? referrerFacts(value, configured[key])
            : permissionsFacts(value, configured[key]);
    if (key === "strictTransportSecurity" && documentUrl) {
      const documentHttps = new URL(documentUrl).protocol === "https:";
      evaluation.facts.documentHttps = documentHttps;
      if (!documentHttps) evaluation.violations.unshift("https-required");
    }
    return { key, header, present: true, passed: evaluation.violations.length === 0, ...evaluation };
  });
}

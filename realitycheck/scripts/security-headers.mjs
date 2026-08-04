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
  return { facts: { maxAgeSeconds, requiredMinMaxAgeSeconds: policy.minMaxAgeSeconds ?? null, includeSubDomains, preload }, violations };
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
    facts: { effectiveValue: effectiveValue || "unrecognized", recognizedValues: [...new Set(recognized)], allowedValues: [...allowed].sort() },
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

function joined(values) {
  return (values || []).join(", ");
}

export function describeSecurityHeaderViolations(result, language = "en") {
  const zh = language === "zh-CN";
  const facts = result?.facts || {};
  return (result?.violations || []).map((code) => {
    if (code === "missing-header") return zh ? `缺少 ${result.header} 响应头` : `the ${result.header} header is missing`;
    if (code === "missing-required-directive") return zh ? `缺少必需的 CSP 指令：${joined(facts.missingDirectives)}` : `required CSP directives are missing: ${joined(facts.missingDirectives)}`;
    if (code === "forbidden-source-token") return zh ? `使用了禁用的 CSP 来源标记：${joined(facts.forbiddenTokens)}` : `forbidden CSP source tokens are present: ${joined(facts.forbiddenTokens)}`;
    if (code === "https-required") return zh ? "文档不是通过 HTTPS 提供，浏览器会忽略 HSTS" : "the document is not served over HTTPS, so the browser ignores HSTS";
    if (code === "max-age-too-short") return zh ? `HSTS max-age 为 ${facts.maxAgeSeconds ?? "无效"} 秒，低于要求的 ${facts.requiredMinMaxAgeSeconds ?? "已配置"} 秒` : `HSTS max-age is ${facts.maxAgeSeconds ?? "invalid"} seconds, below the required ${facts.requiredMinMaxAgeSeconds ?? "configured"} seconds`;
    if (code === "include-subdomains-missing") return zh ? "HSTS 缺少 includeSubDomains" : "HSTS is missing includeSubDomains";
    if (code === "preload-missing") return zh ? "HSTS 缺少 preload" : "HSTS is missing preload";
    if (code === "nosniff-required") return zh ? "X-Content-Type-Options 不是精确的 nosniff" : "X-Content-Type-Options is not exactly nosniff";
    if (code === "referrer-policy-not-allowed") return zh ? `有效 Referrer-Policy 为 ${facts.effectiveValue || "未识别"}，允许值为：${joined(facts.allowedValues)}` : `the effective Referrer-Policy is ${facts.effectiveValue || "unrecognized"}; allowed values are: ${joined(facts.allowedValues)}`;
    if (code === "feature-not-disabled") return zh ? `这些浏览器功能没有使用空允许列表：${joined(facts.missingDisabledFeatures)}` : `these browser features do not use an empty allowlist: ${joined(facts.missingDisabledFeatures)}`;
    return zh ? `未识别的受控违规类别：${code}` : `unrecognized controlled violation category: ${code}`;
  });
}

export function suggestSecurityHeaderFix(result, language = "en") {
  const zh = language === "zh-CN";
  const facts = result?.facts || {};
  if (result?.key === "contentSecurityPolicy") {
    const additions = facts.missingDirectives?.length ? (zh ? `加入必需指令 ${joined(facts.missingDirectives)}` : `add the required directives ${joined(facts.missingDirectives)}`) : null;
    const removals = facts.forbiddenTokens?.length ? (zh ? `移除禁用来源标记 ${joined(facts.forbiddenTokens)}` : `remove the forbidden source tokens ${joined(facts.forbiddenTokens)}`) : null;
    const action = [additions, removals].filter(Boolean).join(zh ? "；" : "; ");
    return zh ? `配置经过复核的 CSP：${action}。在预发布环境验证应用行为，不要复制宽松占位策略。` : `Configure a reviewed CSP: ${action}. Validate application behavior in staging instead of copying a permissive placeholder.`;
  }
  if (result?.key === "strictTransportSecurity") return zh ? `通过 HTTPS 提供此路由，并在可信边缘层把 HSTS max-age 设置为至少 ${facts.requiredMinMaxAgeSeconds ?? "策略要求的"} 秒，同时补齐策略要求的 includeSubDomains/preload。` : `Serve this route over HTTPS and set HSTS max-age to at least ${facts.requiredMinMaxAgeSeconds ?? "the policy-required"} seconds at the trusted edge, including the required includeSubDomains/preload flags.`;
  if (result?.key === "xContentTypeOptions") return zh ? "在最终文档响应上将 X-Content-Type-Options 精确设置为 nosniff。" : "Set X-Content-Type-Options to exactly nosniff on the final document response.";
  if (result?.key === "referrerPolicy") return zh ? `复核出站导航后，将 Referrer-Policy 设置为以下允许值之一：${joined(facts.allowedValues)}。` : `After reviewing outbound navigation, set Referrer-Policy to one of these allowed values: ${joined(facts.allowedValues)}.`;
  if (result?.key === "permissionsPolicy") return zh ? `确认业务不需要后，把这些功能设置为空允许列表 ()：${joined(facts.missingDisabledFeatures)}。` : `After confirming the route does not need them, set these features to the empty allowlist (): ${joined(facts.missingDisabledFeatures)}.`;
  return zh ? `配置经过复核的 ${result?.header || "安全"} 响应头策略。` : `Configure a reviewed ${result?.header || "security"} response-header policy.`;
}

const SAFE_EXCLUDES = Object.freeze([
  "/logout/**",
  "/signout/**",
  "/delete/**",
  "/remove/**",
  "/unsubscribe/**",
  "/purchase/**",
  "/checkout/**",
  "/oauth/**",
]);

export const PROFILE_NAMES = Object.freeze(["starter", "product", "strict"]);

export const PROFILE_DESCRIPTIONS = Object.freeze({
  starter: {
    en: "A fast first audit with safe links, essential metadata, and a forgiving score gate.",
    zh: "快速完成第一次核查，包含安全链接、基础元数据和宽松评分门禁。",
  },
  product: {
    en: "A balanced product-team policy with deep scenarios, crawl, performance, APIs, links, metadata, and security.",
    zh: "面向产品团队的均衡策略，覆盖深度场景、有限爬取、性能、API、链接、元数据与安全。",
  },
  strict: {
    en: "A demanding release policy for mature delivery pipelines; findings are expected during adoption.",
    zh: "面向成熟交付流水线的高要求发布策略；接入初期出现问题属于预期结果。",
  },
});

const COMMON = Object.freeze({
  failOn: "major",
  output: ".realitycheck/runs",
  routes: [],
  checks: [],
  journeys: [],
  waivers: [],
  owners: [],
});

const PROFILE_TEMPLATES = Object.freeze({
  starter: {
    ...COMMON,
    mode: "quick",
    viewports: [{ id: "mobile-375", width: 375, height: 812, touch: true }],
    crawl: { enabled: false, maxPages: 10, maxDepth: 2, include: ["/**"], exclude: SAFE_EXCLUDES },
    links: { severity: "major", maxFailures: 0, maxChecked: 25, timeoutMs: 5_000 },
    metadata: { severity: "major", titleMinLength: 1, titleMaxLength: 120, requireViewport: true, requireLang: true },
    qualityGate: { minimumScore: 80, minimumCoveragePercent: 80, maxWaivedFindings: 5 },
  },
  product: {
    ...COMMON,
    mode: "deep",
    viewports: [
      { id: "phone-360", width: 360, height: 800, touch: true },
      { id: "tablet-768", width: 768, height: 1024, touch: true },
    ],
    crawl: { enabled: true, maxPages: 20, maxDepth: 2, include: ["/**"], exclude: SAFE_EXCLUDES },
    budgets: {
      severity: "major",
      navigationMs: 4_000,
      domContentLoadedMs: 2_500,
      ttfbMs: 800,
      firstContentfulPaintMs: 1_800,
      largestContentfulPaintMs: 2_500,
      cumulativeLayoutShift: 0.1,
      requests: 100,
      transferKb: 2_000,
      domNodes: 2_000,
    },
    network: {
      severity: "major",
      scope: "api",
      maxHttpErrors: 0,
      maxFailedRequests: 0,
      slowRequestMs: 3_000,
      maxSlowRequests: 2,
      maxThirdPartyRequests: 20,
    },
    links: { severity: "major", maxFailures: 0, maxChecked: 75, timeoutMs: 5_000 },
    metadata: {
      severity: "major",
      titleMinLength: 5,
      titleMaxLength: 70,
      descriptionMinLength: 50,
      descriptionMaxLength: 180,
      requireCanonical: true,
      requireViewport: true,
      requireLang: true,
      forbidNoindex: true,
      requireSingleH1: true,
    },
    security: {
      severity: "major",
      requiredHeaders: ["x-content-type-options", "referrer-policy"],
      forbidMixedContent: true,
      secureForms: true,
      maxThirdPartyOrigins: 12,
    },
    qualityGate: { minimumScore: 90, minimumCoveragePercent: 100, maxWaivedFindings: 2 },
    baselinePolicy: { maxAgeDays: 30, requireSamePolicy: true },
  },
  strict: {
    ...COMMON,
    mode: "deep",
    viewports: [
      { id: "phone-320", width: 320, height: 700, touch: true },
      { id: "phone-390", width: 390, height: 844, touch: true },
      { id: "tablet-768", width: 768, height: 1024, touch: true },
    ],
    failOn: "minor",
    crawl: { enabled: true, maxPages: 50, maxDepth: 3, include: ["/**"], exclude: SAFE_EXCLUDES },
    budgets: {
      severity: "major",
      navigationMs: 3_000,
      domContentLoadedMs: 2_000,
      ttfbMs: 600,
      firstContentfulPaintMs: 1_500,
      largestContentfulPaintMs: 2_000,
      cumulativeLayoutShift: 0.05,
      requests: 70,
      transferKb: 1_200,
      domNodes: 1_500,
    },
    network: {
      severity: "major",
      scope: "all",
      maxHttpErrors: 0,
      maxFailedRequests: 0,
      slowRequestMs: 2_000,
      maxSlowRequests: 0,
      maxThirdPartyRequests: 10,
    },
    links: { severity: "major", maxFailures: 0, maxChecked: 100, timeoutMs: 5_000 },
    metadata: {
      severity: "major",
      titleMinLength: 10,
      titleMaxLength: 65,
      descriptionMinLength: 70,
      descriptionMaxLength: 170,
      requireCanonical: true,
      requireViewport: true,
      requireLang: true,
      forbidNoindex: true,
      requireSingleH1: true,
    },
    security: {
      severity: "major",
      requiredHeaders: [
        "content-security-policy",
        "strict-transport-security",
        "x-content-type-options",
        "referrer-policy",
        "permissions-policy",
      ],
      forbidMixedContent: true,
      secureForms: true,
      maxThirdPartyOrigins: 5,
    },
    qualityGate: { minimumScore: 95, minimumCoveragePercent: 100, maxWaivedFindings: 0 },
    baselinePolicy: { maxAgeDays: 14, requireSamePolicy: true },
  },
});

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (_) {
    throw new Error("--base-url must be an absolute HTTP or HTTPS URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("--base-url must use HTTP or HTTPS");
  if (url.username || url.password) throw new Error("--base-url must not contain credentials");
  if (url.search || url.hash) throw new Error("--base-url must not contain a query string or fragment");
  return url.toString();
}

export function buildProjectProfile(name = "starter", { baseUrl = "http://127.0.0.1:3000", schema } = {}) {
  if (!PROFILE_NAMES.includes(name)) throw new Error(`Unknown profile ${JSON.stringify(name)}; choose ${PROFILE_NAMES.join(", ")}`);
  if (typeof schema !== "string" || !schema.trim()) throw new Error("A config schema path is required");
  return {
    $schema: schema,
    baseUrl: normalizeBaseUrl(baseUrl),
    ...structuredClone(PROFILE_TEMPLATES[name]),
  };
}

export function formatProfileList() {
  const width = Math.max(...PROFILE_NAMES.map((name) => name.length));
  return PROFILE_NAMES.map((name) => `${name.padEnd(width)}  ${PROFILE_DESCRIPTIONS[name].en}\n${" ".repeat(width + 2)}${PROFILE_DESCRIPTIONS[name].zh}`).join("\n\n");
}

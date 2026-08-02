import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const CONFIG_FILENAME = "realitycheck.config.json";

export const DEFAULT_PROJECT_CONFIG = Object.freeze({
  $schema: "./node_modules/realitycheck-web-audit/realitycheck/assets/config.schema.json",
  baseUrl: "http://127.0.0.1:3000",
  mode: "quick",
  failOn: "major",
  output: ".realitycheck/runs",
  routes: [],
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
  waivers: [],
  owners: [],
});

const TOP_LEVEL_KEYS = new Set(["$schema", "baseUrl", "mode", "failOn", "output", "routes", "crawl", "checks", "budgets", "waivers", "qualityGate", "baselinePolicy", "owners"]);
const CRAWL_KEYS = new Set(["enabled", "maxPages", "maxDepth", "include", "exclude"]);
const CHECK_KEYS = new Set(["id", "selector", "assertion", "severity", "title", "titleZh", "remediation", "remediationZh", "include", "exclude", "options"]);
const CHECK_OPTION_KEYS = new Set(["min", "max", "attribute", "equals", "contains", "minWidth", "minHeight"]);
const CHECK_ASSERTIONS = new Set(["exists", "visible", "enabled", "accessible-name", "attribute", "count", "no-horizontal-overflow", "minimum-size"]);
const BUDGET_KEYS = new Set(["severity", "navigationMs", "domContentLoadedMs", "requests", "transferKb", "domNodes"]);
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

function validateBudgets(value, source) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConfigError(`${source}.budgets must be an object`);
  assertKnownKeys(value, BUDGET_KEYS, `${source}.budgets`);
  const normalized = { severity: value.severity ?? "major" };
  if (!new Set(["critical", "major", "minor"]).has(normalized.severity)) throw new ConfigError(`${source}.budgets.severity is not supported`);
  for (const key of ["navigationMs", "domContentLoadedMs", "requests", "transferKb", "domNodes"]) {
    if (value[key] !== undefined) normalized[key] = boundedInteger(value[key], `${source}.budgets.${key}`, 0, 10_000_000);
  }
  if (Object.keys(normalized).length === 1) throw new ConfigError(`${source}.budgets must define at least one numeric limit`);
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
  if (value.checks !== undefined) normalized.checks = validateCustomChecks(value.checks, source);
  if (value.budgets !== undefined) normalized.budgets = validateBudgets(value.budgets, source);
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
    crawl,
    checks: project.checks || [],
    budgets: project.budgets || null,
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

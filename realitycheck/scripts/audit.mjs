#!/usr/bin/env node

import { createRequire } from "node:module";
import { createHash, generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFIG_FILENAME,
  DEFAULT_PROJECT_CONFIG,
  ConfigError,
  applyFindingOwnership,
  applyFindingWaivers,
  loadProjectConfig,
  mergeProjectOptions,
  resolveRoute,
  routeAllowed,
} from "./config.mjs";
import { buildSiteReport, compareSiteReports, writeSiteReport, writeSiteVerification } from "./site-report.mjs";
import { printValidationResults, validateArtifactFiles } from "./artifact-validator.mjs";
import { buildArtifactCatalog, writeArtifactCatalog } from "./catalog.mjs";
import { buildLatestRun, updateLatestRunArtifacts, writeLatestRun } from "./latest-run.mjs";
import { writeEvidenceManifest } from "./evidence-manifest.mjs";
import { writeEvidenceAttestation } from "./evidence-attestation.mjs";
import { loadEvidenceTrustPolicy } from "./evidence-trust.mjs";
import { writeEvidenceTrustReport } from "./evidence-trust-report.mjs";
import { buildRiskRegister, writeRiskRegister } from "./risk-register.mjs";
import { detectorPolicyFingerprint } from "./policy-fingerprint.mjs";
import { PROFILE_DESCRIPTIONS, buildProjectProfile, formatProfileList } from "./profiles.mjs";
import { approveVisualBaseline, evaluateVisualRegression } from "./visual-regression.mjs";
import { startBundledDemoServer } from "./demo-server.mjs";
import { buildGitHubSummary, writeGitHubSummary } from "./github-summary.mjs";
import { buildPolicyReview, writePolicyReview } from "./policy-review.mjs";
import { buildIssueDrafts, writeIssueDrafts } from "./issue-drafts.mjs";
import { buildReleaseDecision, parseRequiredControls, releaseDecisionExitCode, writeReleaseDecision } from "./release-decision.mjs";
import { buildAuditPlan, writeAuditPlan } from "./audit-plan.mjs";
import { describeSecurityHeaderViolations, evaluateSecurityHeaderPolicies, requiredSecurityHeaders, suggestSecurityHeaderFix } from "./security-headers.mjs";

const require = createRequire(import.meta.url);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPORT_SCRIPT = join(SCRIPT_DIR, "report.py");
let activeDemoServer = null;

async function closeActiveDemoServer() {
  if (!activeDemoServer) return;
  const server = activeDemoServer;
  activeDemoServer = null;
  await server.close();
}
const FIXTURES = [
  "超长客户名称：上海现实检查与可靠性工程联合实验室",
  "订单状态：正在等待跨区域库存同步与最终人工复核",
  "Project-Aurora-Internationalization-Regression-Verification",
  "https://example.invalid/a/very/long/path/without/break/opportunities",
  "👩🏽‍💻🧪 RealityCheck 10,000,000.00",
];

function usage() {
  return `RealityCheck — break your localhost before your users do

Usage:
  realitycheck <url> [options]
  realitycheck audit <url> [options]
  realitycheck demo [--output PATH] [--headed] [--browser PATH]
  realitycheck init [--profile starter|product|strict] [--base-url URL] [--config PATH]
  realitycheck profiles
  realitycheck doctor [--config PATH]
  realitycheck plan [URL] [--config PATH] [--output PATH]
  realitycheck visual-approve <REPORT.JSON> [--config PATH] [--replace-baseline]
  realitycheck validate <FILE|DIRECTORY> [...]
  realitycheck catalog <FILE|DIRECTORY> [...] [--output PATH]
  realitycheck github-summary <FILE|DIRECTORY> [...] [--output PATH]
  realitycheck risk-register <FILE|DIRECTORY> [...] [--output PATH]
  realitycheck policy-review <BEFORE_CONFIG> <AFTER_CONFIG> [--output PATH]
  realitycheck issue-drafts <REPAIR_PLAN|DIRECTORY> [...] [--output PATH]
  realitycheck release-decision <ARTIFACT|DIRECTORY> [...] [--require audit,policy,trust] [--max-age-hours N] [--output PATH]
  realitycheck attest <EVIDENCE-MANIFEST> --private-key PATH
  realitycheck trust-report <EVIDENCE-MANIFEST> --trust-policy PATH

Options:
  --config PATH              Project config (auto-discovers realitycheck.config.json)
  --profile NAME             Init preset: starter, product, or strict
  --base-url URL             Init target origin or application root
  --mode quick|deep          Scenario set (default: quick)
  --fail-on LEVEL            critical|major|minor|never (default: major)
  --output PATH              Report root (default: .realitycheck/runs)
  --route PATH               Add an explicit same-origin route (repeatable)
  --crawl / --no-crawl       Discover safe same-origin links
  --max-pages NUMBER         Crawl limit, 1-100 (default: 10)
  --max-depth NUMBER         Link depth, 0-8 (default: 2)
  --storage-state PATH       Reuse Playwright auth state without persisting it
  --private-key PATH         Ed25519 private key for the attest command
  --trusted-key KEY_ID       Require an attestation signer key ID (repeatable)
  --require-attestation      Require and verify a signature beside every manifest
  --trust-policy PATH        Versioned evidence-trust.json key registry
  --max-open-age-days N      Risk gate: oldest open risk may be at most N days
  --max-open-risks N         Risk gate: allow at most N open risks
  --max-recurring-risks N    Risk gate: allow at most N recurring risks
  --max-annotations N        GitHub workflow annotations, 1-50 (default: 20)
  --max-age-hours N          Release evidence freshness limit, 1-8760 (default: 24)
  --require CONTROLS         Required release controls: audit,verification,policy,trust,risk,issues
  --language en|zh-CN        GitHub summary and annotation language
  --headed                   Show the browser while auditing
  --browser PATH             Chrome/Edge/Chromium executable
  --compare REPORT           Write verified before/after results beside the new report
  --baseline REPORT          Gate only regressions against a known-debt report
  --allow-remote             Confirm authorization for a public target
  --force                    Replace an existing config during init
  --replace-baseline         Explicitly replace an existing visual baseline
  -h, --help                 Show this help

Examples:
  realitycheck http://localhost:3000
  realitycheck demo
  realitycheck init
  realitycheck profiles
  realitycheck init --profile product --base-url http://localhost:3000
  realitycheck doctor
  realitycheck plan --config realitycheck.config.json --output .realitycheck/audit-plan
  realitycheck visual-approve .realitycheck/runs/RUN/report.json
  realitycheck validate .realitycheck/runs
  realitycheck catalog .realitycheck --output .realitycheck/catalog
  realitycheck github-summary .realitycheck/runs --output .realitycheck/github-summary.md
  realitycheck risk-register .realitycheck --output .realitycheck/risks
  realitycheck policy-review policy/main.json realitycheck.config.json --output .realitycheck/policy-review
  realitycheck issue-drafts .realitycheck --output .realitycheck/issue-drafts
  realitycheck release-decision .realitycheck --require audit,policy,trust --max-age-hours 24 --output .realitycheck/release
  realitycheck risk-register .realitycheck --max-open-age-days 30 --max-open-risks 20 --max-recurring-risks 10
  realitycheck attest .realitycheck/runs/RUN/evidence-manifest.json --private-key ci-ed25519.pem
  realitycheck validate .realitycheck/runs/RUN --trusted-key sha256:0123...
  realitycheck validate .realitycheck/runs/RUN --trust-policy evidence-trust.json
  realitycheck trust-report .realitycheck/runs/RUN/evidence-manifest.json --trust-policy evidence-trust.json
  realitycheck audit --crawl --max-pages 8
  realitycheck http://localhost:3000 --baseline .realitycheck/baseline/report.json
  realitycheck http://127.0.0.1:4173 --mode deep --fail-on major
  realitycheck http://localhost:3000 --compare .realitycheck/runs/BEFORE/report.json`;
}

function parseArguments(argv) {
  const args = [...argv];
  // npm consumes this conventional separator, while pnpm and some wrappers
  // forward it to the script. Accept it only before the command so a copied
  // `npm run realitycheck -- ...` invocation remains portable without
  // weakening option validation elsewhere in the argument list.
  if (args[0] === "--") args.shift();
  const command = new Set(["audit", "demo", "init", "profiles", "doctor", "plan", "visual-approve", "validate", "catalog", "github-summary", "risk-register", "policy-review", "issue-drafts", "release-decision", "attest", "trust-report"]).has(args[0]) ? args.shift() : "audit";
  const options = {
    command,
    target: null,
    mode: null,
    failOn: null,
    output: null,
    headed: false,
    browserPath: null,
    compareReport: null,
    baselineReport: null,
    allowRemote: false,
    config: null,
    routes: [],
    crawl: undefined,
    maxPages: undefined,
    maxDepth: undefined,
    storageState: null,
    force: false,
    profile: null,
    baseUrl: null,
    validationPaths: [],
    catalogPaths: [],
    githubSummaryPaths: [],
    riskRegisterPaths: [],
    policyReviewPaths: [],
    issueDraftPaths: [],
    releaseDecisionPaths: [],
    releaseRequired: null,
    releaseMaxAgeHours: null,
    attestationManifest: null,
    trustReportManifest: null,
    privateKey: null,
    trustedKeyIds: [],
    requireAttestation: false,
    trustPolicy: null,
    maxOpenAgeDays: null,
    maxOpenRisks: null,
    maxRecurringRisks: null,
    maxAnnotations: null,
    summaryLanguage: null,
    visualReport: null,
    replaceBaseline: false,
  };
  while (args.length) {
    const item = args.shift();
    if (item === "-h" || item === "--help") {
      console.log(usage());
      process.exit(0);
    }
    if (item === "--headed") {
      options.headed = true;
      continue;
    }
    if (item === "--allow-remote") {
      options.allowRemote = true;
      continue;
    }
    if (item === "--require-attestation") {
      options.requireAttestation = true;
      continue;
    }
    if (item === "--crawl" || item === "--no-crawl") {
      options.crawl = item === "--crawl";
      continue;
    }
    if (item === "--force") {
      options.force = true;
      continue;
    }
    if (item === "--replace-baseline") {
      options.replaceBaseline = true;
      continue;
    }
    if (["--mode", "--fail-on", "--output", "--browser", "--compare", "--baseline", "--config", "--profile", "--base-url", "--route", "--max-pages", "--max-depth", "--storage-state", "--private-key", "--trusted-key", "--trust-policy", "--max-open-age-days", "--max-open-risks", "--max-recurring-risks", "--max-annotations", "--max-age-hours", "--require", "--language"].includes(item)) {
      const value = args.shift();
      if (!value) throw new Error(`${item} requires a value`);
      if (item === "--mode") options.mode = value;
      if (item === "--fail-on") options.failOn = value;
      if (item === "--output") options.output = value;
      if (item === "--browser") options.browserPath = value;
      if (item === "--compare") options.compareReport = value;
      if (item === "--baseline") options.baselineReport = value;
      if (item === "--config") options.config = value;
      if (item === "--profile") options.profile = value;
      if (item === "--base-url") options.baseUrl = value;
      if (item === "--route") options.routes.push(value);
      if (item === "--storage-state") options.storageState = value;
      if (item === "--private-key") options.privateKey = value;
      if (item === "--trusted-key") options.trustedKeyIds.push(value);
      if (item === "--trust-policy") options.trustPolicy = value;
      if (item === "--language") options.summaryLanguage = value;
      if (item === "--require") options.releaseRequired = value;
      if (["--max-pages", "--max-depth", "--max-open-age-days", "--max-open-risks", "--max-recurring-risks", "--max-annotations", "--max-age-hours"].includes(item)) {
        const number = Number(value);
        if (!Number.isInteger(number)) throw new Error(`${item} requires an integer`);
        if (item === "--max-pages") options.maxPages = number;
        if (item === "--max-depth") options.maxDepth = number;
        if (item === "--max-open-age-days") options.maxOpenAgeDays = number;
        if (item === "--max-open-risks") options.maxOpenRisks = number;
        if (item === "--max-recurring-risks") options.maxRecurringRisks = number;
        if (item === "--max-annotations") options.maxAnnotations = number;
        if (item === "--max-age-hours") options.releaseMaxAgeHours = number;
      }
      continue;
    }
    if (item.startsWith("--")) throw new Error(`Unknown option: ${item}`);
    if (command === "validate") {
      options.validationPaths.push(item);
      continue;
    }
    if (command === "catalog") {
      options.catalogPaths.push(item);
      continue;
    }
    if (command === "github-summary") {
      options.githubSummaryPaths.push(item);
      continue;
    }
    if (command === "risk-register") {
      options.riskRegisterPaths.push(item);
      continue;
    }
    if (command === "policy-review") {
      options.policyReviewPaths.push(item);
      continue;
    }
    if (command === "issue-drafts") {
      options.issueDraftPaths.push(item);
      continue;
    }
    if (command === "release-decision") {
      options.releaseDecisionPaths.push(item);
      continue;
    }
    if (command === "attest") {
      if (options.attestationManifest) throw new Error(`Unexpected argument: ${item}`);
      options.attestationManifest = item;
      continue;
    }
    if (command === "trust-report") {
      if (options.trustReportManifest) throw new Error(`Unexpected argument: ${item}`);
      options.trustReportManifest = item;
      continue;
    }
    if (command === "visual-approve") {
      if (options.visualReport) throw new Error(`Unexpected argument: ${item}`);
      options.visualReport = item;
      continue;
    }
    if (command === "profiles") throw new Error(`Unexpected argument: ${item}`);
    if (options.target) throw new Error(`Unexpected argument: ${item}`);
    options.target = item;
  }
  if (options.mode && !new Set(["quick", "deep"]).has(options.mode)) {
    throw new Error("--mode must be quick or deep");
  }
  if (options.failOn && !new Set(["critical", "major", "minor", "never"]).has(options.failOn)) {
    throw new Error("--fail-on must be critical, major, minor, or never");
  }
  if (options.compareReport && options.baselineReport) throw new Error("Use either --compare or --baseline, not both");
  if (options.privateKey && command !== "attest") throw new Error("--private-key is only valid with attest");
  if (options.trustedKeyIds.length && !new Set(["validate", "attest"]).has(command)) throw new Error("--trusted-key is only valid with validate or attest");
  if (options.requireAttestation && command !== "validate") throw new Error("--require-attestation is only valid with validate");
  if (options.trustPolicy && !new Set(["validate", "attest", "trust-report"]).has(command)) throw new Error("--trust-policy is only valid with validate, attest, or trust-report");
  if (options.trustPolicy && options.trustedKeyIds.length) throw new Error("Use either --trust-policy or --trusted-key, not both");
  if ((options.maxOpenAgeDays !== null || options.maxOpenRisks !== null || options.maxRecurringRisks !== null) && command !== "risk-register") throw new Error("risk policy options are only valid with risk-register");
  if (options.maxAnnotations !== null && command !== "github-summary") throw new Error("--max-annotations is only valid with github-summary");
  if (options.summaryLanguage !== null && command !== "github-summary") throw new Error("--language is only valid with github-summary");
  if (options.summaryLanguage !== null && !new Set(["en", "zh-CN"]).has(options.summaryLanguage)) throw new Error("--language must be en or zh-CN");
  if (command === "policy-review" && options.policyReviewPaths.length !== 2) throw new Error("policy-review requires exactly BEFORE_CONFIG and AFTER_CONFIG");
  if (command === "issue-drafts" && !options.issueDraftPaths.length) throw new Error("issue-drafts requires at least one repair plan file or directory");
  if (command === "release-decision" && !options.releaseDecisionPaths.length) throw new Error("release-decision requires at least one artifact file or directory");
  if ((options.releaseRequired !== null || options.releaseMaxAgeHours !== null) && command !== "release-decision") throw new Error("--require and --max-age-hours are only valid with release-decision");
  if (options.releaseRequired !== null) parseRequiredControls(options.releaseRequired);
  if ((options.profile || options.baseUrl) && command !== "init") throw new Error("--profile and --base-url are only valid with init");
  if (options.replaceBaseline && command !== "visual-approve") throw new Error("--replace-baseline is only valid with visual-approve");
  return options;
}

function isPrivateTarget(target, allowRemote) {
  const url = new URL(target);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Target protocol must be http or https");
  }
  if (url.username || url.password) {
    throw new Error("Target URLs must not contain credentials");
  }
  let host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  const localName = host === "localhost" || [".localhost", ".local", ".test", ".internal"].some((suffix) => host.endsWith(suffix));
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  const ipv6 = host.includes(":");
  let privateAddress = ipv6 && (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd"));
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((part) => part > 255)) throw new Error("Target contains an invalid IP address");
    privateAddress = octets[0] === 10 || octets[0] === 127 || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168);
  }
  if (!localName && !privateAddress && !allowRemote) {
    throw new Error("Public or unresolved hosts require explicit authorization and --allow-remote");
  }
  return url.toString();
}

function loadPlaywright() {
  const resolvers = [require, createRequire(join(process.cwd(), "package.json"))];
  for (const resolver of resolvers) {
    for (const packageName of ["playwright-core", "playwright"]) {
      try {
        return resolver(packageName);
      } catch (_) {}
    }
  }
  throw new Error("Playwright Core is missing. Run npm install once, then retry.");
}

function commandPath(command) {
  const lookup = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookup, [command], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/).map((item) => item.trim()).find(Boolean) || null;
}

function browserExecutable(chromium, requestedPath) {
  const explicit = requestedPath || process.env.REALITYCHECK_BROWSER;
  if (explicit) {
    const candidate = resolve(explicit);
    if (!existsSync(candidate)) throw new Error(`Browser executable was not found: ${candidate}`);
    return candidate;
  }
  const bundled = chromium.executablePath();
  if (bundled && existsSync(bundled)) return bundled;
  const candidates = process.platform === "win32"
    ? [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      ]
    : process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
      : [
          commandPath("google-chrome"),
          commandPath("google-chrome-stable"),
          commandPath("microsoft-edge"),
          commandPath("chromium"),
          commandPath("chromium-browser"),
        ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("No supported Chrome, Edge, or Chromium executable was found. Pass --browser PATH.");
  }
  return found;
}

function pythonExecutable() {
  const candidates = [process.env.PYTHON, process.platform === "win32" ? "python" : "python3", "python"].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8", windowsHide: true });
    if (result.status === 0) return candidate;
  }
  throw new Error("Python 3.11 or newer is required to render the report");
}

function runReport(python, args, accepted = new Set([0])) {
  const result = spawnSync(python, [REPORT_SCRIPT, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
  });
  if (!accepted.has(result.status)) {
    throw new Error((result.stderr || result.stdout || "Report command failed").trim());
  }
  return result;
}

function initializeProjectConfig(options) {
  const destination = resolve(options.config || CONFIG_FILENAME);
  if (existsSync(destination) && !options.force) {
    throw new Error(`${destination} already exists; use --force to replace it`);
  }
  const schema = existsSync(resolve(dirname(destination), "realitycheck", "assets", "config.schema.json"))
    ? "./realitycheck/assets/config.schema.json"
    : DEFAULT_PROJECT_CONFIG.$schema;
  const profile = options.profile || "starter";
  const value = buildProjectProfile(profile, { baseUrl: options.baseUrl || DEFAULT_PROJECT_CONFIG.baseUrl, schema });
  writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  console.log(`Created ${destination}`);
  console.log(`Profile: ${profile} — ${PROFILE_DESCRIPTIONS[profile].en}`);
  console.log("Review baseUrl and safety exclusions, then run: realitycheck doctor && realitycheck audit");
}

function inspectStorageState(path) {
  if (!path) return null;
  if (!existsSync(path)) throw new Error("The configured Playwright storage state file was not found");
  let value;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`The Playwright storage state file is not valid JSON: ${error.message}`);
  }
  if (!value || typeof value !== "object" || !Array.isArray(value.cookies) || !Array.isArray(value.origins)) {
    throw new Error("The Playwright storage state must contain cookies and origins arrays");
  }
  return { cookies: value.cookies.length, origins: value.origins.length };
}

function policySettingCount(policy, omitted = new Set(["severity"])) {
  return Object.entries(policy || {}).reduce((total, [key, value]) => {
    if (omitted.has(key) || key.endsWith("Path")) return total;
    if (value && typeof value === "object" && !Array.isArray(value)) return total + policySettingCount(value, new Set());
    return total + 1;
  }, 0);
}

function runDoctor(options, loaded) {
  const checks = [];
  const check = (name, action) => {
    try {
      const detail = action();
      checks.push({ name, ok: true, detail });
    } catch (error) {
      checks.push({ name, ok: false, detail: error.message });
    }
  };
  check("Project config", () => loaded.path || "using built-in defaults");
  check("Node.js", () => `${process.version} (${process.execPath})`);
  let playwright;
  check("Playwright Core", () => {
    playwright = loadPlaywright();
    return "available";
  });
  check("Accessibility engine", () => `axe-core ${require("axe-core").version} bundled for deep mode`);
  check("Python report engine", () => pythonExecutable());
  check("Evidence signing", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Node.js did not produce an Ed25519 key");
    return "Ed25519 available; private keys remain outside generated evidence";
  });
  check("Evidence trust registry", () => {
    const assets = ["evidence-attestation.schema.json", "evidence-trust.schema.json", "evidence-trust-report.schema.json"];
    const missing = assets.filter((name) => !existsSync(join(SCRIPT_DIR, "..", "assets", name)));
    if (missing.length) throw new Error(`missing bundled schema(s): ${missing.join(", ")}`);
    return "versioned trusted/revoked key policy and independently verifiable decisions available";
  });
  check("Portfolio risk gates", () => "open-count, open-age, and recurring-risk limits available with durable multi-format output");
  if (playwright) check("Chrome / Edge / Chromium", () => browserExecutable(playwright.chromium, options.browserPath));
  if (options.target) check("Target authorization", () => isPrivateTarget(options.target, options.allowRemote));
  if (options.checks.length) check("Declarative checks", () => `${options.checks.length} validated rule(s); no executable code`);
  if (options.journeys.length) check("Safe user journeys", () => `${options.journeys.length} validated journey(s); same-origin, no form submission`);
  if (options.budgets) check("Performance budgets", () => `${Object.keys(options.budgets).length - 1} configured limit(s)`);
  if (options.network) check("Network reliability", () => `${Object.keys(options.network).filter((key) => key.startsWith("max")).length} configured ${options.network.scope} request limit(s); no response bodies or query values retained`);
  if (options.links) check("Link integrity", () => `HEAD-only checks capped at ${options.links.maxChecked} same-origin links; ${options.links.maxFailures} failure(s) allowed`);
  if (options.metadata) check("Publishing metadata", () => `${Object.keys(options.metadata).length - 1} explicit title/description/document rule(s); text values are not retained`);
  check("Responsive viewport matrix", () => `${options.viewports.length} bounded viewport(s): ${options.viewports.map((item) => `${item.id}=${item.width}x${item.height}${item.touch ? "/touch" : ""}`).join(", ")}`);
  if (options.visual) check("Visual regression", () => `${(options.visual.maxDiffRatio * 100).toFixed(3)}% changed-pixel limit; ${options.visual.masks.length} mask(s); baseline updates require visual-approve`);
  if (options.security) check("Security baseline", () => `${policySettingCount(options.security)} explicit policy setting(s); no form submission or raw semantic header retention`);
  if (options.privacy) check("Browser storage privacy", () => `${Object.keys(options.privacy).length - 1} aggregate cookie/Web Storage budget(s); no names, keys, or values retained`);
  if (options.waivers.length) check("Governed waivers", () => {
    const now = new Date();
    const expired = options.waivers.filter((waiver) => new Date(`${waiver.expires}T23:59:59.999Z`) < now);
    if (expired.length) throw new Error(`${expired.length} expired waiver(s): ${expired.map((waiver) => waiver.id).join(", ")}`);
    return `${options.waivers.length} active waiver(s) with mandatory reason and expiry`;
  });
  if (options.owners.length) check("Finding ownership", () => `${options.owners.length} validated route/rule ownership mapping(s)`);
  if (options.baselinePolicy) check("Baseline governance", () => [
    options.baselinePolicy.maxAgeDays ? `expire after ${options.baselinePolicy.maxAgeDays} day(s)` : null,
    options.baselinePolicy.requireSamePolicy ? "require the same detector policy" : null,
  ].filter(Boolean).join("; "));
  if (options.storageState) check("Authenticated state", () => {
    const metadata = inspectStorageState(options.storageState);
    return `valid structure (${metadata.cookies} cookies, ${metadata.origins} origins; values were not read into output)`;
  });
  const width = Math.max(...checks.map((item) => item.name.length));
  console.log("\nRealityCheck doctor\n");
  for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name.padEnd(width)}  ${item.detail}`);
  const failed = checks.filter((item) => !item.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  return failed ? 2 : 0;
}

async function settle(page, timeoutMs = 2500) {
  const started = Date.now();
  let stable = 0;
  let previous = null;
  let latest = null;
  while (Date.now() - started < timeoutMs) {
    latest = await page.evaluate(() => ({
      text: (document.body?.innerText || "").trim().length,
      height: document.documentElement.scrollHeight,
      elements: Math.min(2000, document.querySelectorAll("*").length),
      interactive: document.querySelectorAll("a[href],button,input,select,textarea,[role=button]").length,
    }));
    if (previous && JSON.stringify(previous) === JSON.stringify(latest)) stable += 1;
    else stable = 0;
    if (stable >= 2) return { settled: true, measurements: latest };
    previous = latest;
    await page.waitForTimeout(170);
  }
  return { settled: false, measurements: latest };
}

async function inspectAsyncState(page) {
  return page.evaluate(() => {
    const bodyText = (document.body?.innerText || "").trim();
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const semanticSignals = [...document.querySelectorAll('[aria-busy="true"],[role="progressbar"],progress,[class*="spinner" i],[class*="loader" i],[class*="loading" i]')]
      .filter(visible)
      .slice(0, 20)
      .map((element) => (element.getAttribute("aria-label") || element.textContent || element.tagName).trim().slice(0, 100));
    const textSignal = bodyText.match(/\b(loading|syncing|fetching|please wait)\b|加载中|同步中|请稍候/i)?.[0] || null;
    return {
      visibleTextLength: bodyText.length,
      dataRows: document.querySelectorAll("tbody tr,[role=rowgroup] [role=row]").length,
      interactive: document.querySelectorAll("a[href],button,input,select,textarea,[role=button]").length,
      loadingSignals: [...new Set([...semanticSignals, ...(textSignal ? [textSignal] : [])])],
    };
  });
}

async function inspectLayout(page) {
  return page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const selectorFor = (element) => {
      const testId = element.getAttribute("data-testid");
      if (testId) {
        const candidate = `[data-testid="${CSS.escape(testId)}"]`;
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      }
      if (element.id) {
        const candidate = `#${CSS.escape(element.id)}`;
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      }
      const classes = [...element.classList].filter((item) => /^[a-zA-Z][\w-]{0,48}$/.test(item)).slice(0, 2);
      if (classes.length) {
        const candidate = `${element.tagName.toLowerCase()}.${classes.map((item) => CSS.escape(item)).join(".")}`;
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      }
      const parts = [];
      let current = element;
      while (current && current !== document.body && parts.length < 6) {
        let part = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (parent) {
          const siblings = [...parent.children].filter((item) => item.tagName === current.tagName);
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
        parts.unshift(part);
        current = parent;
      }
      return `body > ${parts.join(" > ")}`;
    };
    const all = [...document.querySelectorAll("*")].slice(0, 2000);
    const clipped = [];
    for (const element of all) {
      if (clipped.length >= 40 || !visible(element) || element.children.length > 0) continue;
      const text = (element.textContent || "").trim();
      if (!text) continue;
      const style = getComputedStyle(element);
      const horizontal = element.scrollWidth > element.clientWidth + 2 && ["hidden", "clip"].includes(style.overflowX);
      const vertical = element.scrollHeight > element.clientHeight + 2 && ["hidden", "clip"].includes(style.overflowY);
      if (!horizontal && !vertical) continue;
      clipped.push({
        selector: selectorFor(element),
        text: text.slice(0, 200),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        clippedPixels: Math.max(element.scrollWidth - element.clientWidth, element.scrollHeight - element.clientHeight),
      });
    }
    const controls = [];
    for (const element of [...document.querySelectorAll("button,input,select,textarea,a[href],[role=button]")].slice(0, 300)) {
      if (!visible(element) || element.disabled) continue;
      const rect = element.getBoundingClientRect();
      const horizontallyOffscreen = rect.right <= 0 || rect.left >= viewportWidth;
      const verticallyOffscreen = rect.bottom <= 0 || rect.top >= viewportHeight;
      const labelledBy = (element.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent || "").join(" ").trim();
      const labelText = [...(element.labels || [])].map((label) => label.textContent || "").join(" ").trim();
      const clone = element.cloneNode(true);
      clone.querySelectorAll?.('[aria-hidden="true"],script,style').forEach((node) => node.remove());
      const contentText = (clone.textContent || "").trim();
      const inputValue = element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type) ? element.value : "";
      const accessibleName = (element.getAttribute("aria-label") || labelledBy || labelText || element.getAttribute("alt") || element.getAttribute("title") || contentText || inputValue || element.getAttribute("placeholder") || "").trim();
      controls.push({
        selector: selectorFor(element),
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role"),
        name: accessibleName.slice(0, 120),
        hasAccessibleName: Boolean(accessibleName),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), right: Math.round(rect.right), bottom: Math.round(rect.bottom) },
        offscreen: horizontallyOffscreen,
        horizontallyOffscreen,
        verticallyOffscreen,
      });
    }
    const images = [...document.querySelectorAll("img")].slice(0, 200).map((element) => ({
      selector: selectorFor(element),
      altPresent: element.hasAttribute("alt"),
      alt: element.getAttribute("alt"),
      renderedWidth: Math.round(element.getBoundingClientRect().width),
      renderedHeight: Math.round(element.getBoundingClientRect().height),
    }));
    const headingSamples = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(visible).slice(0, 100).map((element) => ({
      selector: selectorFor(element),
      level: Number(element.tagName.slice(1)),
      text: (element.textContent || "").trim().slice(0, 120),
    }));
    const headingSkips = [];
    for (let index = 1; index < headingSamples.length; index += 1) {
      if (headingSamples[index].level > headingSamples[index - 1].level + 1) {
        headingSkips.push({ previous: headingSamples[index - 1], current: headingSamples[index] });
      }
    }
    const idCounts = new Map();
    for (const element of all) if (element.id) idCounts.set(element.id, (idCounts.get(element.id) || 0) + 1);
    const duplicateIds = [...idCounts].filter(([, count]) => count > 1).slice(0, 10).map(([id, count]) => ({ id, count }));
    const overflowPixels = Math.max(0, document.documentElement.scrollWidth - viewportWidth);
    const culprits = all.filter(visible).map((element) => {
      const rect = element.getBoundingClientRect();
      return { element, rect };
    }).filter(({ rect }) => rect.right > viewportWidth + 2 || rect.left < -2 || rect.width > viewportWidth + 2).slice(0, 10).map(({ element, rect }) => ({
      selector: selectorFor(element),
      rect: { x: Math.round(rect.x), width: Math.round(rect.width), right: Math.round(rect.right) },
    }));
    return {
      viewportWidth,
      viewportHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      documentScrollHeight: document.documentElement.scrollHeight,
      overflowPixels,
      culprits,
      clipped,
      controls,
      images,
      documentMetadata: {
        language: (document.documentElement.lang || "").trim(),
        title: (document.title || "").trim(),
        headingSamples,
        headingSkips: headingSkips.slice(0, 5),
        duplicateIds,
      },
      visibleTextLength: (document.body?.innerText || "").trim().length,
    };
  });
}

function screenshotEvidence(scenarioId, label) {
  return { type: "screenshot", path: `screenshots/${scenarioId}.png`, label };
}

function finding({ ruleId, scenarioId, classification, severity, confidence, title, titleZh, summary, summaryZh, selector, measurements, evidence, steps, stepsZh, fix, fixZh, hints = [], hintsZh = [] }) {
  const value = {
    ruleId,
    scenarioId,
    classification,
    severity,
    confidence,
    title,
    summary,
    url: "",
    measurements,
    evidence,
    reproductionSteps: steps,
    remediation: { summary: fix, technicalHints: hints },
    translations: {
      "zh-CN": {
        title: titleZh,
        summary: summaryZh,
        reproductionSteps: stepsZh,
        remediation: { summary: fixZh, technicalHints: hintsZh },
      },
    },
  };
  if (selector) value.selector = selector;
  return value;
}

function scenarioResult(id, status, durationMs, notes = [], notesZh = []) {
  return { id, status, durationMs, notes, translations: { "zh-CN": { notes: notesZh } } };
}

async function createPage(browser, target, scenarioId, runDirectory, options = {}) {
  const started = Date.now();
  const contextOptions = {
    viewport: options.viewport || { width: 1440, height: 900 },
    serviceWorkers: "block",
    locale: "en-US",
  };
  if (options.storageState) contextOptions.storageState = options.storageState;
  if (options.reducedMotion) contextOptions.reducedMotion = options.reducedMotion;
  if (options.colorScheme) contextOptions.colorScheme = options.colorScheme;
  const context = await browser.newContext(contextOptions);
  await context.addInitScript(() => {
    const vitals = { largestContentfulPaintMs: 0, cumulativeLayoutShift: 0 };
    Object.defineProperty(window, "__realitycheckVitals", { value: vitals, configurable: false, enumerable: false });
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries.at(-1);
        if (last) vitals.largestContentfulPaintMs = Math.round(last.startTime);
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch (_) {
      // The metric remains zero when this browser does not expose LCP.
    }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) vitals.cumulativeLayoutShift += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch (_) {
      // The metric remains zero when this browser does not expose LayoutShift.
    }
  });
  if (options.route) await options.route(context);
  const page = await context.newPage();
  const runtime = { consoleErrors: [], pageErrors: [], failedRequests: [], httpErrors: [], requests: [] };
  const requestRecords = new WeakMap();
  page.on("request", (request) => {
    if (runtime.requests.length >= 5_000) return;
    const record = {
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      startedAt: Date.now(),
      durationMs: null,
      status: null,
      failed: false,
    };
    runtime.requests.push(record);
    requestRecords.set(request, record);
  });
  page.on("console", (message) => {
    if (message.type() === "error" && runtime.consoleErrors.length < 500) runtime.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    if (runtime.pageErrors.length < 100) runtime.pageErrors.push(String(error.message || error));
  });
  page.on("requestfailed", (request) => {
    const record = requestRecords.get(request);
    if (record) {
      record.durationMs = Math.max(0, Date.now() - record.startedAt);
      record.failed = true;
    }
    if (runtime.failedRequests.length < 1000 && !options.expectedFailure?.(request)) {
      runtime.failedRequests.push({ url: networkEvidenceUrl(request.url()), resourceType: request.resourceType(), error: request.failure()?.errorText || "failed" });
    }
  });
  page.on("requestfinished", (request) => {
    const record = requestRecords.get(request);
    if (record) record.durationMs = Math.max(0, Date.now() - record.startedAt);
  });
  page.on("response", (response) => {
    const record = requestRecords.get(response.request());
    if (record) record.status = response.status();
    if (runtime.httpErrors.length < 1000 && response.status() >= 400) runtime.httpErrors.push({
      url: networkEvidenceUrl(response.url()),
      status: response.status(),
      method: response.request().method(),
      resourceType: response.request().resourceType(),
    });
  });
  const response = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 20000 });
  await settle(page);
  const screenshotPath = join(runDirectory, "screenshots", `${scenarioId}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return { context, page, runtime, response, durationMs: () => Date.now() - started, screenshotPath };
}

const NON_PAGE_EXTENSION = /\.(?:7z|avi|csv|docx?|dmg|exe|gif|jpe?g|json|mov|mp3|mp4|pdf|png|pptx?|rar|svg|tar|tgz|txt|webm|webp|xlsx?|xml|zip)$/i;

function canonicalDiscoveredUrl(candidate, origin) {
  try {
    const url = new URL(candidate);
    if (url.origin !== origin || !["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password || NON_PAGE_EXTENSION.test(url.pathname)) return null;
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch (_) {
    return null;
  }
}

async function discoverAuditTargets(browser, options) {
  const base = new URL(options.target);
  const warnings = [];
  const seeds = [options.target];
  for (const route of options.routes) {
    const url = resolveRoute(options.target, route);
    const pathname = new URL(url).pathname;
    if (!routeAllowed(pathname, options.crawl)) {
      throw new ConfigError(`Configured route is excluded by the crawl safety policy: ${pathname}`);
    }
    if (!seeds.includes(url)) seeds.push(url);
  }
  if (!options.crawl.enabled && seeds.length === 1) {
    return { urls: seeds, visited: 1, discovered: 0, truncated: false, warnings };
  }
  const queue = seeds.map((url) => ({ url, depth: 0 }));
  const queued = new Set(queue.map((item) => item.url));
  const urls = [];
  while (queue.length && urls.length < options.crawl.maxPages) {
    const current = queue.shift();
    urls.push(current.url);
    if (!options.crawl.enabled || current.depth >= options.crawl.maxDepth) continue;
    const contextOptions = {
      viewport: { width: 1440, height: 900 },
      serviceWorkers: "block",
      locale: "en-US",
    };
    if (options.storageState) contextOptions.storageState = options.storageState;
    const context = await browser.newContext(contextOptions);
    try {
      const page = await context.newPage();
      const response = await page.goto(current.url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await settle(page, 1_500);
      const contentType = response?.headers()["content-type"] || "";
      if (response && contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
        warnings.push(`Skipped link discovery for ${new URL(current.url).pathname}: response was ${contentType.split(";")[0]}.`);
        continue;
      }
      const links = await page.locator("a[href]").evaluateAll((anchors) => anchors.slice(0, 1_000).map((anchor) => anchor.href));
      for (const candidate of links) {
        const normalized = canonicalDiscoveredUrl(candidate, base.origin);
        if (!normalized || queued.has(normalized)) continue;
        if (!routeAllowed(new URL(normalized).pathname, options.crawl)) continue;
        queued.add(normalized);
        queue.push({ url: normalized, depth: current.depth + 1 });
      }
    } catch (error) {
      const detail = String(error.message || error).replaceAll(current.url, "[page]").slice(0, 320);
      warnings.push(`Could not discover links on ${new URL(current.url).pathname}: ${detail}`);
    } finally {
      await context.close();
    }
  }
  return {
    urls,
    visited: urls.length,
    discovered: Math.max(0, queued.size - seeds.length),
    truncated: queue.length > 0,
    warnings,
  };
}

function buildSiteRunId(target, startedAt) {
  const stamp = startedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const suffix = createHash("sha256").update(`${target}\n${startedAt.toISOString()}`).digest("hex").slice(0, 6);
  return `${stamp}-${suffix}-site`;
}

async function runCustomChecks(page, checks) {
  const findings = [];
  for (const check of checks) {
    let result;
    try {
      result = await page.evaluate((rule) => {
        const visible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0;
        };
        const accessibleName = (element) => {
          const labelledBy = (element.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)
            .map((id) => document.getElementById(id)?.textContent || "").join(" ").trim();
          const labelText = [...(element.labels || [])].map((label) => label.textContent || "").join(" ").trim();
          const clone = element.cloneNode(true);
          clone.querySelectorAll?.('[aria-hidden="true"],script,style').forEach((node) => node.remove());
          const contentText = (clone.textContent || "").trim();
          const inputValue = element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type) ? element.value : "";
          return (element.getAttribute("aria-label") || labelledBy || labelText || element.getAttribute("alt") || element.getAttribute("title") || contentText || inputValue || element.getAttribute("placeholder") || "").trim();
        };
        const nodes = [...document.querySelectorAll(rule.selector)].slice(0, 500);
        const options = rule.options || {};
        const samples = nodes.slice(0, 20).map((element, index) => {
          const rect = element.getBoundingClientRect();
          const attribute = options.attribute ? element.getAttribute(options.attribute) : null;
          return {
            index,
            visible: visible(element),
            enabled: !element.disabled && element.getAttribute("aria-disabled") !== "true",
            hasAccessibleName: Boolean(accessibleName(element)),
            hasAttribute: options.attribute ? element.hasAttribute(options.attribute) : null,
            attributeMatches: options.attribute
              ? element.hasAttribute(options.attribute)
                && (options.equals === undefined || attribute === options.equals)
                && (options.contains === undefined || (attribute || "").includes(options.contains))
              : null,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            overflowX: Math.max(0, element.scrollWidth - element.clientWidth),
          };
        });
        const minimum = options.min ?? 1;
        const maximum = options.max ?? Number.MAX_SAFE_INTEGER;
        let violationIndexes = [];
        let passed = false;
        if (rule.assertion === "exists") passed = nodes.length >= minimum;
        if (rule.assertion === "visible") {
          violationIndexes = samples.filter((item) => !item.visible).map((item) => item.index);
          passed = nodes.length >= minimum && nodes.filter(visible).length >= minimum;
        }
        if (rule.assertion === "enabled") {
          violationIndexes = samples.filter((item) => !item.enabled).map((item) => item.index);
          passed = nodes.length >= minimum && nodes.filter((element) => !element.disabled && element.getAttribute("aria-disabled") !== "true").length >= minimum;
        }
        if (rule.assertion === "accessible-name") {
          violationIndexes = samples.filter((item) => !item.hasAccessibleName).map((item) => item.index);
          passed = nodes.length >= minimum && nodes.every((element) => Boolean(accessibleName(element)));
        }
        if (rule.assertion === "attribute") {
          violationIndexes = samples.filter((item) => !item.attributeMatches).map((item) => item.index);
          passed = nodes.length >= minimum && nodes.every((element) => {
            const value = element.getAttribute(options.attribute);
            return element.hasAttribute(options.attribute)
              && (options.equals === undefined || value === options.equals)
              && (options.contains === undefined || (value || "").includes(options.contains));
          });
        }
        if (rule.assertion === "count") passed = nodes.length >= (options.min ?? 0) && nodes.length <= maximum;
        if (rule.assertion === "no-horizontal-overflow") {
          violationIndexes = samples.filter((item) => item.overflowX > 2).map((item) => item.index);
          passed = nodes.length >= minimum && nodes.every((element) => element.scrollWidth <= element.clientWidth + 2);
        }
        if (rule.assertion === "minimum-size") {
          const minWidth = options.minWidth ?? 44;
          const minHeight = options.minHeight ?? 44;
          violationIndexes = samples.filter((item) => item.visible && (item.width < minWidth || item.height < minHeight)).map((item) => item.index);
          passed = nodes.length >= minimum && nodes.filter(visible).every((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width >= minWidth && rect.height >= minHeight;
          });
        }
        return {
          passed,
          count: nodes.length,
          visibleCount: nodes.filter(visible).length,
          violationIndexes,
          samples: samples.map(({ index, visible: isVisible, enabled, hasAccessibleName, hasAttribute, attributeMatches, width, height, overflowX }) => ({ index, visible: isVisible, enabled, hasAccessibleName, hasAttribute, attributeMatches, width, height, overflowX })),
        };
      }, check);
    } catch (error) {
      throw new ConfigError(`Custom check ${check.id} could not evaluate selector ${JSON.stringify(check.selector)}: ${error.message}`);
    }
    if (result.passed) continue;
    const defaultTitle = `Custom requirement failed: ${check.id}`;
    const defaultTitleZh = `自定义要求未通过：${check.id}`;
    findings.push(finding({
      ruleId: `custom-${check.id}`,
      scenarioId: "baseline",
      classification: "existing",
      severity: check.severity,
      confidence: "high",
      title: check.title || defaultTitle,
      titleZh: check.titleZh || check.title || defaultTitleZh,
      summary: `The declarative ${check.assertion} assertion did not hold for ${check.selector}.`,
      summaryZh: `针对 ${check.selector} 的声明式 ${check.assertion} 断言未满足。`,
      selector: check.selector,
      measurements: {
        assertion: check.assertion,
        count: result.count,
        visibleCount: result.visibleCount,
        violationCount: result.violationIndexes.length,
        samples: result.samples,
      },
      evidence: [
        { type: "custom-check", selector: check.selector, assertion: check.assertion, violationIndexes: result.violationIndexes },
        screenshotEvidence("baseline", "Baseline custom requirement"),
      ],
      steps: ["Open the page in a clean baseline context.", `Evaluate the configured ${check.assertion} assertion for ${check.selector}.`],
      stepsZh: ["在干净的基线上下文中打开页面。", `对 ${check.selector} 执行已配置的 ${check.assertion} 断言。`],
      fix: check.remediation || "Restore the declared project requirement without weakening the custom check.",
      fixZh: check.remediationZh || check.remediation || "恢复项目声明的要求，不要通过削弱自定义检查来通过门禁。",
      hints: [`Rule source: realitycheck.config.json#checks/${check.id}`],
      hintsZh: [`规则来源：realitycheck.config.json#checks/${check.id}`],
    }));
  }
  return findings;
}

async function runPerformanceBudgets(page, budgets) {
  if (!budgets) return [];
  const metrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const resources = performance.getEntriesByType("resource");
    const firstContentfulPaint = performance.getEntriesByName("first-contentful-paint")[0];
    const observedVitals = window.__realitycheckVitals || {};
    const navigationMs = navigation ? (navigation.loadEventEnd || navigation.duration || 0) : 0;
    const domContentLoadedMs = navigation ? (navigation.domContentLoadedEventEnd || 0) : 0;
    const transferBytes = (navigation?.transferSize || 0) + resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0);
    return {
      navigationMs: Math.round(navigationMs),
      domContentLoadedMs: Math.round(domContentLoadedMs),
      ttfbMs: Math.round(navigation?.responseStart || 0),
      firstContentfulPaintMs: Math.round(firstContentfulPaint?.startTime || 0),
      largestContentfulPaintMs: Math.round(observedVitals.largestContentfulPaintMs || 0),
      cumulativeLayoutShift: Number((observedVitals.cumulativeLayoutShift || 0).toFixed(4)),
      requests: resources.length + (navigation ? 1 : 0),
      transferKb: Math.round(transferBytes / 1024),
      domNodes: document.querySelectorAll("*").length,
    };
  });
  const definitions = {
    navigationMs: { title: "Page navigation exceeds its performance budget", titleZh: "页面导航超过性能预算", unit: "ms" },
    domContentLoadedMs: { title: "DOMContentLoaded exceeds its performance budget", titleZh: "DOMContentLoaded 超过性能预算", unit: "ms" },
    ttfbMs: { title: "Time to First Byte exceeds its performance budget", titleZh: "首字节时间超过性能预算", unit: "ms" },
    firstContentfulPaintMs: { title: "First Contentful Paint exceeds its performance budget", titleZh: "首次内容绘制超过性能预算", unit: "ms" },
    largestContentfulPaintMs: { title: "Largest Contentful Paint exceeds its performance budget", titleZh: "最大内容绘制超过性能预算", unit: "ms" },
    cumulativeLayoutShift: { title: "Cumulative Layout Shift exceeds its performance budget", titleZh: "累积布局偏移超过性能预算", unit: "score" },
    requests: { title: "Request count exceeds its performance budget", titleZh: "请求数量超过性能预算", unit: "requests" },
    transferKb: { title: "Transferred bytes exceed the performance budget", titleZh: "传输体积超过性能预算", unit: "KiB" },
    domNodes: { title: "DOM size exceeds its performance budget", titleZh: "DOM 规模超过性能预算", unit: "nodes" },
  };
  const findings = [];
  for (const [key, definition] of Object.entries(definitions)) {
    const limit = budgets[key];
    if (limit === undefined || metrics[key] <= limit) continue;
    findings.push(finding({
      ruleId: `performance-budget-${key}`, scenarioId: "baseline", classification: "existing", severity: budgets.severity, confidence: "high",
      title: definition.title, titleZh: definition.titleZh,
      summary: `Measured ${metrics[key]} ${definition.unit}, above the configured limit of ${limit} ${definition.unit}.`, summaryZh: `测量值为 ${metrics[key]} ${definition.unit}，超过配置上限 ${limit} ${definition.unit}。`,
      measurements: { metric: key, actual: metrics[key], limit, unit: definition.unit, allBaselineMetrics: metrics },
      evidence: [{ type: "performance", metric: key, actual: metrics[key], limit, unit: definition.unit }, screenshotEvidence("baseline", "Baseline performance budget")],
      steps: ["Open the page in a fresh browser context with an empty cache.", `Measure ${key} from the browser Performance API after the page settles.`],
      stepsZh: ["在缓存为空的新浏览器上下文中打开页面。", `页面稳定后从浏览器 Performance API 测量 ${key}。`],
      fix: "Reduce the measured application-owned cost or revise the budget only with documented product approval.", fixZh: "降低测得的应用自身开销；只有获得有记录的产品批准后才能调整预算。",
      hints: ["Use the recorded baseline metrics to identify whether network weight, request fan-out, or DOM size is the dominant cost."], hintsZh: ["利用记录的基线指标判断主要成本来自网络体积、请求扩散还是 DOM 规模。"],
    }));
  }
  return findings;
}

const API_RESOURCE_TYPES = new Set(["xhr", "fetch"]);

function networkEvidenceUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch (_) {
    return "[unparseable URL]";
  }
}

function networkSample(record) {
  const url = networkEvidenceUrl(record.url);
  let origin = "unknown";
  try { origin = new URL(url).origin; } catch (_) {}
  return {
    url,
    origin,
    method: record.method || "GET",
    resourceType: record.resourceType || "other",
    ...(Number.isInteger(record.status) ? { status: record.status } : {}),
    ...(Number.isFinite(record.durationMs) ? { durationMs: record.durationMs } : {}),
    ...(record.failed ? { failed: true } : {}),
  };
}

function runNetworkPolicies(runtime, target, policy) {
  if (!policy) return [];
  const documentOrigin = new URL(target).origin;
  const requests = runtime.requests
    .filter((item) => policy.scope === "all" || API_RESOURCE_TYPES.has(item.resourceType))
    .map((item) => ({ ...item, durationMs: item.durationMs ?? Math.max(0, Date.now() - item.startedAt) }));
  const httpErrors = requests.filter((item) => Number.isInteger(item.status) && item.status >= 400);
  const failedRequests = requests.filter((item) => item.failed);
  const slowRequests = policy.slowRequestMs === undefined ? [] : requests.filter((item) => item.durationMs > policy.slowRequestMs);
  const thirdPartyRequests = requests.filter((item) => {
    try { return new URL(item.url).origin !== documentOrigin; } catch (_) { return false; }
  });
  const findings = [];
  const addFinding = ({ ruleId, title, titleZh, summary, summaryZh, actual, limit, samples, measurementExtra = {}, fix, fixZh, hints = [], hintsZh = [] }) => {
    findings.push(finding({
      ruleId,
      scenarioId: "baseline",
      classification: "existing",
      severity: policy.severity,
      confidence: "high",
      title,
      titleZh,
      summary,
      summaryZh,
      measurements: { scope: policy.scope, actual, limit, ...measurementExtra },
      evidence: [{ type: "network-policy", policy: ruleId, scope: policy.scope, actual, limit, samples: samples.slice(0, 10).map(networkSample) }, screenshotEvidence("baseline", "Baseline network policy")],
      steps: ["Open the target in a fresh browser context with an empty cache.", `Observe ${policy.scope === "api" ? "XHR and fetch" : "all"} requests until the page settles, then compare the recorded count with the configured limit.`],
      stepsZh: ["在缓存为空的新浏览器上下文中打开目标页面。", `观察页面稳定前的${policy.scope === "api" ? " XHR 与 fetch" : "全部"}请求，并将记录数量与配置上限比较。`],
      fix,
      fixZh,
      hints,
      hintsZh,
    }));
  };
  if (policy.maxHttpErrors !== undefined && httpErrors.length > policy.maxHttpErrors) {
    const statuses = Object.fromEntries([...new Set(httpErrors.map((item) => item.status))].sort((a, b) => a - b).map((status) => [String(status), httpErrors.filter((item) => item.status === status).length]));
    addFinding({
      ruleId: "network-http-error-budget",
      title: "HTTP error responses exceed the network reliability budget",
      titleZh: "HTTP 错误响应超过网络可靠性预算",
      summary: `${httpErrors.length} in-scope request(s) returned HTTP 4xx/5xx responses, above the configured maximum of ${policy.maxHttpErrors}.`,
      summaryZh: `有 ${httpErrors.length} 个策略范围内的请求返回 HTTP 4xx/5xx，超过配置上限 ${policy.maxHttpErrors}。`,
      actual: httpErrors.length,
      limit: policy.maxHttpErrors,
      samples: httpErrors,
      measurementExtra: { statuses },
      fix: "Restore each application-owned endpoint or remove the request intentionally; document an exception instead of hiding a known failure.",
      fixZh: "恢复每个应用自身的接口，或在确认无用后移除请求；对已知例外应保留记录，不要隐藏失败。",
      hints: ["Start with 5xx responses and XHR/fetch calls on the critical path."],
      hintsZh: ["优先处理关键路径中的 5xx 响应和 XHR/fetch 调用。"],
    });
  }
  if (policy.maxFailedRequests !== undefined && failedRequests.length > policy.maxFailedRequests) {
    addFinding({
      ruleId: "network-failed-request-budget",
      title: "Transport failures exceed the network reliability budget",
      titleZh: "传输失败超过网络可靠性预算",
      summary: `${failedRequests.length} in-scope request(s) failed before an HTTP response, above the configured maximum of ${policy.maxFailedRequests}.`,
      summaryZh: `有 ${failedRequests.length} 个策略范围内的请求在收到 HTTP 响应前失败，超过配置上限 ${policy.maxFailedRequests}。`,
      actual: failedRequests.length,
      limit: policy.maxFailedRequests,
      samples: failedRequests,
      fix: "Correct DNS, TLS, connectivity, cancellation, or application lifecycle failures and preserve a resilient user-visible fallback.",
      fixZh: "修正 DNS、TLS、连接、中止或应用生命周期故障，并保留对用户可见的可靠降级。",
      hints: ["Use the sampled resource type and redacted endpoint to locate the first failed dependency."],
      hintsZh: ["利用样本中的资源类型和脱敏端点定位第一个失败依赖。"],
    });
  }
  if (policy.maxSlowRequests !== undefined && slowRequests.length > policy.maxSlowRequests) {
    addFinding({
      ruleId: "network-slow-request-budget",
      title: "Slow requests exceed the network reliability budget",
      titleZh: "慢请求超过网络可靠性预算",
      summary: `${slowRequests.length} in-scope request(s) took longer than ${policy.slowRequestMs} ms, above the configured maximum of ${policy.maxSlowRequests}.`,
      summaryZh: `有 ${slowRequests.length} 个策略范围内的请求耗时超过 ${policy.slowRequestMs} 毫秒，超过配置上限 ${policy.maxSlowRequests}。`,
      actual: slowRequests.length,
      limit: policy.maxSlowRequests,
      samples: slowRequests.sort((left, right) => right.durationMs - left.durationMs),
      measurementExtra: { slowRequestMs: policy.slowRequestMs, maximumDurationMs: Math.max(...slowRequests.map((item) => item.durationMs)) },
      fix: "Reduce server or dependency latency, remove serial request waterfalls, and keep loading feedback for work that cannot complete quickly.",
      fixZh: "降低服务端或依赖延迟、消除串行请求瀑布，并为无法快速完成的工作保留加载反馈。",
      hints: ["Use the longest sampled requests to distinguish backend latency from front-end request sequencing."],
      hintsZh: ["从耗时最长的请求样本判断问题来自后端延迟还是前端请求顺序。"],
    });
  }
  if (policy.maxThirdPartyRequests !== undefined && thirdPartyRequests.length > policy.maxThirdPartyRequests) {
    const origins = [...new Set(thirdPartyRequests.map((item) => {
      try { return new URL(item.url).origin; } catch (_) { return "unknown"; }
    }))].sort();
    addFinding({
      ruleId: "network-third-party-request-budget",
      title: "Third-party request volume exceeds the reliability budget",
      titleZh: "第三方请求数量超过可靠性预算",
      summary: `${thirdPartyRequests.length} in-scope request(s) contacted third parties, above the configured maximum of ${policy.maxThirdPartyRequests}.`,
      summaryZh: `有 ${thirdPartyRequests.length} 个策略范围内的请求联系第三方，超过配置上限 ${policy.maxThirdPartyRequests}。`,
      actual: thirdPartyRequests.length,
      limit: policy.maxThirdPartyRequests,
      samples: thirdPartyRequests,
      measurementExtra: { origins },
      fix: "Remove unnecessary third-party calls, consolidate approved dependencies, or load non-critical integrations outside the critical path.",
      fixZh: "移除不必要的第三方调用、合并已批准依赖，或将非关键集成移出关键路径。",
      hints: ["Review privacy and availability ownership for every recorded third-party origin."],
      hintsZh: ["逐一审核报告中第三方来源的隐私与可用性责任。"],
    });
  }
  return findings;
}

async function checkLinkWithHead(context, initialUrl, documentOrigin, crawl, timeoutMs) {
  let currentUrl = initialUrl;
  const redirects = [];
  for (let hop = 0; hop <= 5; hop += 1) {
    let response;
    try {
      response = await context.request.fetch(currentUrl, {
        method: "HEAD",
        timeout: timeoutMs,
        maxRedirects: 0,
        failOnStatusCode: false,
        headers: { "cache-control": "no-cache" },
      });
      const status = response.status();
      const headers = response.headers();
      await response.dispose();
      if (status >= 300 && status < 400) {
        const location = headers.location;
        if (!location) return { url: initialUrl, status, reason: "redirect-without-location", redirects };
        let next;
        try { next = new URL(location, currentUrl); } catch (_) { return { url: initialUrl, status, reason: "invalid-redirect-location", redirects }; }
        next.username = "";
        next.password = "";
        next.search = "";
        next.hash = "";
        redirects.push({ status, url: next.toString() });
        if (next.origin !== documentOrigin) return { url: initialUrl, status, reason: "cross-origin-redirect", redirects };
        if (!routeAllowed(next.pathname, crawl)) return { url: initialUrl, status, reason: "excluded-redirect", redirects, skipped: true };
        currentUrl = next.toString();
        continue;
      }
      if ([405, 501].includes(status)) return { url: initialUrl, status, reason: "head-unsupported", redirects, unsupported: true };
      if (status >= 400) return { url: initialUrl, status, reason: "http-error", redirects };
      return { url: initialUrl, status, redirects, passed: true };
    } catch (error) {
      if (response) await response.dispose().catch(() => {});
      return { url: initialUrl, status: 0, reason: "request-failed", errorType: String(error?.name || "Error").slice(0, 80), redirects };
    }
  }
  return { url: initialUrl, status: 0, reason: "too-many-redirects", redirects };
}

async function runLinkIntegrityPolicy(page, context, target, policy, crawl) {
  if (!policy) return { findings: [], summary: null };
  const documentOrigin = new URL(target).origin;
  const discovered = await page.evaluate(() => [...document.querySelectorAll("a[href]")].slice(0, 1_000).map((anchor) => anchor.href));
  const excluded = [];
  const canonical = [];
  for (const raw of discovered) {
    let url;
    try { url = new URL(raw, target); } catch (_) { continue; }
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== documentOrigin || url.username || url.password) continue;
    url.search = "";
    url.hash = "";
    if (!routeAllowed(url.pathname, crawl)) {
      excluded.push(url.pathname);
      continue;
    }
    canonical.push(url.toString());
  }
  const unique = [...new Set(canonical)].sort();
  const targets = unique.slice(0, policy.maxChecked);
  const results = new Array(targets.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await checkLinkWithHead(context, targets[index], documentOrigin, crawl, policy.timeoutMs);
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, targets.length) }, () => worker()));
  const failures = results.filter((item) => !item.passed && !item.unsupported && !item.skipped);
  const unsupported = results.filter((item) => item.unsupported);
  const skipped = results.filter((item) => item.skipped);
  const statusCounts = Object.fromEntries([...new Set(results.map((item) => item.status))].sort((a, b) => a - b).map((status) => [String(status), results.filter((item) => item.status === status).length]));
  const summary = {
    discovered: discovered.length,
    eligible: unique.length,
    checked: targets.length,
    passed: results.filter((item) => item.passed).length,
    failures: failures.length,
    unsupported: unsupported.length,
    excluded: [...new Set(excluded)].length + skipped.length,
    truncated: Math.max(0, unique.length - targets.length),
    statusCounts,
  };
  if (failures.length <= policy.maxFailures) return { findings: [], summary };
  return {
    summary,
    findings: [finding({
      ruleId: "link-integrity-failure-budget",
      scenarioId: "baseline",
      classification: "existing",
      severity: policy.severity,
      confidence: "high",
      title: "Broken same-origin links exceed the project budget",
      titleZh: "同源失效链接超过项目预算",
      summary: `${failures.length} safely checked same-origin link(s) failed, above the configured maximum of ${policy.maxFailures}.`,
      summaryZh: `安全核查的同源链接中有 ${failures.length} 个失败，超过配置上限 ${policy.maxFailures}。`,
      measurements: { ...summary, limit: policy.maxFailures, method: "HEAD", maxRedirects: 5, timeoutMs: policy.timeoutMs },
      evidence: [{ type: "link-integrity", method: "HEAD", failureSamples: failures.slice(0, 20), ...summary, limit: policy.maxFailures }, screenshotEvidence("baseline", "Same-origin link integrity")],
      steps: ["Open the page in a fresh context without activating any link.", "Collect bounded same-origin anchor targets after the page settles.", "Issue HEAD requests only, following at most five same-origin allowed redirects, and compare failures with the configured limit."],
      stepsZh: ["在新的上下文中打开页面，不激活任何链接。", "页面稳定后收集有上限的同源锚点目标。", "仅发送 HEAD 请求，最多跟随五次同源且允许的重定向，并将失败数与配置上限比较。"],
      fix: "Correct or remove every sampled broken href, preserve intentional redirects, and rerun the same link policy without increasing its failure allowance.",
      fixZh: "修正或移除每个样本中的失效 href，保留有意的重定向，并在不提高失败容许数的情况下重新运行同一链接策略。",
      hints: ["HEAD 405/501 responses are recorded as unsupported rather than broken; verify those endpoints manually or make their HEAD behavior standards-compatible."],
      hintsZh: ["HEAD 405/501 会记为不支持而非失效；请人工验证这些端点，或让其 HEAD 行为符合标准。"],
    })],
  };
}

async function runMetadataPolicy(page, target, policy) {
  if (!policy) return [];
  const inspection = await page.evaluate(() => {
    const codePoints = (value) => Array.from((value || "").trim()).length;
    const titleNodes = [...document.querySelectorAll("head > title")];
    const descriptionNodes = [...document.querySelectorAll('head > meta[name="description" i]')];
    const canonicalNodes = [...document.querySelectorAll('head > link[rel~="canonical" i]')];
    const viewportNodes = [...document.querySelectorAll('head > meta[name="viewport" i]')];
    const robotsNodes = [...document.querySelectorAll('head > meta[name="robots" i],head > meta[name="googlebot" i],head > meta[name="bingbot" i]')];
    const canonical = canonicalNodes.map((node) => {
      try {
        const raw = node.getAttribute("href") || "";
        const url = new URL(raw, location.href);
        const absolute = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw);
        return { valid: absolute && ["http:", "https:"].includes(url.protocol), absolute, origin: url.origin, pathname: url.pathname };
      } catch (_) {
        return { valid: false, absolute: false, origin: null, pathname: null };
      }
    });
    const robotTokens = robotsNodes.flatMap((node) => (node.getAttribute("content") || "").toLowerCase().split(/[\s,]+/).filter(Boolean));
    const lang = (document.documentElement.getAttribute("lang") || "").trim();
    return {
      title: { count: titleNodes.length, length: codePoints(document.title) },
      description: { count: descriptionNodes.length, lengths: descriptionNodes.slice(0, 5).map((node) => codePoints(node.getAttribute("content") || "")) },
      canonical,
      viewport: { count: viewportNodes.length, deviceWidth: viewportNodes.some((node) => /(?:^|,)\s*width\s*=\s*device-width(?:\s*,|$)/i.test(node.getAttribute("content") || "")) },
      language: { present: Boolean(lang), valid: /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(lang), tag: lang.slice(0, 40) || null },
      robots: { declarations: robotsNodes.length, noindex: robotTokens.includes("noindex") },
      headings: { h1: document.querySelectorAll("h1").length },
    };
  });
  const findings = [];
  const add = ({ ruleId, selector, title, titleZh, summary, summaryZh, measurements, policyName, fix, fixZh }) => findings.push(finding({
    ruleId,
    scenarioId: "baseline",
    classification: "existing",
    severity: policy.severity,
    confidence: "high",
    title,
    titleZh,
    summary,
    summaryZh,
    selector,
    measurements,
    evidence: [{ type: "metadata-policy", policy: policyName, ...measurements }, screenshotEvidence("baseline", "Document metadata policy")],
    steps: ["Open the page in a fresh context.", `Inspect the document ${policyName} state without retaining title or description text.`],
    stepsZh: ["在新的浏览器上下文中打开页面。", `检查文档的 ${policyName} 状态，但不保留标题或描述正文。`],
    fix,
    fixZh,
  }));

  if (policy.titleMinLength !== undefined || policy.titleMaxLength !== undefined) {
    const minimum = policy.titleMinLength ?? 0;
    const maximum = policy.titleMaxLength ?? 1_000;
    if (inspection.title.count !== 1 || inspection.title.length < minimum || inspection.title.length > maximum) add({
      ruleId: "metadata-title-length", selector: "title", policyName: "title length",
      title: "Document title does not meet the publishing policy", titleZh: "文档标题不符合发布策略",
      summary: `Found ${inspection.title.count} title element(s) with a rendered length of ${inspection.title.length}; expected exactly one and ${minimum}–${maximum} characters.`,
      summaryZh: `发现 ${inspection.title.count} 个 title 元素，渲染长度为 ${inspection.title.length}；策略要求恰好一个且长度为 ${minimum}–${maximum} 个字符。`,
      measurements: { ...inspection.title, minimum, maximum },
      fix: "Provide one concise, page-specific title within the configured length range.",
      fixZh: "提供一个简洁且针对当前页面的标题，并满足配置的长度范围。",
    });
  }
  if (policy.descriptionMinLength !== undefined || policy.descriptionMaxLength !== undefined) {
    const minimum = policy.descriptionMinLength ?? 0;
    const maximum = policy.descriptionMaxLength ?? 1_000;
    const length = inspection.description.lengths[0] ?? 0;
    if (inspection.description.count !== 1 || length < minimum || length > maximum) add({
      ruleId: "metadata-description-length", selector: 'meta[name="description"]', policyName: "meta description length",
      title: "Meta description does not meet the publishing policy", titleZh: "Meta description 不符合发布策略",
      summary: `Found ${inspection.description.count} description element(s) with a first length of ${length}; expected exactly one and ${minimum}–${maximum} characters.`,
      summaryZh: `发现 ${inspection.description.count} 个 description 元素，第一个长度为 ${length}；策略要求恰好一个且长度为 ${minimum}–${maximum} 个字符。`,
      measurements: { count: inspection.description.count, length, minimum, maximum },
      fix: "Add one accurate, page-specific meta description within the configured range; do not stuff keywords.",
      fixZh: "添加一个准确且针对当前页面的 meta description，并满足长度范围；不要堆砌关键词。",
    });
  }
  if (policy.requireCanonical && (inspection.canonical.length !== 1 || !inspection.canonical[0]?.valid)) add({
    ruleId: "metadata-canonical", selector: 'link[rel~="canonical"]', policyName: "canonical link",
    title: "Canonical link is missing, duplicated, or invalid", titleZh: "Canonical 链接缺失、重复或无效",
    summary: `Found ${inspection.canonical.length} canonical link(s); policy requires exactly one valid HTTP(S) destination.`,
    summaryZh: `发现 ${inspection.canonical.length} 个 canonical 链接；策略要求恰好一个有效的 HTTP(S) 目标。`,
    measurements: { count: inspection.canonical.length, destinations: inspection.canonical.slice(0, 5) },
    fix: "Emit exactly one reviewed absolute canonical URL for this document.",
    fixZh: "为当前文档输出恰好一个经过审核的绝对 canonical URL。",
  });
  if (policy.requireViewport && (inspection.viewport.count !== 1 || !inspection.viewport.deviceWidth)) add({
    ruleId: "metadata-viewport", selector: 'meta[name="viewport"]', policyName: "viewport declaration",
    title: "Responsive viewport metadata is missing or ambiguous", titleZh: "响应式 viewport 元数据缺失或不明确",
    summary: `Found ${inspection.viewport.count} viewport declaration(s); exactly one width=device-width declaration is required.`,
    summaryZh: `发现 ${inspection.viewport.count} 个 viewport 声明；策略要求恰好一个 width=device-width 声明。`,
    measurements: inspection.viewport,
    fix: "Provide one reviewed viewport declaration that includes width=device-width.",
    fixZh: "提供一个包含 width=device-width 的、经过审核的 viewport 声明。",
  });
  if (policy.requireLang && inspection.language.present && !inspection.language.valid) add({
    ruleId: "metadata-language", selector: "html", policyName: "document language",
    title: "Document language tag is invalid", titleZh: "文档语言标签无效",
    summary: "The html lang value is present but does not match the bounded BCP 47 tag shape.",
    summaryZh: "html lang 值已提供，但不符合有边界的 BCP 47 标签格式。",
    measurements: inspection.language,
    fix: "Set html lang to the primary BCP 47 language tag for the rendered page.",
    fixZh: "把 html lang 设置为渲染页面主要语言对应的 BCP 47 标签。",
  });
  if (policy.forbidNoindex && inspection.robots.noindex) add({
    ruleId: "metadata-robots-noindex", selector: 'meta[name="robots"]', policyName: "robots indexing directive",
    title: "Page is marked noindex against publishing policy", titleZh: "页面的 noindex 标记违反发布策略",
    summary: "A robots directive contains noindex on a route configured for indexable publication.",
    summaryZh: "配置为可索引发布的路由包含 robots noindex 指令。",
    measurements: inspection.robots,
    fix: "Remove noindex only after confirming this route is intended for public indexing and no equivalent header blocks it.",
    fixZh: "确认该路由确实用于公开索引且没有等效响应头阻止后，再移除 noindex。",
  });
  if (policy.requireSingleH1 && inspection.headings.h1 !== 1) add({
    ruleId: "metadata-h1-count", selector: "h1", policyName: "primary heading count",
    title: "Page does not expose exactly one primary heading", titleZh: "页面没有恰好一个主标题",
    summary: `Found ${inspection.headings.h1} h1 element(s); publishing policy requires exactly one.`,
    summaryZh: `发现 ${inspection.headings.h1} 个 h1 元素；发布策略要求恰好一个。`,
    measurements: inspection.headings,
    fix: "Keep one page-specific h1 and demote or consolidate competing top-level headings without hiding content.",
    fixZh: "保留一个针对当前页面的 h1，并在不隐藏内容的前提下降级或合并其他顶级标题。",
  });
  for (const item of findings) item.url = target;
  return findings;
}

async function runVisualRegressionPolicy(page, target, runDirectory, policy) {
  if (!policy) return { findings: [], summary: null };
  const result = await evaluateVisualRegression(page, target, runDirectory, policy);
  const screenshots = {
    current: { type: "screenshot", path: "screenshots/visual-current.png", label: "Current deterministic visual snapshot" },
    approved: { type: "screenshot", path: "screenshots/visual-approved.png", label: "Explicitly approved visual baseline" },
    diff: { type: "screenshot", path: "screenshots/visual-diff.png", label: "Visual pixel difference" },
  };
  const structuredEvidence = { type: "visual-policy", state: result.state, ...result.measurements };
  const existingScreenshot = (path, evidence) => path && existsSync(path) ? [evidence] : [];
  const findings = [];
  if (result.state === "missing") findings.push(finding({
    ruleId: "visual-baseline-missing", scenarioId: "baseline", classification: "existing", severity: policy.severity, confidence: "high",
    title: "No approved visual baseline exists for this route", titleZh: "当前路由没有已批准的视觉基线",
    summary: "A deterministic current snapshot was captured, but comparison is blocked until a human explicitly approves it.",
    summaryZh: "已捕获确定性的当前快照，但在人明确批准之前不能进行视觉对比。",
    selector: "html", measurements: result.measurements, evidence: [structuredEvidence, ...existingScreenshot(result.currentPath, screenshots.current)],
    steps: ["Run the route in a clean desktop browser context.", "Observe that no approved pathname baseline is available."],
    stepsZh: ["在干净的桌面浏览器上下文中运行该路由。", "确认该路径尚无已批准的视觉基线。"],
    fix: "Review visual-current.png, then explicitly run realitycheck visual-approve against this report; do not approve an unexplained defect.",
    fixZh: "复核 visual-current.png 后，对本报告显式运行 realitycheck visual-approve；不要批准原因不明的缺陷。",
  }));
  if (result.state === "unusable") findings.push(finding({
    ruleId: "visual-baseline-unusable", scenarioId: "baseline", classification: "existing", severity: policy.severity, confidence: "high",
    title: "Visual comparison could not safely use the configured baseline", titleZh: "视觉对比无法安全使用配置的基线",
    summary: `The explicit visual policy could not be evaluated: ${result.reason}.`, summaryZh: `无法执行明确配置的视觉策略：${result.reason}。`,
    selector: "html", measurements: { ...result.measurements, reason: result.reason }, evidence: [structuredEvidence, ...existingScreenshot(result.currentPath, screenshots.current), ...existingScreenshot(result.approvedCopyPath, screenshots.approved)],
    steps: ["Run the route in a clean desktop browser context.", "Inspect the bounded visual comparison failure reason."],
    stepsZh: ["在干净的桌面浏览器上下文中运行该路由。", "检查有边界的视觉对比失败原因。"],
    fix: "Correct invalid mask selectors or replace an unreadable baseline only after reviewing the current snapshot.",
    fixZh: "修正无效的 mask 选择器；若基线不可读取，必须先复核当前快照再替换。",
  }));
  if (result.state === "failed") {
    const percent = (result.measurements.diffRatio * 100).toFixed(3);
    const allowed = (result.measurements.maxDiffRatio * 100).toFixed(3);
    findings.push(finding({
      ruleId: "visual-regression-threshold", scenarioId: "baseline", classification: "existing", severity: policy.severity, confidence: "high",
      title: "Current rendering differs from the approved visual baseline", titleZh: "当前渲染结果与已批准视觉基线不一致",
      summary: `${result.measurements.changedPixels.toLocaleString("en-US")} pixel(s) changed (${percent}%); the approved maximum is ${allowed}%.`,
      summaryZh: `${result.measurements.changedPixels.toLocaleString("en-US")} 个像素发生变化（${percent}%）；批准的上限为 ${allowed}%。`,
      selector: "html", measurements: result.measurements, evidence: [structuredEvidence, screenshots.current, screenshots.approved, screenshots.diff],
      steps: ["Open the route in the same clean desktop viewport.", "Compare visual-current.png, visual-approved.png, and visual-diff.png."],
      stepsZh: ["在相同的干净桌面视口中打开该路由。", "对比 visual-current.png、visual-approved.png 与 visual-diff.png。"],
      fix: "Repair the unintended application-owned rendering change and rerun the audit. If the change is intentional, review it and explicitly replace the baseline with visual-approve --replace-baseline.",
      fixZh: "修复非预期且由应用造成的渲染变化后重新核查；若变化确属预期，应先人工复核，再通过 visual-approve --replace-baseline 显式替换基线。",
      hints: ["Do not raise the threshold or overwrite the baseline solely to clear the gate."],
      hintsZh: ["不要只为通过门禁而提高阈值或覆盖基线。"],
    }));
  }
  return { findings, summary: { state: result.state, measurements: result.measurements } };
}

async function runSecurityPolicies(page, response, target, policy) {
  if (!policy) return [];
  const findings = [];
  const responseHeaders = response?.headers() || {};
  for (const header of requiredSecurityHeaders(policy)) {
    if (responseHeaders[header]) continue;
    findings.push(finding({
      ruleId: `security-header-${header}`, scenarioId: "baseline", classification: "existing", severity: policy.severity, confidence: "high",
      title: `Required security header is missing: ${header}`, titleZh: `缺少必需的安全响应头：${header}`,
      summary: `The final document response did not include the project-required ${header} header.`, summaryZh: `最终文档响应没有包含项目要求的 ${header} 响应头。`,
      measurements: { header, present: false, responseStatus: response?.status() || 0 },
      evidence: [{ type: "response-policy", header, present: false, status: response?.status() || 0 }, screenshotEvidence("baseline", "Security response policy")],
      steps: ["Open the page in a fresh context.", `Inspect the final document response for the ${header} header.`],
      stepsZh: ["在新的浏览器上下文中打开页面。", `检查最终文档响应是否包含 ${header} 响应头。`],
      fix: `Configure the application or trusted edge to emit a reviewed ${header} policy on this route.`,
      fixZh: `在应用或可信边缘层为该路由配置经审核的 ${header} 策略。`,
      hints: ["Test the actual policy in a staging environment; do not add a permissive placeholder only to satisfy the check."],
      hintsZh: ["在预发布环境验证真实策略；不要只为通过检查而添加宽松占位值。"],
    }));
  }

  for (const result of evaluateSecurityHeaderPolicies(responseHeaders, policy, { documentUrl: target })) {
    if (!result.present || result.passed) continue;
    const reasons = describeSecurityHeaderViolations(result).join("; ");
    const reasonsZh = describeSecurityHeaderViolations(result, "zh-CN").join("；");
    findings.push(finding({
      ruleId: `security-header-policy-${result.header}`, scenarioId: "baseline", classification: "existing", severity: policy.severity, confidence: "high",
      title: `Security header does not satisfy the reviewed value policy: ${result.header}`,
      titleZh: `安全响应头不符合已复核的值策略：${result.header}`,
      summary: `The final document response failed ${result.violations.length} semantic requirement(s): ${reasons}. The raw header value was not retained.`,
      summaryZh: `最终文档响应未满足 ${result.violations.length} 项语义要求：${reasonsZh}。未保留原始响应头值。`,
      measurements: { header: result.header, violations: result.violations, facts: result.facts, rawValueRetained: false },
      evidence: [{ type: "response-header-policy", header: result.header, violations: result.violations, facts: result.facts, rawValueRetained: false }, screenshotEvidence("baseline", "Security header value policy")],
      steps: ["Open the page in a fresh context.", `Evaluate bounded semantic facts from the ${result.header} header without retaining its raw value.`],
      stepsZh: ["在新的浏览器上下文中打开页面。", `从 ${result.header} 响应头评估有限的语义事实，但不保留原始值。`],
      fix: suggestSecurityHeaderFix(result),
      fixZh: suggestSecurityHeaderFix(result, "zh-CN"),
      hints: ["Do not weaken the configured rule or add a permissive placeholder only to clear the gate."],
      hintsZh: ["不要只为通过门禁而削弱配置规则或添加宽松占位值。"],
    }));
  }

  const posture = await page.evaluate(() => {
    const documentOrigin = location.origin;
    const resources = performance.getEntriesByType("resource").slice(0, 2_000).map((entry) => {
      try {
        const url = new URL(entry.name, location.href);
        return { origin: url.origin, protocol: url.protocol, initiatorType: entry.initiatorType || "other" };
      } catch (_) {
        return null;
      }
    }).filter(Boolean);
    const forms = [...document.forms].slice(0, 100).map((form, index) => {
      const action = new URL(form.action || location.href, location.href);
      return {
        index,
        method: (form.method || "get").toLowerCase(),
        actionOrigin: action.origin,
        actionProtocol: action.protocol,
        hasPassword: Boolean(form.querySelector('input[type="password"]')),
      };
    });
    const executableResources = [
      ...[...document.querySelectorAll("script[src]")].map((element) => ({ element, kind: "script", source: element.src })),
      ...[...document.querySelectorAll('link[rel~="stylesheet"][href]')].map((element) => ({ element, kind: "stylesheet", source: element.href })),
    ].slice(0, 500).map(({ element, kind, source }) => {
      try {
        const url = new URL(source, location.href);
        return { origin: url.origin, kind, hasIntegrity: Boolean(element.getAttribute("integrity")?.trim()) };
      } catch (_) {
        return null;
      }
    }).filter(Boolean);
    return { documentOrigin, resources, forms, executableResources };
  });
  const documentUrl = new URL(target);
  const thirdPartyOrigins = [...new Set(posture.resources.map((item) => item.origin).filter((origin) => origin !== posture.documentOrigin && !["null", "data:", "blob:"].includes(origin)))].sort();

  if (policy.forbidMixedContent && documentUrl.protocol === "https:") {
    const insecure = posture.resources.filter((item) => item.protocol === "http:");
    if (insecure.length) {
      findings.push(finding({
        ruleId: "security-mixed-content", scenarioId: "baseline", classification: "existing", severity: policy.severity, confidence: "high",
        title: "HTTPS page loads insecure subresources", titleZh: "HTTPS 页面加载了不安全的子资源",
        summary: `${insecure.length} loaded resource(s) used HTTP from an HTTPS document.`, summaryZh: `HTTPS 文档中有 ${insecure.length} 个已加载资源使用 HTTP。`,
        measurements: { insecureResources: insecure.length, initiatorTypes: [...new Set(insecure.map((item) => item.initiatorType))] },
        evidence: [{ type: "security-posture", policy: "forbid-mixed-content", insecureResources: insecure.length, initiatorTypes: [...new Set(insecure.map((item) => item.initiatorType))] }, screenshotEvidence("baseline", "Mixed content policy")],
        steps: ["Open the HTTPS page in a fresh context.", "Inspect loaded resource protocols after the page settles."],
        stepsZh: ["在新的浏览器上下文中打开 HTTPS 页面。", "页面稳定后检查已加载资源所用协议。"],
        fix: "Serve every application-owned subresource over HTTPS and update hard-coded HTTP references.",
        fixZh: "通过 HTTPS 提供所有应用自身的子资源，并更新硬编码的 HTTP 引用。",
      }));
    }
  }

  if (policy.requireSubresourceIntegrity) {
    const crossOriginExecutable = posture.executableResources.filter((item) => item.origin !== posture.documentOrigin && !["null", "data:", "blob:"].includes(item.origin));
    const missingIntegrity = crossOriginExecutable.filter((item) => !item.hasIntegrity);
    if (missingIntegrity.length) {
      const origins = [...new Set(missingIntegrity.map((item) => item.origin))].sort();
      const kinds = Object.fromEntries([...new Set(missingIntegrity.map((item) => item.kind))].sort().map((kind) => [kind, missingIntegrity.filter((item) => item.kind === kind).length]));
      const measurements = {
        examinedCrossOriginResources: crossOriginExecutable.length,
        missingIntegrity: missingIntegrity.length,
        origins,
        kinds,
        resourcePathsRetained: false,
        integrityValuesRetained: false,
      };
      findings.push(finding({
        ruleId: "security-subresource-integrity", scenarioId: "baseline", classification: "existing", severity: policy.severity, confidence: "high",
        title: "A cross-origin executable resource has no integrity proof", titleZh: "跨来源可执行资源缺少完整性证明",
        summary: `${missingIntegrity.length} of ${crossOriginExecutable.length} cross-origin script or stylesheet resource(s) had no Subresource Integrity attribute. Resource paths and integrity values were not retained.`,
        summaryZh: `${crossOriginExecutable.length} 个跨来源脚本或样式资源中有 ${missingIntegrity.length} 个缺少子资源完整性属性；未保留资源路径或完整性值。`,
        measurements,
        evidence: [{ type: "security-posture", policy: "subresource-integrity", ...measurements }, screenshotEvidence("baseline", "Subresource Integrity policy")],
        steps: ["Open the page in a fresh context.", "Inspect cross-origin script and stylesheet elements for a non-empty integrity attribute without retaining its value or resource path."],
        stepsZh: ["在新的浏览器上下文中打开页面。", "检查跨来源脚本和样式元素是否具有非空 integrity 属性，但不保留其值或资源路径。"],
        fix: "Pin the reviewed third-party asset, add its cryptographic SRI digest and appropriate crossorigin mode, or self-host the versioned asset; verify behavior before release.",
        fixZh: "固定经过复核的第三方资源版本，加入其 SRI 加密摘要与适当的 crossorigin 模式，或自行托管版本化资源；发布前验证行为。",
        hints: ["Never copy a digest from an untrusted response; compute it from the exact reviewed bytes and update it only with an intentional dependency change."],
        hintsZh: ["不要从不可信响应复制摘要；应基于已复核的精确字节计算，并只在有意升级依赖时更新。"],
      }));
    }
  }

  if (policy.maxThirdPartyOrigins !== undefined && thirdPartyOrigins.length > policy.maxThirdPartyOrigins) {
    findings.push(finding({
      ruleId: "security-third-party-origin-budget", scenarioId: "baseline", classification: "existing", severity: policy.severity, confidence: "high",
      title: "Third-party origin count exceeds the project policy", titleZh: "第三方来源数量超过项目策略",
      summary: `The page contacted ${thirdPartyOrigins.length} third-party origin(s), above the configured maximum of ${policy.maxThirdPartyOrigins}.`, summaryZh: `页面联系了 ${thirdPartyOrigins.length} 个第三方来源，超过配置上限 ${policy.maxThirdPartyOrigins}。`,
      measurements: { actual: thirdPartyOrigins.length, limit: policy.maxThirdPartyOrigins, origins: thirdPartyOrigins },
      evidence: [{ type: "security-posture", policy: "third-party-origin-budget", origins: thirdPartyOrigins, actual: thirdPartyOrigins.length, limit: policy.maxThirdPartyOrigins }, screenshotEvidence("baseline", "Third-party origin policy")],
      steps: ["Open the page in a fresh context.", "Count unique origins used by loaded resources after the page settles."],
      stepsZh: ["在新的浏览器上下文中打开页面。", "页面稳定后统计已加载资源使用的唯一来源。"],
      fix: "Remove unnecessary third-party dependencies, consolidate delivery, or obtain a documented policy exception.",
      fixZh: "移除不必要的第三方依赖、合并交付来源，或获得有记录的策略例外。",
    }));
  }

  if (policy.allowedThirdPartyOrigins) {
    const allowed = new Set(policy.allowedThirdPartyOrigins);
    const unapproved = thirdPartyOrigins.filter((origin) => !allowed.has(origin));
    if (unapproved.length) {
      findings.push(finding({
        ruleId: "security-unapproved-third-party-origin", scenarioId: "baseline", classification: "existing", severity: policy.severity, confidence: "high",
        title: "The page contacts an unapproved third-party origin", titleZh: "页面联系了未经批准的第三方来源",
        summary: `${unapproved.length} third-party origin(s) were not present in the configured allowlist.`, summaryZh: `${unapproved.length} 个第三方来源不在配置的允许列表中。`,
        measurements: { unapprovedOrigins: unapproved, allowedOrigins: policy.allowedThirdPartyOrigins },
        evidence: [{ type: "security-posture", policy: "third-party-origin-allowlist", unapprovedOrigins: unapproved }, screenshotEvidence("baseline", "Third-party allowlist")],
        steps: ["Open the page in a fresh context.", "Compare loaded third-party resource origins with the reviewed allowlist."],
        stepsZh: ["在新的浏览器上下文中打开页面。", "将已加载的第三方资源来源与审核后的允许列表比较。"],
        fix: "Remove the unexpected dependency or add its exact HTTPS origin only after security and privacy review.",
        fixZh: "移除意外依赖；只有通过安全与隐私审核后，才能添加其准确的 HTTPS 来源。",
      }));
    }
  }

  if (policy.secureForms) {
    const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]).has(documentUrl.hostname);
    const insecureForms = posture.forms.filter((form) => (form.hasPassword && form.method === "get")
      || (!loopback && form.hasPassword && documentUrl.protocol !== "https:")
      || (documentUrl.protocol === "https:" && form.actionProtocol === "http:"));
    if (insecureForms.length) {
      findings.push(finding({
        ruleId: "security-insecure-form", scenarioId: "baseline", classification: "existing", severity: policy.severity, confidence: "high",
        title: "A sensitive form uses an insecure submission path", titleZh: "敏感表单使用了不安全的提交路径",
        summary: `${insecureForms.length} form(s) could expose credentials through GET or an insecure transport.`, summaryZh: `${insecureForms.length} 个表单可能通过 GET 或不安全传输暴露凭据。`,
        measurements: { forms: insecureForms },
        evidence: [{ type: "security-posture", policy: "secure-forms", forms: insecureForms }, screenshotEvidence("baseline", "Secure form policy")],
        steps: ["Open the page in a fresh context.", "Inspect password fields, form methods, and resolved action protocols without submitting anything."],
        stepsZh: ["在新的浏览器上下文中打开页面。", "在不提交任何内容的前提下检查密码字段、表单方法和解析后的 action 协议。"],
        fix: "Use POST for credentials and submit only to a reviewed HTTPS endpoint.",
        fixZh: "凭据使用 POST，并且只提交到经审核的 HTTPS 端点。",
      }));
    }
  }
  return findings;
}

async function runPrivacyPolicies(page, context, target, policy) {
  if (!policy) return [];
  const findings = [];
  const targetHost = new URL(target).hostname.toLowerCase();
  let cookieMetrics = { available: false, count: 0, bytes: 0, thirdPartyCount: 0 };
  try {
    const cookies = await context.cookies();
    const byteLength = (value) => Buffer.byteLength(String(value ?? ""), "utf8");
    const firstParty = (cookie) => {
      const domain = String(cookie.domain || "").replace(/^\./, "").toLowerCase();
      return Boolean(domain) && (targetHost === domain || targetHost.endsWith(`.${domain}`));
    };
    cookieMetrics = {
      available: true,
      count: cookies.length,
      bytes: cookies.reduce((total, cookie) => total + byteLength(cookie.name) + byteLength(cookie.value), 0),
      thirdPartyCount: cookies.filter((cookie) => !firstParty(cookie)).length,
    };
  } catch (_) {
    // A failed measurement is reported below and is never converted into a zero-value pass.
  }

  let storageMetrics = {
    localStorage: { available: false, entries: 0, bytes: 0 },
    sessionStorage: { available: false, entries: 0, bytes: 0 },
  };
  try {
    storageMetrics = await page.evaluate(() => {
      const encoder = new TextEncoder();
      const measure = (storage) => {
        try {
          let bytes = 0;
          for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index) || "";
            const value = storage.getItem(key) || "";
            bytes += encoder.encode(key).byteLength + encoder.encode(value).byteLength;
          }
          return { available: true, entries: storage.length, bytes };
        } catch (_) {
          return { available: false, entries: 0, bytes: 0 };
        }
      };
      return { localStorage: measure(localStorage), sessionStorage: measure(sessionStorage) };
    });
  } catch (_) {
    // Preserve the bounded unavailable state without copying browser exception text.
  }

  const aggregate = {
    cookieSummary: cookieMetrics,
    localStorage: storageMetrics.localStorage,
    sessionStorage: storageMetrics.sessionStorage,
  };
  const screenshot = screenshotEvidence("baseline", "Aggregate browser storage privacy budget");
  const configuredLocalStorage = policy.maxLocalStorageEntries !== undefined || policy.maxLocalStorageBytes !== undefined;
  const configuredSessionStorage = policy.maxSessionStorageEntries !== undefined || policy.maxSessionStorageBytes !== undefined;
  const configuredCookies = policy.maxCookies !== undefined || policy.maxCookieBytes !== undefined || policy.maxThirdPartyCookies !== undefined;
  const unavailable = [
    ...(configuredCookies && !cookieMetrics.available ? ["cookies"] : []),
    ...(configuredLocalStorage && !storageMetrics.localStorage.available ? ["localStorage"] : []),
    ...(configuredSessionStorage && !storageMetrics.sessionStorage.available ? ["sessionStorage"] : []),
  ];
  if (unavailable.length) {
    findings.push(finding({
      ruleId: "privacy-storage-measurement-unavailable", scenarioId: "baseline", classification: "existing", severity: policy.severity, confidence: "high",
      title: "A configured browser storage privacy budget could not be measured", titleZh: "已配置的浏览器存储隐私预算无法测量",
      summary: `${unavailable.join(", ")} could not be read in the isolated browser context, so RealityCheck did not treat the missing measurements as zero.`,
      summaryZh: `隔离浏览器上下文无法读取 ${unavailable.join("、")}，因此 RealityCheck 没有把缺失测量值当作 0。`,
      selector: "html", measurements: { unavailable, aggregate }, evidence: [{ type: "privacy-budget", state: "measurement-unavailable", unavailable, aggregate }, screenshot],
      steps: ["Open the page in a fresh browser context.", "Attempt aggregate-only cookie and Web Storage measurements without retaining any names, keys, or values."],
      stepsZh: ["在新的浏览器上下文中打开页面。", "仅尝试测量 Cookie 与 Web Storage 聚合值，不保留名称、键或值。"],
      fix: "Investigate the route's origin and browser storage restrictions, then rerun; do not waive the check by assuming unavailable storage is empty.",
      fixZh: "检查该路由的来源与浏览器存储限制后重新核查；不要通过假设不可用存储为空来绕过检查。",
    }));
  }

  const budgets = [
    { key: "maxCookies", actual: cookieMetrics.count, available: cookieMetrics.available, ruleId: "privacy-cookie-count-budget", title: "Cookie count exceeds the project privacy budget", titleZh: "Cookie 数量超过项目隐私预算", noun: "cookie(s)", nounZh: "个 Cookie", fix: "Remove cookies that are not needed for the current product behavior, shorten their lifetime where appropriate, and rerun the audit.", fixZh: "移除当前产品行为不需要的 Cookie，并在合适情况下缩短生命周期，然后重新核查。" },
    { key: "maxCookieBytes", actual: cookieMetrics.bytes, available: cookieMetrics.available, ruleId: "privacy-cookie-byte-budget", title: "Cookie bytes exceed the project privacy budget", titleZh: "Cookie 字节数超过项目隐私预算", noun: "cookie byte(s)", nounZh: "个 Cookie 字节", fix: "Reduce application-owned cookie payloads and avoid storing unnecessary state in cookies; do not delete authentication state without product review.", fixZh: "缩减应用自身 Cookie 载荷，避免在 Cookie 中保存不必要状态；未经产品复核不要删除认证状态。" },
    { key: "maxThirdPartyCookies", actual: cookieMetrics.thirdPartyCount, available: cookieMetrics.available, ruleId: "privacy-third-party-cookie-budget", title: "Third-party cookie count exceeds the project privacy budget", titleZh: "第三方 Cookie 数量超过项目隐私预算", noun: "third-party cookie(s)", nounZh: "个第三方 Cookie", fix: "Remove unnecessary third-party integrations or load them only after the reviewed consent and product flow permits it.", fixZh: "移除不必要的第三方集成，或只在经审核的同意与产品流程允许后加载。" },
    { key: "maxLocalStorageEntries", actual: storageMetrics.localStorage.entries, available: storageMetrics.localStorage.available, ruleId: "privacy-local-storage-entry-budget", title: "localStorage entries exceed the project privacy budget", titleZh: "localStorage 条目数超过项目隐私预算", noun: "localStorage entry/entries", nounZh: "个 localStorage 条目", fix: "Remove obsolete application-owned localStorage entries with a reviewed migration and retention plan.", fixZh: "通过经审核的迁移与保留方案移除过期的应用自身 localStorage 条目。" },
    { key: "maxLocalStorageBytes", actual: storageMetrics.localStorage.bytes, available: storageMetrics.localStorage.available, ruleId: "privacy-local-storage-byte-budget", title: "localStorage bytes exceed the project privacy budget", titleZh: "localStorage 字节数超过项目隐私预算", noun: "localStorage byte(s)", nounZh: "个 localStorage 字节", fix: "Minimize persistent client-side payloads and move only appropriate non-secret data to a reviewed storage design.", fixZh: "精简持久化客户端载荷，并只将合适的非敏感数据迁移到经审核的存储设计。" },
    { key: "maxSessionStorageEntries", actual: storageMetrics.sessionStorage.entries, available: storageMetrics.sessionStorage.available, ruleId: "privacy-session-storage-entry-budget", title: "sessionStorage entries exceed the project privacy budget", titleZh: "sessionStorage 条目数超过项目隐私预算", noun: "sessionStorage entry/entries", nounZh: "个 sessionStorage 条目", fix: "Remove obsolete session-only state and consolidate duplicated application-owned entries after reviewing navigation behavior.", fixZh: "复核导航行为后，移除过期会话状态并合并重复的应用自身条目。" },
    { key: "maxSessionStorageBytes", actual: storageMetrics.sessionStorage.bytes, available: storageMetrics.sessionStorage.available, ruleId: "privacy-session-storage-byte-budget", title: "sessionStorage bytes exceed the project privacy budget", titleZh: "sessionStorage 字节数超过项目隐私预算", noun: "sessionStorage byte(s)", nounZh: "个 sessionStorage 字节", fix: "Reduce session-only payloads and keep sensitive data out of browser storage unless the design is explicitly reviewed.", fixZh: "缩减会话载荷；除非设计经过明确审核，否则不要在浏览器存储中保存敏感数据。" },
  ];
  for (const budget of budgets) {
    const limit = policy[budget.key];
    if (limit === undefined || !budget.available || budget.actual <= limit) continue;
    findings.push(finding({
      ruleId: budget.ruleId, scenarioId: "baseline", classification: "existing", severity: policy.severity, confidence: "high",
      title: budget.title, titleZh: budget.titleZh,
      summary: `The isolated baseline measured ${budget.actual} ${budget.noun}, above the configured maximum of ${limit}.`,
      summaryZh: `隔离基线测得 ${budget.actual} ${budget.nounZh}，超过配置上限 ${limit}。`,
      selector: "html", measurements: { metric: budget.key, actual: budget.actual, limit, aggregate },
      evidence: [{ type: "privacy-budget", state: "exceeded", metric: budget.key, actual: budget.actual, limit, aggregate }, screenshot],
      steps: ["Open the page in a fresh browser context.", `Measure only aggregate ${budget.key} usage after the baseline settles.`],
      stepsZh: ["在新的浏览器上下文中打开页面。", `基线稳定后，仅测量 ${budget.key} 聚合用量。`],
      fix: budget.fix, fixZh: budget.fixZh,
      hints: ["RealityCheck intentionally does not retain cookie names, values, storage keys, or storage values."],
      hintsZh: ["RealityCheck 有意不保留 Cookie 名称、值、存储键或存储值。"],
    }));
  }
  return findings;
}

async function runQuickAudit(browser, target, runDirectory, contextOptions = {}, customChecks = [], budgets = null, network = null, links = null, metadataPolicy = null, visual = null, security = null, privacy = null, viewports = DEFAULT_PROJECT_CONFIG.viewports, crawl = { include: ["/**"], exclude: [] }) {
  const findings = [];
  const results = new Map();
  let targetTitle = "";
  let finalUrl = target;
  let linkSummary = null;
  let visualSummary = null;
  const quickTotal = 5 + viewports.length;
  let quickStep = 0;
  const logQuick = (label) => console.log(`  ${String(++quickStep).padStart(2, " ")}/${quickTotal} ${label}`);

  logQuick("Baseline");
  const baseline = await createPage(browser, target, "baseline", runDirectory, contextOptions);
  targetTitle = await baseline.page.title();
  finalUrl = baseline.page.url();
  const baselineLayout = await inspectLayout(baseline.page);
  const baselineControls = new Map(baselineLayout.controls.map((item) => [item.selector, item]));
  const baselineClipped = new Map(baselineLayout.clipped.map((item) => [item.selector, item]));
  const baselineImages = new Map(baselineLayout.images.map((item) => [item.selector, item]));
  const consoleErrors = [...new Set(baseline.runtime.consoleErrors)]
    .filter((message) => !/^Failed to load resource:/i.test(message))
    .slice(0, 5);
  if (consoleErrors.length) {
    findings.push(finding({
      ruleId: "console-error", scenarioId: "baseline", classification: "existing", severity: "minor", confidence: "high",
      title: "The page logs errors during baseline load", titleZh: "页面在基线加载时输出错误",
      summary: `${consoleErrors.length} distinct console error(s) were recorded before any stress condition was applied.`, summaryZh: `在施加任何压力条件之前，浏览器记录到 ${consoleErrors.length} 条不同的控制台错误。`,
      measurements: { distinctMessages: consoleErrors.length, occurrences: baseline.runtime.consoleErrors.filter((item) => consoleErrors.includes(item)).length },
      evidence: [...consoleErrors.map((text) => ({ type: "console", level: "error", text })), screenshotEvidence("baseline", "Baseline")],
      steps: ["Open the target in a clean desktop browser context.", "Inspect console errors emitted during initial load."],
      stepsZh: ["在干净的桌面浏览器上下文中打开目标页面。", "检查初始加载期间产生的控制台错误。"],
      fix: "Handle or remove the failing initialization path without suppressing actionable errors.", fixZh: "处理或移除失败的初始化路径，不要简单隐藏可操作的错误。",
      hints: ["Trace the first application-owned stack frame or integration initialization call."], hintsZh: ["从第一个属于应用代码的堆栈或集成初始化调用开始定位。"],
    }));
  }
  const pageErrors = [...new Set(baseline.runtime.pageErrors)].slice(0, 3);
  if (pageErrors.length) {
    findings.push(finding({
      ruleId: "page-error", scenarioId: "baseline", classification: "existing", severity: "major", confidence: "high",
      title: "An uncaught page error occurs during baseline load", titleZh: "基线加载期间出现未捕获的页面错误",
      summary: `The application raised ${pageErrors.length} distinct uncaught runtime exception(s) without a stress mutation.`, summaryZh: `应用在没有压力变更的情况下抛出了 ${pageErrors.length} 条不同的未捕获运行时异常。`,
      measurements: { distinctMessages: pageErrors.length, occurrences: baseline.runtime.pageErrors.filter((item) => pageErrors.includes(item)).length },
      evidence: [...pageErrors.map((text) => ({ type: "page-error", text })), screenshotEvidence("baseline", "Baseline")],
      steps: ["Open the target in a clean desktop browser context.", "Observe the uncaught page exception."],
      stepsZh: ["在干净的桌面浏览器上下文中打开目标页面。", "观察未捕获的页面异常。"],
      fix: "Correct the application-owned exception and preserve the successful baseline path.", fixZh: "修复应用自身的异常，并保持正常基线路径可用。",
    }));
  }
  const httpErrors = [...new Map(baseline.runtime.httpErrors.map((item) => [`${item.status}:${item.url}`, item])).values()].slice(0, 5);
  if (httpErrors.length && network?.maxHttpErrors === undefined) {
    findings.push(finding({
      ruleId: "http-error-response", scenarioId: "baseline", classification: "existing", severity: httpErrors.some((item) => item.status >= 500 || ["document", "script", "stylesheet", "xhr", "fetch"].includes(item.resourceType)) ? "major" : "minor", confidence: "high",
      title: "Resources fail during baseline load", titleZh: "基线加载期间有资源请求失败",
      summary: `${httpErrors.length} distinct request(s) returned an HTTP error before stress testing.`, summaryZh: `压力测试前有 ${httpErrors.length} 个不同的请求返回 HTTP 错误。`,
      measurements: { distinctResponses: httpErrors.length, statuses: httpErrors.map((item) => item.status) },
      evidence: [...httpErrors.map((item) => ({ type: "network", method: item.method, resourceType: item.resourceType, status: item.status, url: item.url })), screenshotEvidence("baseline", "Baseline")],
      steps: ["Open the target in a clean desktop browser context.", "Inspect failed network responses during initial load."],
      stepsZh: ["在干净的桌面浏览器上下文中打开目标页面。", "检查初始加载期间失败的网络响应。"],
      fix: "Correct or intentionally remove each failing resource request.", fixZh: "修正每个失败的资源请求，或在确认不需要后移除该请求。",
      hints: ["Start with the recorded URL and HTTP status; do not hide the browser error."], hintsZh: ["从报告记录的 URL 和 HTTP 状态开始定位；不要只隐藏浏览器错误。"],
    }));
  }
  const failedRequests = [...new Map(baseline.runtime.failedRequests.map((item) => [`${item.resourceType}:${item.url}`, item])).values()].slice(0, 5);
  if (failedRequests.length && network?.maxFailedRequests === undefined) {
    findings.push(finding({
      ruleId: "failed-request", scenarioId: "baseline", classification: "existing", severity: failedRequests.some((item) => ["document", "script", "stylesheet", "xhr", "fetch"].includes(item.resourceType)) ? "major" : "minor", confidence: "high",
      title: "Requests fail during baseline load", titleZh: "基线加载期间有请求失败",
      summary: `${failedRequests.length} distinct request(s) failed before receiving an HTTP response.`, summaryZh: `有 ${failedRequests.length} 个不同的请求在收到 HTTP 响应前失败。`,
      measurements: { distinctRequests: failedRequests.length, resourceTypes: failedRequests.map((item) => item.resourceType) },
      evidence: [...failedRequests.map((item) => ({ type: "network", resourceType: item.resourceType, error: item.error, url: item.url })), screenshotEvidence("baseline", "Baseline")],
      steps: ["Open the target in a clean desktop browser context.", "Inspect requests that failed before an HTTP response arrived."],
      stepsZh: ["在干净的桌面浏览器上下文中打开目标页面。", "检查在收到 HTTP 响应前就失败的请求。"],
      fix: "Restore the application-owned request path or provide an intentional resilient fallback.", fixZh: "恢复应用自身的请求路径，或提供明确且有韧性的降级行为。",
      hints: ["Start with the recorded resource type, URL, and browser failure reason."], hintsZh: ["从报告中的资源类型、URL 和浏览器失败原因开始定位。"],
    }));
  }
  for (const control of baselineLayout.controls.filter((item) => !item.hasAccessibleName).slice(0, 3)) {
    findings.push(finding({
      ruleId: "control-accessible-name", scenarioId: "baseline", classification: "existing", severity: "major", confidence: "medium",
      title: "An interactive control has no accessible name", titleZh: "交互控件没有可访问名称",
      summary: "The visible control exposes no label through native text, an associated label, alt text, title, aria-label, or aria-labelledby.", summaryZh: "该可见控件没有通过原生文本、关联标签、alt、title、aria-label 或 aria-labelledby 提供名称。",
      selector: control.selector,
      measurements: { tag: control.tag, role: control.role, hasAccessibleName: false, boundingBox: control.rect },
      evidence: [{ type: "dom", selector: control.selector, hasAccessibleName: false, boundingBox: control.rect }, screenshotEvidence("baseline", "Unnamed interactive control")],
      steps: ["Open the page in a clean browser context.", `Inspect the accessible name exposed by ${control.selector}.`],
      stepsZh: ["在干净的浏览器上下文中打开页面。", `检查 ${control.selector} 暴露的可访问名称。`],
      fix: "Give the control a concise programmatic name using visible text or native labeling first.", fixZh: "优先使用可见文本或原生标签，为控件提供简洁的程序化名称。",
      hints: ["Prefer a native <label>, button text, or alt text before adding ARIA."], hintsZh: ["优先使用原生 <label>、按钮文本或 alt，再考虑 ARIA。"],
    }));
  }
  const metadata = baselineLayout.documentMetadata;
  if (!metadata.language) {
    findings.push(finding({
      ruleId: "document-language-missing", scenarioId: "baseline", classification: "existing", severity: "minor", confidence: "high",
      title: "The document does not declare its language", titleZh: "文档没有声明语言",
      summary: "The root html element has no non-empty lang attribute, so assistive technology cannot reliably select pronunciation rules.", summaryZh: "根 html 元素没有非空 lang 属性，辅助技术无法可靠选择发音规则。",
      selector: "html", measurements: { language: "" }, evidence: [{ type: "dom", selector: "html", attribute: "lang", value: "" }, screenshotEvidence("baseline", "Document language metadata")],
      steps: ["Open the page in a clean browser context.", "Inspect the lang attribute on the root html element."], stepsZh: ["在干净的浏览器上下文中打开页面。", "检查根 html 元素的 lang 属性。"],
      fix: "Declare the page's primary BCP 47 language tag on the root html element.", fixZh: "在根 html 元素上声明页面主要语言的 BCP 47 标签。",
      hints: ["Use a specific tag such as en, zh-CN, or ar and update it when the document language changes."], hintsZh: ["使用 en、zh-CN 或 ar 等明确标签，并在文档语言变化时同步更新。"],
    }));
  }
  if (!metadata.title) {
    findings.push(finding({
      ruleId: "document-title-missing", scenarioId: "baseline", classification: "existing", severity: "minor", confidence: "high",
      title: "The document has no page title", titleZh: "文档没有页面标题",
      summary: "The browser title is empty, which makes tabs, history, and assistive navigation difficult to distinguish.", summaryZh: "浏览器标题为空，用户难以在标签页、历史记录和辅助导航中区分页面。",
      selector: "title", measurements: { titleLength: 0 }, evidence: [{ type: "dom", selector: "title", textLength: 0 }, screenshotEvidence("baseline", "Document title metadata")],
      steps: ["Open the page in a clean browser context.", "Inspect document.title after the page settles."], stepsZh: ["在干净的浏览器上下文中打开页面。", "页面稳定后检查 document.title。"],
      fix: "Add a concise, route-specific title that identifies the page and product.", fixZh: "添加简洁、与路由对应的标题，明确页面和产品。",
    }));
  }
  if (metadata.duplicateIds.length) {
    const first = metadata.duplicateIds[0];
    findings.push(finding({
      ruleId: "duplicate-element-id", scenarioId: "baseline", classification: "existing", severity: "minor", confidence: "high",
      title: "The document contains duplicate element IDs", titleZh: "文档包含重复的元素 ID",
      summary: `${metadata.duplicateIds.length} duplicated ID value(s) can make labels, fragments, and DOM references resolve to the wrong element.`, summaryZh: `检测到 ${metadata.duplicateIds.length} 个重复 ID 值，可能让标签、片段和 DOM 引用指向错误元素。`,
      selector: `#${first.id}`, measurements: { duplicates: metadata.duplicateIds }, evidence: [{ type: "dom", duplicates: metadata.duplicateIds }, screenshotEvidence("baseline", "Duplicate document IDs")],
      steps: ["Open the page in a clean browser context.", "Count every non-empty id value and identify values used more than once."], stepsZh: ["在干净的浏览器上下文中打开页面。", "统计所有非空 id，并找出使用超过一次的值。"],
      fix: "Give every document ID a unique stable value and update all label, fragment, and ARIA references.", fixZh: "为每个文档 ID 设置唯一且稳定的值，并同步更新标签、片段和 ARIA 引用。",
    }));
  }
  if (metadata.headingSkips.length) {
    const first = metadata.headingSkips[0];
    findings.push(finding({
      ruleId: "heading-level-skip", scenarioId: "baseline", classification: "existing", severity: "minor", confidence: "medium",
      title: "Visible heading levels skip part of the hierarchy", titleZh: "可见标题层级出现跳级",
      summary: `A level ${first.previous.level} heading is followed by level ${first.current.level}, which may obscure the document structure.`, summaryZh: `${first.previous.level} 级标题后直接出现 ${first.current.level} 级标题，可能让文档结构难以理解。`,
      selector: first.current.selector, measurements: { skips: metadata.headingSkips }, evidence: [{ type: "dom", headingSkips: metadata.headingSkips }, screenshotEvidence("baseline", "Visible heading hierarchy")],
      steps: ["Open the page in a clean browser context.", "Read visible h1–h6 elements in DOM order and compare adjacent levels."], stepsZh: ["在干净的浏览器上下文中打开页面。", "按 DOM 顺序读取可见 h1–h6，并比较相邻层级。"],
      fix: "Use heading levels to represent the document outline without skipping an intermediate level.", fixZh: "使用标题层级表达文档结构，不要跳过中间层级。",
      hints: ["Change visual size with CSS rather than choosing a heading level for appearance."], hintsZh: ["通过 CSS 调整视觉字号，不要为了外观选择标题层级。"],
    }));
  }
  if (customChecks.length) findings.push(...await runCustomChecks(baseline.page, customChecks));
  if (budgets) findings.push(...await runPerformanceBudgets(baseline.page, budgets));
  if (network) findings.push(...runNetworkPolicies(baseline.runtime, finalUrl, network));
  if (links) {
    const linkResult = await runLinkIntegrityPolicy(baseline.page, baseline.context, finalUrl, links, crawl);
    linkSummary = linkResult.summary;
    findings.push(...linkResult.findings);
  }
  if (metadataPolicy) findings.push(...await runMetadataPolicy(baseline.page, finalUrl, metadataPolicy));
  if (visual) {
    const visualResult = await runVisualRegressionPolicy(baseline.page, finalUrl, runDirectory, visual);
    visualSummary = visualResult.summary;
    findings.push(...visualResult.findings);
  }
  if (security) findings.push(...await runSecurityPolicies(baseline.page, baseline.response, finalUrl, security));
  if (privacy) findings.push(...await runPrivacyPolicies(baseline.page, baseline.context, finalUrl, privacy));
  results.set("baseline", scenarioResult("baseline", findings.length ? "completed-with-findings" : "passed", baseline.durationMs(), findings.length ? ["Baseline runtime findings were recorded."] : [], findings.length ? ["已记录基线运行时问题。"] : []));
  await baseline.context.close();

  for (const viewport of viewports) {
    const dimensions = `${viewport.width}×${viewport.height}`;
    logQuick(`${viewport.id} (${dimensions}${viewport.touch ? ", touch" : ""})`);
    const responsive = await createPage(browser, target, viewport.id, runDirectory, { ...contextOptions, viewport: { width: viewport.width, height: viewport.height } });
    try {
      const layout = await inspectLayout(responsive.page);
      const viewportStart = findings.length;
      const offscreenControls = layout.controls.filter((item) => item.offscreen && baselineControls.has(item.selector) && !baselineControls.get(item.selector).offscreen).slice(0, 3);
      for (const control of offscreenControls) {
        findings.push(finding({
          ruleId: "offscreen-critical-control", scenarioId: viewport.id, classification: "new", severity: "major", confidence: "high",
          title: `${control.name || "A control"} is outside the ${viewport.id} viewport`, titleZh: `${control.name ? `“${control.name}”` : "关键控件"}位于 ${viewport.id} 视口之外`,
          summary: `A control available at desktop width is fully outside the ${viewport.width}px viewport.`, summaryZh: `桌面端可用的控件在 ${viewport.width}px 视口中完全不可见。`,
          selector: control.selector,
          measurements: { viewportId: viewport.id, viewportWidth: viewport.width, viewportHeight: viewport.height, touch: viewport.touch, documentScrollWidth: layout.documentScrollWidth, overflowPixels: layout.overflowPixels, boundingBox: control.rect },
          evidence: [{ type: "dom", selector: control.selector, boundingBox: control.rect }, screenshotEvidence(viewport.id, `${dimensions} responsive viewport`)],
          steps: [`Open the page with the ${viewport.id} ${dimensions} viewport.`, `Locate ${control.name || control.selector} without horizontal scrolling.`],
          stepsZh: [`使用 ${viewport.id}（${dimensions}）视口打开页面。`, `在不进行横向滚动的情况下查找 ${control.name || control.selector}。`],
          fix: "Keep the control in normal responsive flow at this breakpoint.", fixZh: "在该断点中让控件保持在正常的响应式布局流内。",
          hints: ["Remove fixed minimum widths and stack actions below headings when space is constrained."], hintsZh: ["移除固定最小宽度，并在空间不足时把操作按钮排列到标题下方。"],
        }));
      }
      if (layout.overflowPixels > 2 && offscreenControls.length === 0) {
        const culprit = layout.culprits[0];
        findings.push(finding({
          ruleId: "document-horizontal-overflow", scenarioId: viewport.id, classification: baselineLayout.overflowPixels > 2 ? "worsened" : "new", severity: layout.overflowPixels > Math.max(80, Math.round(viewport.width * 0.25)) ? "major" : "minor", confidence: "high",
          title: `The document overflows the ${viewport.id} viewport`, titleZh: `页面在 ${viewport.id} 视口中产生横向溢出`,
          summary: `The document is ${layout.overflowPixels}px wider than the ${viewport.width}px viewport.`, summaryZh: `页面比 ${viewport.width}px 视口宽 ${layout.overflowPixels}px。`,
          selector: culprit?.selector,
          measurements: { viewportId: viewport.id, viewportWidth: viewport.width, viewportHeight: viewport.height, touch: viewport.touch, documentScrollWidth: layout.documentScrollWidth, overflowPixels: layout.overflowPixels },
          evidence: [{ type: "dom", culprits: layout.culprits }, screenshotEvidence(viewport.id, `${dimensions} responsive viewport`)],
          steps: [`Open the page with the ${viewport.id} ${dimensions} viewport.`, "Compare document scroll width with the viewport width."],
          stepsZh: [`使用 ${viewport.id}（${dimensions}）视口打开页面。`, "比较文档滚动宽度和视口宽度。"],
          fix: "Remove the fixed-width constraint that expands the page beyond the configured viewport.", fixZh: "移除导致页面超出配置视口的固定宽度约束。",
        }));
      }
      const smallTargets = viewport.touch ? layout.controls.filter((item) =>
        (["button", "input", "select", "textarea"].includes(item.tag) || item.role === "button")
        && (item.rect.width < 24 || item.rect.height < 24)
      ).slice(0, 3) : [];
      for (const control of smallTargets) {
        findings.push(finding({
          ruleId: "minimum-interactive-size", scenarioId: viewport.id, classification: "new", severity: "minor", confidence: "medium",
          title: "An interactive target is smaller than 24×24 CSS pixels", titleZh: "交互目标小于 24×24 CSS 像素",
          summary: `The ${control.rect.width}×${control.rect.height}px control is difficult to activate accurately in the configured touch viewport.`, summaryZh: `该控件尺寸为 ${control.rect.width}×${control.rect.height}px，在配置的触控视口中难以准确操作。`,
          selector: control.selector,
          measurements: { viewportId: viewport.id, viewportWidth: viewport.width, viewportHeight: viewport.height, touch: true, minimumWidth: 24, minimumHeight: 24, boundingBox: control.rect },
          evidence: [{ type: "dom", selector: control.selector, boundingBox: control.rect }, screenshotEvidence(viewport.id, `${dimensions} small touch target`)],
          steps: [`Open the page with the ${viewport.id} ${dimensions} viewport.`, `Measure the rendered target size of ${control.selector}.`],
          stepsZh: [`使用 ${viewport.id}（${dimensions}）视口打开页面。`, `测量 ${control.selector} 的渲染目标尺寸。`],
          fix: "Increase the rendered hit area to at least 24×24 CSS pixels without shrinking adjacent spacing.", fixZh: "将实际点击区域扩大到至少 24×24 CSS 像素，同时保留相邻目标间距。",
          hints: ["Padding can enlarge the hit area without changing the icon itself."], hintsZh: ["可以通过内边距扩大点击区域，而不必放大图标本身。"],
        }));
      }
      results.set(viewport.id, scenarioResult(viewport.id, findings.length > viewportStart ? "completed-with-findings" : "passed", responsive.durationMs(), [`Evaluated ${dimensions}; touch-target checks were ${viewport.touch ? "enabled" : "disabled"}.`], [`已核查 ${dimensions}；触控目标检查${viewport.touch ? "已启用" : "已禁用"}。`]));
    } finally {
      await responsive.context.close();
    }
  }

  logQuick("Long text");
  const longText = await createPage(browser, target, "long-text", runDirectory, contextOptions);
  const mutationCount = await longText.page.evaluate((fixtures) => {
    const priority = [...document.querySelectorAll("[data-testid],button,a,label,th,td,h1,h2,h3,strong,.badge,.status")];
    const seen = new Set();
    const targets = priority.filter((element) => {
      if (seen.has(element) || element.children.length > 0 || element.closest("script,style,code,pre,svg,canvas,[contenteditable=true]")) return false;
      const text = (element.textContent || "").trim();
      if (!text || text.length > 80) return false;
      seen.add(element);
      return true;
    }).slice(0, 80);
    targets.forEach((element, index) => { element.textContent = fixtures[index % fixtures.length]; });
    return targets.length;
  }, FIXTURES);
  await settle(longText.page);
  await longText.page.screenshot({ path: join(runDirectory, "screenshots", "long-text.png"), fullPage: true });
  const longLayout = await inspectLayout(longText.page);
  const longStart = findings.length;
  for (const clipped of longLayout.clipped.filter((item) => !baselineClipped.has(item.selector) || item.clippedPixels > baselineClipped.get(item.selector).clippedPixels + 2).slice(0, 5)) {
    findings.push(finding({
      ruleId: "element-text-clipping", scenarioId: "long-text", classification: baselineClipped.has(clipped.selector) ? "worsened" : "new", severity: clipped.clippedPixels > 80 ? "major" : "minor", confidence: "high",
      title: "Long content is clipped without access to the full value", titleZh: "长内容被截断，用户无法访问完整值",
      summary: `Injected content is clipped by ${clipped.clippedPixels}px in a constrained element.`, summaryZh: `注入的长内容在受限元素中被截断 ${clipped.clippedPixels}px。`,
      selector: clipped.selector,
      measurements: { clientWidth: clipped.clientWidth, scrollWidth: clipped.scrollWidth, clippedPixels: clipped.clippedPixels },
      evidence: [{ type: "dom", selector: clipped.selector, text: clipped.text }, screenshotEvidence("long-text", "Long-text stress state")],
      steps: ["Run the deterministic long-text scenario with seed 42.", `Inspect ${clipped.selector}.`],
      stepsZh: ["使用种子 42 运行确定性的长文本场景。", `检查 ${clipped.selector}。`],
      fix: "Preserve access to the full value while allowing the component to reflow.", fixZh: "允许组件重新排版，同时保证用户可以访问完整内容。",
      hints: ["Allow wrapping or provide an accessible expansion or tooltip mechanism."], hintsZh: ["允许换行，或提供支持键盘和读屏器的展开/提示机制。"],
    }));
  }
  results.set("long-text", scenarioResult("long-text", findings.length > longStart ? "completed-with-findings" : "passed", longText.durationMs(), [`${mutationCount} deterministic text mutations were applied.`], [`已执行 ${mutationCount} 次确定性的文本替换。`]));
  await longText.context.close();

  logQuick("RTL Arabic");
  const rtl = await createPage(browser, target, "rtl-arabic", runDirectory, contextOptions);
  await rtl.page.evaluate(() => {
    document.documentElement.lang = "ar";
    document.documentElement.dir = "rtl";
    const fixtures = ["لوحة التحكم", "الطلبات", "قيد المراجعة", "آخر سبعة أيام"];
    [...document.querySelectorAll("button,a,label,h1,h2,h3,.status")].filter((element) => element.children.length === 0 && (element.textContent || "").trim()).slice(0, 30).forEach((element, index) => { element.textContent = fixtures[index % fixtures.length]; });
  });
  await settle(rtl.page);
  await rtl.page.screenshot({ path: join(runDirectory, "screenshots", "rtl-arabic.png"), fullPage: true });
  const physicalSpacing = await rtl.page.evaluate(() => {
    const visible = (element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"; };
    const selectorFor = (element) => {
      const testId = element.getAttribute("data-testid");
      if (testId) {
        const candidate = `[data-testid="${CSS.escape(testId)}"]`;
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      }
      if (element.id) return `#${CSS.escape(element.id)}`;
      const parts = [];
      let current = element;
      while (current && current !== document.body && parts.length < 6) {
        let part = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (parent) {
          const siblings = [...parent.children].filter((item) => item.tagName === current.tagName);
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
        parts.unshift(part);
        current = parent;
      }
      return `body > ${parts.join(" > ")}`;
    };
    return [...document.querySelectorAll("*")].slice(0, 2000).filter(visible).map((element) => ({ element, style: getComputedStyle(element) })).filter(({ style }) => style.marginLeft === "auto" && style.marginInlineStart !== "auto").slice(0, 5).map(({ element, style }) => ({ selector: selectorFor(element), marginLeft: style.marginLeft, marginRight: style.marginRight, marginInlineStart: style.marginInlineStart }));
  });
  const rtlStart = findings.length;
  for (const item of physicalSpacing.slice(0, 3)) {
    findings.push(finding({
      ruleId: "rtl-physical-spacing", scenarioId: "rtl-arabic", classification: "new", severity: "minor", confidence: "high",
      title: "Physical spacing does not follow RTL direction", titleZh: "物理方向的间距没有跟随 RTL 书写方向",
      summary: "An auto margin remains attached to the physical left side instead of the logical inline start.", summaryZh: "自动外边距仍绑定在物理左侧，而不是逻辑行内起始侧。",
      selector: item.selector,
      measurements: { direction: "rtl", marginLeft: item.marginLeft, marginRight: item.marginRight, marginInlineStart: item.marginInlineStart },
      evidence: [{ type: "dom", selector: item.selector, computedStyle: item }, screenshotEvidence("rtl-arabic", "RTL directionality stress state")],
      steps: ["Set html lang=ar and dir=rtl in a fresh context.", `Inspect logical alignment of ${item.selector}.`],
      stepsZh: ["在新的浏览器上下文中设置 html lang=ar 和 dir=rtl。", `检查 ${item.selector} 的逻辑方向对齐。`],
      fix: "Use logical CSS properties so spacing follows the document direction.", fixZh: "使用逻辑 CSS 属性，让间距跟随文档书写方向。",
      hints: ["Replace margin-left/right with margin-inline-start/end where direction should mirror."], hintsZh: ["需要镜像的间距应使用 margin-inline-start/end 替代 margin-left/right。"],
    }));
  }
  results.set("rtl-arabic", scenarioResult("rtl-arabic", findings.length > rtlStart ? "completed-with-findings" : "passed", rtl.durationMs(), ["Directionality stress test only; translation quality was not assessed."], ["仅进行书写方向压力测试；未评估翻译质量。"]));
  await rtl.context.close();

  logQuick("Image failure");
  const imageFailure = await createPage(browser, target, "image-failure", runDirectory, {
    ...contextOptions,
    route: async (context) => context.route("**/*", async (route) => route.request().resourceType() === "image" ? route.abort("failed") : route.continue()),
    expectedFailure: (request) => request.resourceType() === "image",
  });
  const failedImageLayout = await inspectLayout(imageFailure.page);
  const imageStart = findings.length;
  for (const image of failedImageLayout.images.filter((item) => !item.altPresent).slice(0, 5)) {
    const baselineImage = baselineImages.get(image.selector);
    findings.push(finding({
      ruleId: "image-alt", scenarioId: "image-failure", classification: baselineImage?.altPresent === false ? "existing" : "new", severity: "minor", confidence: "high",
      title: "An image has no text alternative", titleZh: "图片没有文本替代内容",
      summary: "When the image request fails, the markup does not declare whether the image is decorative or meaningful.", summaryZh: "图片请求失败时，标记没有说明该图片是装饰性的还是具有实际含义。",
      selector: image.selector,
      measurements: { altPresent: false, renderedWidth: image.renderedWidth, renderedHeight: image.renderedHeight },
      evidence: [{ type: "dom", selector: image.selector, altPresent: false }, screenshotEvidence("image-failure", "Image-failure state")],
      steps: ["Abort image requests before navigation.", `Inspect ${image.selector} for an alt attribute.`],
      stepsZh: ["在导航前中止图片请求。", `检查 ${image.selector} 是否包含 alt 属性。`],
      fix: "Declare the image decorative with alt=\"\" or provide a concise alternative.", fixZh: "使用 alt=\"\" 声明装饰性图片，或提供简洁的替代文本。",
    }));
  }
  results.set("image-failure", scenarioResult("image-failure", findings.length > imageStart ? "completed-with-findings" : "passed", imageFailure.durationMs(), ["Expected image request aborts were excluded from failed-request findings."], ["预期的图片请求中止未计入普通请求失败问题。"]));
  await imageFailure.context.close();

  logQuick("Keyboard Tab");
  const keyboard = await createPage(browser, target, "keyboard-tab", runDirectory, contextOptions);
  const focusSequence = [];
  for (let index = 0; index < 30; index += 1) {
    await keyboard.page.keyboard.press("Tab");
    const focused = await keyboard.page.evaluate(() => {
      const element = document.activeElement;
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        tag: element.tagName.toLowerCase(),
        selector: element.getAttribute("data-testid") ? `[data-testid="${element.getAttribute("data-testid")}"]` : element.id ? `#${element.id}` : `${element.tagName.toLowerCase()}${[...element.classList].slice(0, 2).map((item) => `.${item}`).join("")}`,
        name: (element.getAttribute("aria-label") || element.textContent || "").trim().slice(0, 100),
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        boxShadow: style.boxShadow,
      };
    });
    if (focused) focusSequence.push(focused);
    if (focusSequence.length >= 8) {
      const recent = focusSequence.slice(-4).map((item) => item.selector).join("|");
      const previous = focusSequence.slice(-8, -4).map((item) => item.selector).join("|");
      if (recent === previous) break;
    }
  }
  await keyboard.page.screenshot({ path: join(runDirectory, "screenshots", "keyboard-tab.png"), fullPage: true });
  const keyboardStart = findings.length;
  const noMovement = focusSequence.length === 0 || focusSequence.every((item) => item.tag === "body");
  if (noMovement) {
    findings.push(finding({
      ruleId: "keyboard-focus-movement", scenarioId: "keyboard-tab", classification: "existing", severity: "major", confidence: "high",
      title: "Keyboard focus never reaches an interactive control", titleZh: "键盘焦点始终无法到达交互控件",
      summary: "Repeated Tab presses did not move focus from the document body.", summaryZh: "重复按下 Tab 后，焦点仍未离开文档主体。",
      measurements: { tabPresses: focusSequence.length }, evidence: [{ type: "focus-sequence", entries: focusSequence }, screenshotEvidence("keyboard-tab", "Keyboard focus state")],
      steps: ["Open the page without using a pointer.", "Press Tab repeatedly and observe the active element."], stepsZh: ["不使用指针设备打开页面。", "重复按下 Tab 并观察活动元素。"],
      fix: "Restore native keyboard reachability for interactive controls.", fixZh: "恢复交互控件的原生键盘可达性。",
    }));
  } else {
    const invisible = focusSequence.find((item) => item.tag !== "body" && item.outlineStyle === "none" && (item.boxShadow === "none" || item.boxShadow === ""));
    if (invisible) {
      findings.push(finding({
        ruleId: "keyboard-focus-visibility", scenarioId: "keyboard-tab", classification: "existing", severity: "minor", confidence: "low",
        title: "Keyboard focus may not be visibly indicated", titleZh: "键盘焦点可能没有可见指示",
        summary: "Computed focus styles contain neither an outline nor a box shadow; pixel-difference evidence still needs review.", summaryZh: "计算焦点样式既没有轮廓也没有阴影，仍需人工复核像素差异证据。",
        selector: invisible.selector,
        measurements: { outlineStyle: invisible.outlineStyle, outlineWidth: invisible.outlineWidth, boxShadow: invisible.boxShadow },
        evidence: [{ type: "focus-sequence", entries: focusSequence.slice(0, 30) }, screenshotEvidence("keyboard-tab", "Keyboard focus state")],
        steps: ["Navigate the page using only Tab.", `Observe focus on ${invisible.selector}.`], stepsZh: ["只使用 Tab 键在页面中导航。", `观察 ${invisible.selector} 获得焦点时的显示效果。`],
        fix: "Restore a high-contrast focus-visible style without removing the native outline globally.", fixZh: "恢复高对比度的 focus-visible 样式，不要全局移除原生轮廓。",
        hints: ["Use :focus-visible with a two-pixel outline and offset."], hintsZh: ["使用 :focus-visible，并设置两像素轮廓和适当的偏移。"],
      }));
    }
  }
  results.set("keyboard-tab", scenarioResult("keyboard-tab", findings.length > keyboardStart ? "completed-with-findings" : "passed", keyboard.durationMs(), ["No controls were activated or submitted."], ["未激活或提交任何控件。"]));
  await keyboard.context.close();

  for (const item of findings) item.url = finalUrl;
  return { findings, results, targetTitle, finalUrl, baselineLayout, linkSummary, visualSummary };
}

async function runDeepScenarios(browser, target, runDirectory, findings, results, contextOptions = {}, quickScenarioCount = 6) {
  const deepTotal = quickScenarioCount + 7;
  let deepStep = quickScenarioCount;
  const logDeep = (label) => console.log(`  ${String(++deepStep).padStart(2, " ")}/${deepTotal} ${label}`);
  logDeep("Page zoom 200% (unsupported)");
  results.set("page-zoom-200", scenarioResult("page-zoom-200", "unsupported", 0, ["Real page zoom is not exposed by the standalone adapter."], ["独立适配器目前无法可靠控制真实页面缩放。"]));

  logDeep("Reduced motion");
  const reduced = await createPage(browser, target, "reduced-motion", runDirectory, { ...contextOptions, reducedMotion: "reduce" });
  const persistentAnimations = await reduced.page.evaluate(() => {
    const selectorFor = (element) => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const testId = element.getAttribute("data-testid");
      if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
      const parts = [];
      let current = element;
      while (current && current !== document.body && parts.length < 6) {
        let part = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (parent) {
          const siblings = [...parent.children].filter((item) => item.tagName === current.tagName);
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
        parts.unshift(part);
        current = parent;
      }
      return `body > ${parts.join(" > ")}`;
    };
    return document.getAnimations().map((animation) => {
      const targetElement = animation.effect?.target;
      const timing = animation.effect?.getComputedTiming?.() || {};
      return { animation, targetElement, timing };
    }).filter(({ animation, targetElement, timing }) =>
      targetElement instanceof Element
      && ["running", "pending"].includes(animation.playState)
      && !targetElement.closest('[aria-busy="true"],[role="progressbar"],progress')
      && ((Number.isFinite(timing.duration) && timing.duration > 200) || timing.duration === Infinity)
      && (timing.iterations === Infinity || Number(timing.iterations || 1) > 1)
    ).slice(0, 10).map(({ targetElement, timing }) => ({
      selector: selectorFor(targetElement),
      durationMs: timing.duration === Infinity ? "infinite" : Math.round(timing.duration),
      iterations: timing.iterations === Infinity ? "infinite" : timing.iterations,
    }));
  });
  if (persistentAnimations.length) {
    findings.push(finding({
      ruleId: "reduced-motion-persistent-animation", scenarioId: "reduced-motion", classification: "new", severity: "minor", confidence: "medium",
      title: "Persistent motion continues when reduced motion is requested", titleZh: "请求减少动态效果后仍存在持续动画",
      summary: `${persistentAnimations.length} non-progress animation(s) remained active under prefers-reduced-motion: reduce.`, summaryZh: `在 prefers-reduced-motion: reduce 环境下仍有 ${persistentAnimations.length} 个非进度动画持续运行。`,
      selector: persistentAnimations[0].selector,
      measurements: { preference: "reduce", animations: persistentAnimations },
      evidence: [{ type: "animation", entries: persistentAnimations }, screenshotEvidence("reduced-motion", "Reduced-motion preference")],
      steps: ["Open the page with prefers-reduced-motion set to reduce.", "Inspect persistent non-progress animations after the page settles."],
      stepsZh: ["在 prefers-reduced-motion 设置为 reduce 的环境中打开页面。", "页面稳定后检查持续运行的非进度动画。"],
      fix: "Disable or substantially shorten non-essential repeated motion when the user requests reduced motion.", fixZh: "当用户请求减少动态效果时，禁用或显著缩短非必要的重复动画。",
      hints: ["Use @media (prefers-reduced-motion: reduce) and preserve essential state feedback without motion."], hintsZh: ["使用 @media (prefers-reduced-motion: reduce)，并以无动态方式保留必要状态反馈。"],
    }));
  }
  results.set("reduced-motion", scenarioResult("reduced-motion", persistentAnimations.length ? "completed-with-findings" : "passed", reduced.durationMs(), [`Observed ${persistentAnimations.length} persistent non-progress animation(s).`], [`观察到 ${persistentAnimations.length} 个持续运行的非进度动画。`]));
  await reduced.context.close();

  logDeep("Dark color scheme");
  const dark = await createPage(browser, target, "dark-scheme", runDirectory, { ...contextOptions, colorScheme: "dark" });
  const darkInspection = await dark.page.evaluate(() => {
    const hasDarkRule = () => {
      const visit = (rules) => [...rules].some((rule) => {
        if (rule.conditionText?.includes("prefers-color-scheme") && rule.conditionText.includes("dark")) return true;
        try { return rule.cssRules ? visit(rule.cssRules) : false; } catch (_) { return false; }
      });
      return [...document.styleSheets].some((sheet) => { try { return visit(sheet.cssRules); } catch (_) { return false; } });
    };
    const parse = (value) => {
      const match = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?/i);
      return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])] : null;
    };
    const luminance = (rgb) => {
      const channels = rgb.slice(0, 3).map((channel) => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; });
      return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
    };
    const ratio = (a, b) => { const first = luminance(a); const second = luminance(b); return (Math.max(first, second) + .05) / (Math.min(first, second) + .05); };
    const selectorFor = (element) => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const testId = element.getAttribute("data-testid");
      if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
      const parts = [];
      let current = element;
      while (current && current !== document.body && parts.length < 6) {
        let part = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (parent) { const siblings = [...parent.children].filter((item) => item.tagName === current.tagName); if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`; }
        parts.unshift(part); current = parent;
      }
      return `body > ${parts.join(" > ")}`;
    };
    const supportsDark = hasDarkRule();
    if (!supportsDark) return { supportsDark, lowContrast: [] };
    const candidates = [...document.querySelectorAll("body *")].filter((element) => {
      const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
      return element.children.length === 0 && (element.textContent || "").trim() && rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    }).slice(0, 500);
    const lowContrast = [];
    for (const element of candidates) {
      const style = getComputedStyle(element);
      const foreground = parse(style.color);
      if (!foreground || foreground[3] < .95) continue;
      let current = element;
      let background = null;
      while (current && !background) {
        const parsed = parse(getComputedStyle(current).backgroundColor);
        if (parsed && parsed[3] >= .95) background = parsed;
        current = current.parentElement;
      }
      if (!background) continue;
      const contrast = ratio(foreground, background);
      const fontSize = Number.parseFloat(style.fontSize) || 16;
      const fontWeight = Number.parseInt(style.fontWeight, 10) || 400;
      const threshold = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? 3 : 4.5;
      if (contrast + .05 < threshold) lowContrast.push({ selector: selectorFor(element), contrast: Number(contrast.toFixed(2)), threshold, fontSize, fontWeight });
      if (lowContrast.length >= 10) break;
    }
    return { supportsDark, lowContrast };
  });
  if (darkInspection.lowContrast.length) {
    findings.push(finding({
      ruleId: "dark-scheme-low-contrast", scenarioId: "dark-scheme", classification: "new", severity: "minor", confidence: "medium",
      title: "Dark mode contains low-contrast text", titleZh: "深色模式中存在低对比度文本",
      summary: `${darkInspection.lowContrast.length} visible text sample(s) fell below the size-adjusted contrast threshold in the declared dark scheme.`, summaryZh: `在页面声明的深色模式中，有 ${darkInspection.lowContrast.length} 个可见文本样本低于按字号调整的对比度阈值。`,
      selector: darkInspection.lowContrast[0].selector,
      measurements: { preference: "dark", samples: darkInspection.lowContrast },
      evidence: [{ type: "computed-contrast", samples: darkInspection.lowContrast }, screenshotEvidence("dark-scheme", "Declared dark color scheme")],
      steps: ["Open the page with prefers-color-scheme set to dark.", "Measure computed foreground and opaque ancestor background colors for visible leaf text."],
      stepsZh: ["在 prefers-color-scheme 设置为 dark 的环境中打开页面。", "测量可见叶子文本的前景色与不透明祖先背景色。"],
      fix: "Adjust the dark-theme foreground or background tokens while preserving semantic color meaning.", fixZh: "调整深色主题的前景色或背景色令牌，同时保留颜色的语义。",
      hints: ["Review the recorded computed ratios; complex transparency still requires visual review."], hintsZh: ["复核记录的计算对比度；复杂透明叠加仍需视觉检查。"],
    }));
  }
  const darkStatus = darkInspection.supportsDark ? (darkInspection.lowContrast.length ? "completed-with-findings" : "passed") : "skipped";
  results.set("dark-scheme", scenarioResult("dark-scheme", darkStatus, dark.durationMs(), darkInspection.supportsDark ? ["A declared dark color-scheme rule was evaluated."] : ["No declared prefers-color-scheme: dark rule was found."], darkInspection.supportsDark ? ["已核查页面声明的深色模式规则。"] : ["未发现页面声明 prefers-color-scheme: dark 规则。"]));
  await dark.context.close();

  logDeep("Slow API");
  let delayedRequests = 0;
  let pendingDelayedRequests = 0;
  const slow = await createPage(browser, target, "slow-api", runDirectory, {
    ...contextOptions,
    route: async (context) => context.route("**/*", async (route) => {
      const request = route.request();
      const sameOrigin = new URL(request.url()).origin === new URL(target).origin;
      if (sameOrigin && ["xhr", "fetch"].includes(request.resourceType()) && delayedRequests < 30) {
        delayedRequests += 1;
        pendingDelayedRequests += 1;
        try {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 3000));
        } finally {
          pendingDelayedRequests -= 1;
        }
      }
      await route.continue();
    }),
  });
  const slowStart = findings.length;
  let duringState = null;
  let finalState = null;
  if (delayedRequests) {
    duringState = await inspectAsyncState(slow.page);
    await slow.page.screenshot({ path: join(runDirectory, "screenshots", "slow-api-loading.png"), fullPage: true });
    const deadline = Date.now() + 6000;
    while (pendingDelayedRequests > 0 && Date.now() < deadline) await slow.page.waitForTimeout(100);
    await settle(slow.page, 2500);
    finalState = await inspectAsyncState(slow.page);
    await slow.page.screenshot({ path: join(runDirectory, "screenshots", "slow-api.png"), fullPage: true });
    const blankDuringLoad = duringState.visibleTextLength < 20 && duringState.interactive === 0;
    const stuckLoading = duringState.loadingSignals.length > 0 && finalState.loadingSignals.length > 0 && finalState.dataRows === duringState.dataRows && finalState.visibleTextLength === duringState.visibleTextLength;
    const changedAfterRecovery = finalState.dataRows !== duringState.dataRows || finalState.visibleTextLength !== duringState.visibleTextLength;
    if (blankDuringLoad || stuckLoading) {
      findings.push(finding({
        ruleId: blankDuringLoad ? "blank-loading-state" : "stuck-loading-state", scenarioId: "slow-api", classification: "new", severity: "major", confidence: "high",
        title: blankDuringLoad ? "The UI is blank while data is delayed" : "The UI remains stuck after delayed requests recover", titleZh: blankDuringLoad ? "数据延迟时界面为空白" : "延迟请求恢复后界面仍停留在加载状态",
        summary: blankDuringLoad ? "The delayed API state exposed neither meaningful content nor an interactive fallback." : "The same loading signal and content measurements remained after every delayed request continued.", summaryZh: blankDuringLoad ? "API 延迟期间既没有有意义的内容，也没有可交互的降级入口。" : "所有延迟请求继续后，加载提示和内容测量值仍未变化。",
        measurements: { delayedRequests, during: duringState, final: finalState },
        evidence: [screenshotEvidence("slow-api-loading", "During delayed API requests"), screenshotEvidence("slow-api", "After delayed requests continued")],
        steps: ["Delay safe same-origin fetch/XHR requests by 3 seconds.", "Compare the loading checkpoint with the settled state after every delayed request continues."],
        stepsZh: ["把安全的同源 fetch/XHR 请求延迟 3 秒。", "比较加载检查点与所有延迟请求继续后的稳定状态。"],
        fix: blankDuringLoad ? "Keep meaningful structure and a clear loading status visible while data is pending." : "Clear the loading state and render recovered content or an actionable error after the request settles.",
        fixZh: blankDuringLoad ? "数据等待期间保留有意义的页面结构，并显示清晰的加载状态。" : "请求结束后清除加载状态，并显示恢复后的内容或可操作的错误。",
      }));
    } else if (changedAfterRecovery && duringState.loadingSignals.length === 0) {
      findings.push(finding({
        ruleId: "missing-loading-feedback", scenarioId: "slow-api", classification: "new", severity: "minor", confidence: "high",
        title: "Delayed data has no visible loading feedback", titleZh: "数据延迟期间没有可见的加载反馈",
        summary: "The content changed after delayed requests recovered, but no loading status was exposed while the data was pending.", summaryZh: "延迟请求恢复后内容发生了变化，但等待数据期间没有显示加载状态。",
        measurements: { delayedRequests, during: duringState, final: finalState },
        evidence: [screenshotEvidence("slow-api-loading", "During delayed API requests"), screenshotEvidence("slow-api", "After delayed requests continued")],
        steps: ["Delay safe same-origin fetch/XHR requests by 3 seconds.", "Observe the data region before and after recovery."],
        stepsZh: ["把安全的同源 fetch/XHR 请求延迟 3 秒。", "观察恢复前后的数据区域。"],
        fix: "Expose a concise, accessible loading status while keeping the page structure stable.", fixZh: "在保持页面结构稳定的同时，显示简洁且可访问的加载状态。",
      }));
    }
  }
  const slowStatus = delayedRequests ? (findings.length > slowStart ? "completed-with-findings" : "passed") : "skipped";
  results.set("slow-api", scenarioResult("slow-api", slowStatus, slow.durationMs(), delayedRequests ? [`Delayed ${delayedRequests} same-origin API request(s); compared loading and recovered checkpoints.`] : ["No safe same-origin API request was observed."], delayedRequests ? [`延迟了 ${delayedRequests} 个同源 API 请求，并比较了加载与恢复检查点。`] : ["没有观察到可安全延迟的同源 API 请求。"]));
  await slow.context.close();

  logDeep("API error recovery");
  let errorResponses = 0;
  const apiError = await createPage(browser, target, "api-error", runDirectory, {
    ...contextOptions,
    route: async (context) => context.route("**/*", async (route) => {
      const request = route.request();
      const sameOrigin = new URL(request.url()).origin === new URL(target).origin;
      if (sameOrigin && request.method() === "GET" && ["xhr", "fetch"].includes(request.resourceType()) && errorResponses < 5) {
        errorResponses += 1;
        return route.fulfill({
          status: 503,
          contentType: "application/json; charset=utf-8",
          headers: { "cache-control": "no-store" },
          body: JSON.stringify({ error: "realitycheck-simulated-unavailable" }),
        });
      }
      return route.continue();
    }),
  });
  const errorState = await apiError.page.evaluate(() => {
    const text = (document.body?.innerText || "").trim();
    const errorSignal = text.match(/\b(error|failed|failure|unavailable|unable|retry|try again|offline)\b|失败|错误|不可用|重试|离线/i)?.[0] || null;
    const semantic = [...document.querySelectorAll('[role="alert"],[aria-live="assertive"],[class*="error" i],[class*="failure" i]')]
      .filter((element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"; })
      .slice(0, 10).length;
    return {
      hasErrorFeedback: Boolean(errorSignal || semantic),
      semanticErrorRegions: semantic,
      dataRows: document.querySelectorAll("tbody tr,[role=rowgroup] [role=row]").length,
      interactive: document.querySelectorAll("a[href],button,input,select,textarea,[role=button]").length,
    };
  });
  if (errorResponses && !errorState.hasErrorFeedback) {
    findings.push(finding({
      ruleId: "missing-api-error-feedback", scenarioId: "api-error", classification: "new", severity: "major", confidence: "high",
      title: "API failure has no visible recovery feedback", titleZh: "API 失败后没有可见的恢复反馈",
      summary: `${errorResponses} safe same-origin API request(s) returned 503, but the page exposed no recognizable error, offline, unavailable, or retry status.`, summaryZh: `${errorResponses} 个安全的同源 API 请求返回 503，但页面没有显示可识别的错误、离线、不可用或重试状态。`,
      measurements: { simulatedStatus: 503, transformedRequests: errorResponses, state: errorState },
      evidence: [{ type: "network-mutation", method: "GET", status: 503, transformedRequests: errorResponses }, screenshotEvidence("api-error", "Simulated API 503 state")],
      steps: ["Return HTTP 503 for safe same-origin GET fetch/XHR requests.", "Observe whether the affected region explains the failure or offers recovery."],
      stepsZh: ["让安全的同源 GET fetch/XHR 请求返回 HTTP 503。", "观察受影响区域是否说明失败原因或提供恢复操作。"],
      fix: "Render a concise accessible error state and a safe retry or recovery action for failed data requests.", fixZh: "为数据请求失败显示简洁、可访问的错误状态，并提供安全的重试或恢复操作。",
      hints: ["Do not keep stale loading indicators or silently render an empty success state for a server failure."], hintsZh: ["服务器失败时不要一直保留加载提示，也不要静默显示空的成功状态。"],
    }));
  }
  results.set("api-error", scenarioResult("api-error", errorResponses ? (errorState.hasErrorFeedback ? "passed" : "completed-with-findings") : "skipped", apiError.durationMs(), errorResponses ? [`Returned 503 for ${errorResponses} safe same-origin API request(s).`] : ["No safe same-origin API request was observed."], errorResponses ? [`让 ${errorResponses} 个安全的同源 API 请求返回 503。`] : ["没有观察到可安全变更的同源 API 请求。"]));
  await apiError.context.close();

  logDeep("Empty data");
  let transformedResponses = 0;
  const empty = await createPage(browser, target, "empty-data", runDirectory, {
    ...contextOptions,
    route: async (context) => context.route("**/*", async (route) => {
      const request = route.request();
      const sameOrigin = new URL(request.url()).origin === new URL(target).origin;
      if (!sameOrigin || request.method() !== "GET" || !["xhr", "fetch"].includes(request.resourceType())) return route.continue();
      const response = await route.fetch();
      const contentType = response.headers()["content-type"] || "";
      if (!contentType.includes("json")) return route.fulfill({ response });
      try {
        const data = await response.json();
        if (Array.isArray(data)) {
          transformedResponses += 1;
          return route.fulfill({ response, json: [] });
        }
      } catch (_) {}
      return route.fulfill({ response });
    }),
  });
  const emptyState = await empty.page.evaluate(() => ({
    dataRows: document.querySelectorAll("tbody tr,[role=rowgroup] [role=row]").length,
    hasEmptyMessage: /(no\s+(data|items|results|orders)|empty|暂无|没有数据|无记录)/i.test(document.body?.innerText || ""),
  }));
  if (transformedResponses && emptyState.dataRows === 0 && !emptyState.hasEmptyMessage) {
    findings.push(finding({
      ruleId: "missing-empty-state", scenarioId: "empty-data", classification: "new", severity: "minor", confidence: "high",
      title: "Empty data has no explanatory state", titleZh: "空数据没有说明性状态",
      summary: "A safe API array was replaced with an empty array, but the UI showed neither data rows nor an empty-state explanation.", summaryZh: "安全的 API 数组被替换为空数组后，界面既没有数据行，也没有空状态说明。",
      measurements: { transformedResponses, dataRows: emptyState.dataRows, hasEmptyMessage: false }, evidence: [screenshotEvidence("empty-data", "Empty-data state")],
      steps: ["Replace a safe same-origin JSON array response with an empty array.", "Observe the data region after the page settles."], stepsZh: ["把安全的同源 JSON 数组响应替换为空数组。", "页面稳定后观察数据区域。"],
      fix: "Render a clear empty state with a next action when the collection contains no records.", fixZh: "当集合没有记录时，显示清晰的空状态和下一步操作。",
    }));
  }
  results.set("empty-data", scenarioResult("empty-data", transformedResponses ? (findings.some((item) => item.scenarioId === "empty-data") ? "completed-with-findings" : "passed") : "skipped", empty.durationMs(), transformedResponses ? [`Transformed ${transformedResponses} safe JSON response(s).`] : ["No safe JSON array response was observed."], transformedResponses ? [`已转换 ${transformedResponses} 个安全 JSON 响应。`] : ["没有观察到可安全转换的 JSON 数组响应。"]));
  await empty.context.close();

  logDeep("axe-core");
  const axeStarted = Date.now();
  const axe = await createPage(browser, target, "axe", runDirectory, contextOptions);
  const axeStart = findings.length;
  try {
    await axe.page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const violations = await axe.page.evaluate(async () => {
      const result = await window.axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
        resultTypes: ["violations"],
      });
      return result.violations.slice(0, 50).map((violation) => ({
        id: violation.id,
        impact: violation.impact || "moderate",
        help: violation.help,
        description: violation.description,
        helpUrl: violation.helpUrl,
        tags: violation.tags.slice(0, 20),
        nodeCount: violation.nodes.length,
        nodes: violation.nodes.slice(0, 5).map((node) => ({
          target: node.target.slice(0, 4).map(String),
          failureSummary: (node.failureSummary || "").slice(0, 1_000),
          impact: node.impact || violation.impact || "moderate",
        })),
      }));
    });
    const impactSeverity = { critical: "critical", serious: "major", moderate: "minor", minor: "minor" };
    const impactZh = { critical: "致命", serious: "严重", moderate: "中等", minor: "轻微" };
    for (const violation of violations) {
      const firstSelector = violation.nodes[0]?.target?.join(" ") || undefined;
      const nodeEvidence = violation.nodes.map((node) => ({ type: "axe-node", target: node.target, impact: node.impact, failureSummary: node.failureSummary }));
      findings.push(finding({
        ruleId: `axe-${violation.id}`, scenarioId: "axe", classification: "existing", severity: impactSeverity[violation.impact] || "minor", confidence: "high",
        title: violation.help, titleZh: `axe 可访问性问题：${violation.help}`,
        summary: `${violation.description} Axe-core matched ${violation.nodeCount} node(s) with ${violation.impact} impact.`, summaryZh: `${violation.description} axe-core 匹配到 ${violation.nodeCount} 个节点，影响级别为${impactZh[violation.impact] || violation.impact}。`,
        selector: firstSelector,
        measurements: { axeRule: violation.id, impact: violation.impact, nodeCount: violation.nodeCount, sampledNodes: violation.nodes.length, tags: violation.tags },
        evidence: [...nodeEvidence, screenshotEvidence("axe", "Axe-core accessibility scan")],
        steps: ["Open the page in a fresh browser context.", `Run the bundled axe-core ${violation.id} rule and inspect the sampled targets.`],
        stepsZh: ["在新的浏览器上下文中打开页面。", `运行内置 axe-core 的 ${violation.id} 规则并检查抽样目标。`],
        fix: violation.help,
        fixZh: `根据 ${violation.id} 规则修复抽样节点，并使用辅助技术进行人工验证。`,
        hints: [...[...new Set(violation.nodes.map((node) => node.failureSummary).filter(Boolean))].slice(0, 5), `Rule guidance: ${violation.helpUrl}`],
        hintsZh: [...[...new Set(violation.nodes.map((node) => node.failureSummary).filter(Boolean))].slice(0, 5), `规则说明：${violation.helpUrl}`],
      }));
    }
    results.set("axe", scenarioResult(
      "axe",
      findings.length > axeStart ? "completed-with-findings" : "passed",
      Date.now() - axeStarted,
      [`Bundled axe-core evaluated WCAG A/AA and best-practice rules; ${violations.length} violation rule(s) were recorded with at most five sampled nodes each. Automated scanning does not establish WCAG conformance.`],
      [`内置 axe-core 已核查 WCAG A/AA 与最佳实践规则；记录 ${violations.length} 条违规规则，每条最多抽样五个节点。自动扫描不能证明 WCAG 合规。`],
    ));
  } catch (error) {
    results.set("axe", scenarioResult("axe", "failed", Date.now() - axeStarted, [`axe-core could not complete: ${String(error.message || error).slice(0, 300)}`], ["axe-core 未能完成；请检查浏览器注入与页面策略。"]));
  } finally {
    await axe.context.close();
  }
  for (const item of findings) if (!item.url) item.url = target;
}

async function evaluateJourneyAssertion(page, step) {
  return page.evaluate((rule) => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0;
    };
    const accessibleName = (element) => {
      const labelledBy = (element.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent || "").join(" ").trim();
      const labelText = [...(element.labels || [])].map((label) => label.textContent || "").join(" ").trim();
      const inputValue = element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type) ? element.value : "";
      return (element.getAttribute("aria-label") || labelledBy || labelText || element.getAttribute("alt") || element.getAttribute("title") || (element.textContent || "").trim() || inputValue || element.getAttribute("placeholder") || "").trim();
    };
    const nodes = [...document.querySelectorAll(rule.selector)].slice(0, 500);
    const options = rule.options || {};
    const minimum = options.min ?? 1;
    const maximum = options.max ?? Number.MAX_SAFE_INTEGER;
    const sample = nodes.slice(0, 20).map((element, index) => {
      const rect = element.getBoundingClientRect();
      const attributeValue = options.attribute ? element.getAttribute(options.attribute) : null;
      return {
        index,
        visible: visible(element),
        enabled: !element.disabled && element.getAttribute("aria-disabled") !== "true",
        hasAccessibleName: Boolean(accessibleName(element)),
        attributeMatches: options.attribute ? element.hasAttribute(options.attribute)
          && (options.equals === undefined || attributeValue === options.equals)
          && (options.contains === undefined || (attributeValue || "").includes(options.contains)) : null,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        overflowX: Math.max(0, element.scrollWidth - element.clientWidth),
      };
    });
    let passed = false;
    if (rule.assertion === "exists") passed = nodes.length >= minimum;
    if (rule.assertion === "visible") passed = nodes.length >= minimum && nodes.filter(visible).length >= minimum;
    if (rule.assertion === "enabled") passed = nodes.length >= minimum && nodes.filter((element) => !element.disabled && element.getAttribute("aria-disabled") !== "true").length >= minimum;
    if (rule.assertion === "accessible-name") passed = nodes.length >= minimum && nodes.every((element) => Boolean(accessibleName(element)));
    if (rule.assertion === "attribute") passed = nodes.length >= minimum && nodes.every((element) => {
      const value = element.getAttribute(options.attribute);
      return element.hasAttribute(options.attribute)
        && (options.equals === undefined || value === options.equals)
        && (options.contains === undefined || (value || "").includes(options.contains));
    });
    if (rule.assertion === "count") passed = nodes.length >= (options.min ?? 0) && nodes.length <= maximum;
    if (rule.assertion === "no-horizontal-overflow") passed = nodes.length >= minimum && nodes.every((element) => element.scrollWidth <= element.clientWidth + 2);
    if (rule.assertion === "minimum-size") passed = nodes.length >= minimum && nodes.filter(visible).every((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width >= (options.minWidth ?? 44) && rect.height >= (options.minHeight ?? 44);
    });
    return { passed, count: nodes.length, visibleCount: nodes.filter(visible).length, sample };
  }, step);
}

async function inspectJourneyClick(page, selector, target, crawl) {
  const locator = page.locator(selector);
  const count = await locator.count();
  if (count !== 1) throw new ConfigError(`Journey click selector ${JSON.stringify(selector)} must match exactly one element; matched ${count}`);
  const metadata = await locator.evaluate((element) => ({
    tag: element.tagName.toLowerCase(),
    role: (element.getAttribute("role") || "").toLowerCase(),
    href: element instanceof HTMLAnchorElement ? element.href : "",
    target: element.getAttribute("target") || "",
    type: (element.getAttribute("type") || "").toLowerCase(),
    hasExpandedState: element.hasAttribute("aria-expanded"),
    explicitlySafe: element.getAttribute("data-realitycheck-safe") === "true",
    text: (element.getAttribute("aria-label") || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120),
  }));
  if (/\b(delete|remove|destroy|purchase|checkout|pay|submit|send|logout|log out|signout|sign out|unsubscribe)\b/i.test(metadata.text)) {
    throw new ConfigError(`Journey refused a potentially destructive control: ${JSON.stringify(metadata.text)}`);
  }
  if (metadata.tag === "a") {
    const destination = new URL(metadata.href, page.url());
    if (destination.origin !== new URL(target).origin) throw new ConfigError("Journey clicks must stay on the audited origin");
    if (!routeAllowed(destination.pathname, crawl)) throw new ConfigError(`Journey click destination is excluded by the crawl safety policy: ${destination.pathname}`);
    return metadata;
  }
  const safeDisclosure = metadata.tag === "summary" || (metadata.tag === "button" && (metadata.role === "tab" || metadata.hasExpandedState));
  const safeExplicitButton = metadata.tag === "button" && metadata.type !== "submit" && metadata.explicitlySafe;
  if (!safeDisclosure && !safeExplicitButton) {
    throw new ConfigError("Journey clicks are limited to same-origin links, tabs, disclosures, or non-submit buttons marked data-realitycheck-safe=true");
  }
  return metadata;
}

async function inspectJourneyPress(page, selector) {
  const locator = page.locator(selector);
  const count = await locator.count();
  if (count !== 1) throw new ConfigError(`Journey press selector ${JSON.stringify(selector)} must match exactly one element; matched ${count}`);
  const metadata = await locator.evaluate((element) => ({
    tag: element.tagName.toLowerCase(),
    role: (element.getAttribute("role") || "").toLowerCase(),
    editable: element instanceof HTMLInputElement
      || element instanceof HTMLTextAreaElement
      || element instanceof HTMLSelectElement
      || element.isContentEditable,
    explicitlySafe: element.getAttribute("data-realitycheck-safe") === "true",
  }));
  const safeRoles = new Set(["tab", "tablist", "menu", "menuitem", "dialog", "tree", "treeitem", "grid", "row"]);
  const safeStructuralTarget = metadata.tag === "body" || safeRoles.has(metadata.role) || metadata.explicitlySafe;
  if (metadata.editable || !safeStructuralTarget) {
    throw new ConfigError("Journey key presses are limited to non-editable structural widgets or elements marked data-realitycheck-safe=true");
  }
  return metadata;
}

async function runDeclarativeJourneys(browser, target, runDirectory, journeys, contextOptions, crawl) {
  const findings = [];
  const scenarios = [];
  for (let journeyIndex = 0; journeyIndex < journeys.length; journeyIndex += 1) {
    const journey = journeys[journeyIndex];
    const scenarioId = `journey-${journey.id}`;
    const startedAt = Date.now();
    const trace = [];
    let session;
    let finalPath = journey.startPath;
    let failure = null;
    console.log(`  J${journeyIndex + 1}/${journeys.length} Journey ${journey.id}`);
    try {
      const startUrl = resolveRoute(target, journey.startPath);
      if (!routeAllowed(new URL(startUrl).pathname, crawl)) throw new ConfigError(`Journey startPath is excluded by the crawl safety policy: ${journey.startPath}`);
      session = await createPage(browser, startUrl, `${scenarioId}-start`, runDirectory, contextOptions);
      for (let stepIndex = 0; stepIndex < journey.steps.length; stepIndex += 1) {
        const step = journey.steps[stepIndex];
        try {
          if (step.action === "goto") {
            const destination = resolveRoute(target, step.path);
            if (!routeAllowed(new URL(destination).pathname, crawl)) throw new ConfigError(`Journey goto path is excluded by the crawl safety policy: ${step.path}`);
            await session.page.goto(destination, { waitUntil: "domcontentloaded", timeout: 20_000 });
            await settle(session.page);
            trace.push({ step: stepIndex + 1, action: "goto", path: new URL(session.page.url()).pathname, passed: true });
          } else if (step.action === "click") {
            const metadata = await inspectJourneyClick(session.page, step.selector, target, crawl);
            await session.page.locator(step.selector).click({ timeout: 5_000 });
            await settle(session.page, 700);
            trace.push({ step: stepIndex + 1, action: "click", selector: step.selector, element: metadata.tag, passed: true });
          } else if (step.action === "press") {
            const metadata = await inspectJourneyPress(session.page, step.selector);
            await session.page.locator(step.selector).press(step.key, { timeout: 5_000 });
            await settle(session.page, 700);
            trace.push({ step: stepIndex + 1, action: "press", selector: step.selector, keyboardInput: step.key, element: metadata.tag, role: metadata.role || null, passed: true });
          } else if (step.action === "assert-url") {
            const actualPath = new URL(session.page.url()).pathname;
            const passed = actualPath === step.path;
            trace.push({ step: stepIndex + 1, action: "assert-url", expectedPath: step.path, actualPath, passed });
            if (!passed) {
              const error = new Error(`URL path assertion expected ${step.path} but observed ${actualPath}`);
              error.reasonZh = `URL 路径断言期望 ${step.path}，实际为 ${actualPath}`;
              throw error;
            }
          } else {
            const assertion = await evaluateJourneyAssertion(session.page, step);
            trace.push({ step: stepIndex + 1, action: "assert", selector: step.selector, assertion: step.assertion, count: assertion.count, visibleCount: assertion.visibleCount, passed: assertion.passed });
            if (!assertion.passed) {
              const error = new Error(`Assertion ${step.assertion} failed for ${step.selector}`);
              error.reasonZh = `元素 ${step.selector} 的 ${step.assertion} 断言未通过`;
              throw error;
            }
          }
          await session.page.screenshot({ path: join(runDirectory, "screenshots", `${scenarioId}-step-${stepIndex + 1}.png`), fullPage: true });
        } catch (error) {
          failure = {
            step: stepIndex + 1,
            action: step.action,
            selector: step.selector,
            path: step.path,
            reason: String(error.message || error).slice(0, 500),
            reasonZh: String(error.reasonZh || "步骤未满足安全约束或预期状态；请结合英文原因和步骤证据复核。").slice(0, 500),
          };
          const { reasonZh: _reasonZh, ...recordedFailure } = failure;
          if (trace.at(-1)?.step === failure.step && trace.at(-1)?.passed === false) Object.assign(trace.at(-1), recordedFailure);
          else trace.push({ ...recordedFailure, passed: false });
          await session.page.screenshot({ path: join(runDirectory, "screenshots", `${scenarioId}-failure.png`), fullPage: true }).catch(() => {});
          break;
        }
      }
    } catch (error) {
      failure = {
        step: 0,
        action: "start",
        reason: String(error.message || error).slice(0, 500),
        reasonZh: "旅程无法在安全约束内启动；请结合英文原因和配置复核。",
      };
      const { reasonZh: _reasonZh, ...recordedFailure } = failure;
      trace.push({ ...recordedFailure, passed: false });
    } finally {
      if (session) {
        finalPath = new URL(session.page.url()).pathname;
        await session.context.close();
      }
    }
    const title = journey.title || journey.id;
    const titleZh = journey.titleZh || journey.title || journey.id;
    if (failure) {
      const evidence = [{ type: "journey-trace", steps: trace }];
      if (session) evidence.push({ type: "screenshot", path: `screenshots/${scenarioId}-failure.png`, label: "Journey failure checkpoint" });
      findings.push(finding({
        ruleId: `journey-${journey.id}`, scenarioId, classification: "existing", severity: journey.severity, confidence: "high",
        title: `User journey failed: ${title}`, titleZh: `用户旅程未通过：${titleZh}`,
        summary: `Step ${failure.step || "start"} (${failure.action}) did not complete: ${failure.reason}`, summaryZh: `第 ${failure.step || "起始"} 步（${failure.action}）未完成：${failure.reasonZh}`,
        selector: failure.selector,
        measurements: { completedSteps: trace.filter((item) => item.passed).length, totalSteps: journey.steps.length, failedStep: failure.step, failedAction: failure.action, finalPath },
        evidence,
        steps: [`Open the journey at ${journey.startPath} in a fresh isolated context.`, ...journey.steps.map((step, index) => `${index + 1}. ${step.action}${step.path ? ` ${step.path}` : ""}${step.selector ? ` ${step.selector}` : ""}${step.key ? ` ${step.key}` : ""}${step.assertion ? ` (${step.assertion})` : ""}.`)],
        stepsZh: [`在新的隔离上下文中从 ${journey.startPath} 打开旅程。`, ...journey.steps.map((step, index) => `${index + 1}. 执行 ${step.action}${step.path ? ` ${step.path}` : ""}${step.selector ? ` ${step.selector}` : ""}${step.key ? ` ${step.key}` : ""}${step.assertion ? `（${step.assertion}）` : ""}。`)],
        fix: "Restore the first failed application state or transition; keep the journey assertion unchanged and rerun the entire journey.",
        fixZh: "修复第一个失败的应用状态或转换；保持旅程断言不变，并重新运行完整旅程。",
        hints: ["Use the step trace and failure screenshot to distinguish a missing state from a blocked transition."],
        hintsZh: ["利用步骤轨迹和失败截图区分状态缺失与转换受阻。"],
      }));
    }
    scenarios.push(scenarioResult(
      scenarioId,
      failure ? "completed-with-findings" : "passed",
      Date.now() - startedAt,
      failure ? [`Stopped safely at step ${failure.step || "start"}; no form was submitted.`] : [`Completed ${journey.steps.length} declarative steps without form submission.`],
      failure ? [`已在第 ${failure.step || "起始"} 步安全停止；未提交任何表单。`] : [`已完成 ${journey.steps.length} 个声明式步骤，未提交任何表单。`],
    ));
  }
  for (const item of findings) item.url = target;
  return { findings, scenarios };
}

async function auditPage({ browser, python, browserVersion, options, target, outputRoot, pageNumber, pageTotal }) {
  const initArguments = ["init", "--target", target, "--mode", options.mode, "--adapter", "project-playwright", "--output", outputRoot, "--fail-on", options.failOn];
  if (options.allowRemote) initArguments.push("--allow-remote");
  const initialized = runReport(python, initArguments);
  const inputPath = initialized.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  const runDirectory = dirname(inputPath);
  mkdirSync(join(runDirectory, "screenshots"), { recursive: true });

  console.log(`\n${pageTotal > 1 ? `[Page ${pageNumber}/${pageTotal}] ` : ""}RealityCheck ${options.mode} audit`);
  console.log(`Target   ${target}`);
  console.log(`Run      ${runDirectory}\n`);

  const startedAt = Date.now();
  const contextOptions = options.storageState ? { storageState: options.storageState } : {};
  const pathname = new URL(target).pathname;
  const applicableChecks = options.checks.filter((check) => routeAllowed(pathname, { include: check.include, exclude: check.exclude }));
  const auditResult = await runQuickAudit(browser, target, runDirectory, contextOptions, applicableChecks, options.budgets, options.network, options.links, options.metadata, options.visual, options.security, options.privacy, options.viewports, options.crawl);
  if (options.mode === "deep") {
    await runDeepScenarios(browser, target, runDirectory, auditResult.findings, auditResult.results, contextOptions, 5 + options.viewports.length);
  }
  let journeyResult = { findings: [], scenarios: [] };
  if (options.journeys.length && target === options.target) {
    journeyResult = await runDeclarativeJourneys(browser, target, runDirectory, options.journeys, contextOptions, options.crawl);
    auditResult.findings.push(...journeyResult.findings);
  }
  const ownershipResult = applyFindingOwnership(auditResult.findings, auditResult.finalUrl, options.owners);
  const waiverResult = applyFindingWaivers(auditResult.findings, auditResult.finalUrl, options.waivers);

  const audit = JSON.parse(readFileSync(inputPath, "utf8"));
  if (options.qualityGate) audit.config.qualityGate = options.qualityGate;
  if (options.baselinePolicy) audit.config.baselinePolicy = options.baselinePolicy;
  audit.config.viewports = options.viewports;
  audit.config.policyFingerprint = detectorPolicyFingerprint(options);
  audit.target.finalUrl = auditResult.finalUrl;
  audit.target.title = auditResult.targetTitle;
  audit.adapter.isolation = "fresh-context";
  audit.adapter.capabilities = ["console", "dom", "isolated-contexts", "network-routing", "screenshots", "viewport"];
  audit.adapter.capabilities.push("responsive-viewport-matrix");
  if (options.mode === "deep") audit.adapter.capabilities.push("axe-core-accessibility");
  if (options.storageState) audit.adapter.capabilities.push("authenticated-storage-state");
  if (applicableChecks.length) audit.adapter.capabilities.push("declarative-custom-checks");
  if (options.budgets) audit.adapter.capabilities.push("performance-budgets");
  if (options.network) audit.adapter.capabilities.push("network-reliability-budgets");
  if (options.links) audit.adapter.capabilities.push("bounded-head-link-integrity");
  if (options.metadata) audit.adapter.capabilities.push("publishing-metadata-policy");
  if (options.visual) audit.adapter.capabilities.push("explicit-visual-regression-baseline");
  if (options.security) audit.adapter.capabilities.push("security-response-and-origin-policy");
  if (options.privacy) audit.adapter.capabilities.push("aggregate-browser-storage-privacy-budgets");
  if (journeyResult.scenarios.length) audit.adapter.capabilities.push("safe-declarative-journeys");
  if (options.waivers.length) audit.adapter.capabilities.push("governed-waivers");
  if (options.qualityGate) audit.adapter.capabilities.push("release-policy-gates");
  if (options.owners.length) audit.adapter.capabilities.push("finding-ownership");
  if (options.baselinePolicy) audit.adapter.capabilities.push("baseline-governance-policy");
  audit.adapter.capabilities.push("detector-policy-fingerprint");
  const scenarioIds = ["baseline", ...options.viewports.map((item) => item.id), "long-text", "rtl-arabic", "image-failure", "keyboard-tab"];
  if (options.mode === "deep") scenarioIds.push("page-zoom-200", "reduced-motion", "dark-scheme", "slow-api", "api-error", "empty-data", "axe");
  audit.scenarios = scenarioIds.map((id) => auditResult.results.get(id) || scenarioResult(id, "unsupported", 0, ["The standalone adapter did not implement this scenario."], ["独立适配器尚未实现此场景。"]));
  audit.scenarios.push(...journeyResult.scenarios);
  audit.findings = auditResult.findings;
  audit.warnings = [
    `Standalone audit used an already-installed system browser (${browserVersion}).`,
    "Automated findings remain bounded observations; review low-confidence items before fixing.",
    `Responsive layout was evaluated in ${options.viewports.length} configured viewport(s); touch-target heuristics ran only where touch was enabled.`,
    ...(options.mode === "deep" ? ["Bundled axe-core checks supplement scenario testing but cannot establish complete WCAG conformance."] : []),
    ...(options.storageState ? ["A user-provided Playwright storage state was loaded into isolated contexts; its path and values were not persisted."] : []),
    ...(applicableChecks.length ? [`${applicableChecks.length} declarative custom requirement(s) were evaluated without arbitrary script execution.`] : []),
    ...(options.budgets ? [`${Object.keys(options.budgets).length - 1} project performance budget(s) were evaluated from the browser Performance API.`] : []),
    ...(options.network ? [`${Object.keys(options.network).filter((key) => key.startsWith("max")).length} explicit network reliability limit(s) were evaluated without persisting response bodies or query values.`] : []),
    ...(auditResult.linkSummary ? [`Link integrity checked ${auditResult.linkSummary.checked} same-origin target(s) with HEAD only: ${auditResult.linkSummary.failures} failed, ${auditResult.linkSummary.unsupported} did not support HEAD, ${auditResult.linkSummary.excluded} were excluded by safety policy, and ${auditResult.linkSummary.truncated} exceeded the configured cap.`] : []),
    ...(options.metadata ? [`${Object.keys(options.metadata).length - 1} explicit publishing metadata rule(s) were evaluated from counts, lengths, directives, and query-free destinations without retaining title or description text.`] : []),
    ...(auditResult.visualSummary ? [`Visual regression policy finished with ${auditResult.visualSummary.state} state using ${auditResult.visualSummary.measurements.maskedSelectors} declared mask(s); baseline replacement always requires an explicit approval command.`] : []),
    ...(options.security ? [`${policySettingCount(options.security)} explicit response, semantic-header, origin, and form security policy setting(s) were evaluated without submitting data or retaining raw header values.`] : []),
    ...(options.privacy ? [`${Object.keys(options.privacy).length - 1} aggregate cookie and Web Storage privacy budget(s) were evaluated without retaining cookie names, values, storage keys, or storage values.`] : []),
    ...(journeyResult.scenarios.length ? [`${journeyResult.scenarios.length} declarative user journey(s) were executed with same-origin and non-submission safety guards.`] : []),
    ...(waiverResult.appliedCount ? [`${waiverResult.appliedCount} finding(s) matched an active governed waiver; evidence remains visible but the finding is excluded from score and gate calculations.`] : []),
    ...(waiverResult.expiredIds.length ? [`Expired waiver(s) were ignored: ${waiverResult.expiredIds.join(", ")}.`] : []),
    ...(options.qualityGate ? [`${Object.keys(options.qualityGate).length} project release policy limit(s) were evaluated in addition to the severity threshold.`] : []),
    ...(ownershipResult.appliedCount ? [`${ownershipResult.appliedCount} finding(s) were assigned to a configured accountable team.`] : []),
    ...(ownershipResult.ambiguousCount ? [`${ownershipResult.ambiguousCount} finding(s) matched multiple ownership rules and were left unassigned.`] : []),
  ];
  audit.translations = {
    "zh-CN": {
      warnings: [
        `独立核查使用了已安装的系统浏览器（${browserVersion}）。`,
        "自动化问题仍然属于有边界的观察结果；修复前请人工复核低置信度项目。",
        `已在 ${options.viewports.length} 个配置视口中核查响应式布局；仅在启用 touch 的视口运行触控目标启发式检查。`,
        ...(options.mode === "deep" ? ["内置 axe-core 检查用于补充场景测试，但不能证明完整的 WCAG 合规。"] : []),
        ...(options.storageState ? ["用户提供的 Playwright 登录状态仅加载到隔离上下文中；路径和内容均未写入报告。"] : []),
        ...(applicableChecks.length ? [`已执行 ${applicableChecks.length} 条声明式自定义要求，未运行任意脚本。`] : []),
        ...(options.budgets ? [`已通过浏览器 Performance API 核查 ${Object.keys(options.budgets).length - 1} 项项目性能预算。`] : []),
        ...(options.network ? [`已在不保存响应正文或查询参数值的前提下核查 ${Object.keys(options.network).filter((key) => key.startsWith("max")).length} 项明确的网络可靠性限制。`] : []),
        ...(auditResult.linkSummary ? [`链接完整性仅使用 HEAD 核查了 ${auditResult.linkSummary.checked} 个同源目标：${auditResult.linkSummary.failures} 个失败，${auditResult.linkSummary.unsupported} 个不支持 HEAD，${auditResult.linkSummary.excluded} 个被安全策略排除，${auditResult.linkSummary.truncated} 个超过配置上限。`] : []),
        ...(options.metadata ? [`已通过计数、长度、指令和不含查询值的目标核查 ${Object.keys(options.metadata).length - 1} 项明确的发布元数据规则，未保留标题或描述正文。`] : []),
        ...(auditResult.visualSummary ? [`视觉回归策略以 ${auditResult.visualSummary.state} 状态完成，并使用 ${auditResult.visualSummary.measurements.maskedSelectors} 个声明式 mask；替换基线始终需要显式批准命令。`] : []),
        ...(options.security ? [`已在不提交数据或保留原始响应头值的前提下核查 ${policySettingCount(options.security)} 项明确的响应、语义响应头、来源与表单安全策略。`] : []),
        ...(options.privacy ? [`已核查 ${Object.keys(options.privacy).length - 1} 项 Cookie 与 Web Storage 聚合隐私预算，未保留 Cookie 名称、值、存储键或存储值。`] : []),
        ...(journeyResult.scenarios.length ? [`已在同源且禁止提交的安全限制下执行 ${journeyResult.scenarios.length} 个声明式用户旅程。`] : []),
        ...(waiverResult.appliedCount ? [`${waiverResult.appliedCount} 个问题命中了有效的可审计豁免；证据仍保留，但不计入评分和门禁。`] : []),
        ...(waiverResult.expiredIds.length ? [`已忽略过期豁免：${waiverResult.expiredIds.join("、")}。`] : []),
        ...(options.qualityGate ? [`除严重级别门禁外，还核查了 ${Object.keys(options.qualityGate).length} 项项目发布策略限制。`] : []),
        ...(ownershipResult.appliedCount ? [`${ownershipResult.appliedCount} 个问题已分配给配置的负责团队。`] : []),
        ...(ownershipResult.ambiguousCount ? [`${ownershipResult.ambiguousCount} 个问题同时命中多个责任规则，已保持未分配状态。`] : []),
      ],
    },
  };
  audit.run.finishedAt = new Date().toISOString();
  audit.run.durationMs = Date.now() - startedAt;
  writeFileSync(inputPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");

  const rendered = runReport(python, ["render", inputPath, "--fail-on", options.failOn], new Set([0, 1]));
  console.log(`\n${rendered.stdout.trim()}`);
  const report = JSON.parse(readFileSync(join(runDirectory, "report.json"), "utf8"));
  const integrity = writeEvidenceManifest(runDirectory, {
    artifactKind: "page-audit",
    runId: report.run.id,
    target: report.target.requestedUrl,
  });
  return {
    status: "completed",
    exitCode: rendered.status,
    runDirectory,
    reportPath: join(runDirectory, "report.html"),
    reportJsonPath: join(runDirectory, "report.json"),
    report,
    integrityManifestPath: integrity.path,
  };
}

function publishLatestPage(page, options, verification = null) {
  const outputRoot = resolve(options.output);
  const integrity = writeEvidenceManifest(page.runDirectory, {
    artifactKind: "page-audit",
    runId: page.report.run.id,
    target: page.report.target.requestedUrl,
  });
  const manifest = buildLatestRun({
    artifactKind: "page-audit",
    outputRoot,
    runId: page.report.run.id,
    target: page.report.target.requestedUrl,
    score: page.report.score.overall,
    gateFailed: verification ? verification.threshold.met : page.report.threshold.met,
    artifacts: {
      html: page.reportPath,
      json: page.reportJsonPath,
      repairPlanJson: join(page.runDirectory, "repair-plan.json"),
      repairPlanMarkdown: join(page.runDirectory, "repair-plan.md"),
      integrityManifest: integrity.path,
      ...(verification ? {
        verificationHtml: join(page.runDirectory, "verification.html"),
        verificationJson: join(page.runDirectory, "verification.json"),
      } : {}),
    },
  });
  return writeLatestRun(manifest, outputRoot);
}

function publishLatestSite(site, options, outputs, gateFailed, verificationOutputs = null) {
  const outputRoot = resolve(options.output);
  const integrity = writeEvidenceManifest(dirname(outputs.jsonPath), {
    artifactKind: "site-audit",
    runId: site.id,
    target: site.baseUrl,
  });
  const manifest = buildLatestRun({
    artifactKind: "site-audit",
    outputRoot,
    runId: site.id,
    target: site.baseUrl,
    score: site.summary.averageScore,
    gateFailed,
    pages: site.summary.pagesRequested,
    artifacts: {
      html: outputs.htmlPath,
      json: outputs.jsonPath,
      integrityManifest: integrity.path,
      ...(verificationOutputs ? {
        verificationHtml: verificationOutputs.htmlPath,
        verificationJson: verificationOutputs.jsonPath,
      } : {}),
    },
  });
  return writeLatestRun(manifest, outputRoot);
}

async function main() {
  let options;
  let loaded;
  try {
    const cli = parseArguments(process.argv.slice(2));
    if (cli.command === "profiles") {
      console.log(`RealityCheck project profiles\n\n${formatProfileList()}\n\nCreate one with: realitycheck init --profile product --base-url http://localhost:3000`);
      return;
    }
    if (cli.command === "init") {
      initializeProjectConfig(cli);
      return;
    }
    if (cli.command === "plan") {
      if (cli.headed || cli.browserPath) throw new Error("plan does not open a browser; remove --headed and --browser");
      loaded = loadProjectConfig(cli.config);
      const planOptions = mergeProjectOptions(cli, loaded);
      if (!planOptions.target) throw new Error(`A target URL is required. Pass one or set baseUrl in ${CONFIG_FILENAME}`);
      planOptions.target = isPrivateTarget(planOptions.target, planOptions.allowRemote);
      const storageStateSummary = planOptions.storageState ? inspectStorageState(planOptions.storageState) : null;
      const output = cli.output ? resolve(cli.output) : resolve(loaded.directory, ".realitycheck/audit-plan");
      const plan = buildAuditPlan(planOptions, loaded, { storageStateSummary });
      const outputs = writeAuditPlan(plan, output);
      const [validation] = validateArtifactFiles([outputs.jsonPath]);
      if (!validation?.valid) throw new Error(`Generated audit plan failed validation: ${validation?.errors.join("; ") || "unknown validation error"}`);
      console.log(`audit-plan.json:  ${outputs.jsonPath}`);
      console.log(`audit-plan.md:    ${outputs.markdownPath}`);
      console.log(`audit-plan.zh.md: ${outputs.markdownZhPath}`);
      console.log(`audit-plan.html:  ${outputs.htmlPath}`);
      console.log(`coverage ceiling: ${plan.summary.pagesMax} page(s), ${plan.summary.scenarioExecutionsMax} scenario execution(s)`);
      console.log("browser access:   NONE (preview only)");
      return;
    }
    if (cli.command === "visual-approve") {
      if (!cli.visualReport) throw new Error("visual-approve requires a report.json path");
      if (cli.output) throw new Error("visual-approve writes to the configured baseline directory; do not pass --output");
      loaded = loadProjectConfig(cli.config);
      if (!loaded.path) throw new Error("visual-approve requires a project config with visual policy");
      if (!loaded.config.visual) throw new Error("The project config has no visual policy to approve");
      const reportPath = resolve(cli.visualReport);
      const [validation] = validateArtifactFiles([reportPath]);
      if (!validation?.valid || validation.kind !== "report") throw new Error(`Visual approval source must be a valid page report: ${validation?.errors.join("; ") || "unsupported artifact"}`);
      const report = JSON.parse(readFileSync(reportPath, "utf8"));
      const approval = approveVisualBaseline({
        report,
        reportPath,
        configDirectory: loaded.directory,
        policy: loaded.config.visual,
        replace: cli.replaceBaseline,
      });
      console.log(`visual baseline: ${approval.destination}`);
      console.log(`baseline index:  ${approval.indexPath}`);
      console.log(`pathname:        ${approval.entry.pathname}`);
      console.log(`result:          ${approval.unchanged ? "UNCHANGED" : approval.replaced ? "REPLACED (explicit approval)" : "APPROVED"}`);
      return;
    }
    if (cli.command === "validate") {
      let trust = null;
      if (cli.trustPolicy) {
        const [policyValidation] = validateArtifactFiles([cli.trustPolicy]);
        if (!policyValidation?.valid) throw new Error(`Evidence trust policy failed schema validation: ${policyValidation?.errors.join("; ")}`);
        trust = loadEvidenceTrustPolicy(cli.trustPolicy);
      }
      const validationPaths = trust ? [...cli.validationPaths, trust.path] : cli.validationPaths;
      process.exitCode = printValidationResults(validateArtifactFiles(validationPaths, {
        trustedKeyIds: trust?.trustedKeyIds || cli.trustedKeyIds,
        requireAttestation: cli.requireAttestation || trust?.policy.requireAttestation || false,
      }));
      return;
    }
    if (cli.command === "trust-report") {
      if (!cli.trustReportManifest) throw new Error("trust-report requires an evidence-manifest.json path");
      if (!cli.trustPolicy) throw new Error("trust-report requires --trust-policy PATH");
      if (cli.output) throw new Error("trust-report writes beside the evidence manifest; do not pass --output");
      const outputs = writeEvidenceTrustReport(cli.trustReportManifest, cli.trustPolicy);
      const [validation] = validateArtifactFiles([outputs.jsonPath]);
      if (!validation?.valid) throw new Error(`Generated trust report failed validation: ${validation?.errors.join("; ")}`);
      console.log(`evidence-trust-report.json: ${outputs.jsonPath}`);
      console.log(`evidence-trust-report.html: ${outputs.htmlPath}`);
      console.log(`trust decision:             ${outputs.report.state.toUpperCase()}`);
      if (outputs.latestUpdated) console.log("stable latest:              updated with trust decision");
      process.exitCode = outputs.report.state === "trusted" ? 0 : 1;
      return;
    }
    if (cli.command === "catalog") {
      const output = resolve(cli.output || ".realitycheck/catalog");
      const catalog = buildArtifactCatalog(cli.catalogPaths, output);
      const outputs = writeArtifactCatalog(catalog, output);
      console.log(`catalog.json: ${outputs.jsonPath}`);
      console.log(`catalog.md:   ${outputs.markdownPath}`);
      console.log(`catalog.html: ${outputs.htmlPath}`);
      console.log(`artifacts:    ${catalog.summary.artifacts} (${catalog.summary.failing} failing)`);
      return;
    }
    if (cli.command === "github-summary") {
      if (!cli.githubSummaryPaths.length) throw new Error("github-summary requires at least one report.json file or evidence directory");
      const result = buildGitHubSummary(cli.githubSummaryPaths, { maxAnnotations: cli.maxAnnotations ?? 20, language: cli.summaryLanguage || "en" });
      const output = writeGitHubSummary(result, cli.output || ".realitycheck/github-summary.md");
      for (const annotation of result.annotations) console.log(annotation);
      console.log(`github-summary.md: ${output}`);
      console.log(`latest targets:    ${result.summary.latestTargets} (${result.summary.failingTargets} failing)`);
      console.log(`annotations:       ${result.summary.annotations} (${result.summary.truncatedAnnotations} omitted by limit)`);
      return;
    }
    if (cli.command === "risk-register") {
      const output = resolve(cli.output || ".realitycheck/risk-register");
      const register = buildRiskRegister(cli.riskRegisterPaths, output, { maxOpenAgeDays: cli.maxOpenAgeDays, maxOpenRisks: cli.maxOpenRisks, maxRecurringRisks: cli.maxRecurringRisks });
      const outputs = writeRiskRegister(register, output);
      console.log(`risk-register.json: ${outputs.jsonPath}`);
      console.log(`risk-register.csv:  ${outputs.csvPath}`);
      console.log(`risk-register.md:   ${outputs.markdownPath}`);
      console.log(`risk-register.html: ${outputs.htmlPath}`);
      console.log(`risks:              ${register.summary.risks} (${register.summary.open} open, ${register.summary.recurring} recurring, ${register.summary.overdue} overdue, ${register.summary.waived} waived, ${register.summary.resolved} resolved, ${register.summary.unverified} unverified)`);
      if (register.policy.gateFailed) {
        console.log(`risk policy:        FAIL (${register.policy.violations.map((item) => `${item.code} ${item.actual}/${item.expected}`).join(", ")})`);
        process.exitCode = 1;
      } else if (cli.maxOpenAgeDays !== null || cli.maxOpenRisks !== null || cli.maxRecurringRisks !== null) {
        console.log("risk policy:        PASS");
      }
      return;
    }
    if (cli.command === "release-decision") {
      if (cli.config || cli.target || cli.routes.length || cli.crawl !== undefined || cli.storageState || cli.compareReport || cli.baselineReport || cli.allowRemote || cli.mode || cli.failOn || cli.headed || cli.browserPath || cli.force || cli.maxPages !== undefined || cli.maxDepth !== undefined) throw new Error("release-decision accepts evidence paths, --require, --max-age-hours, and --output only");
      const output = resolve(cli.output || ".realitycheck/release-decision");
      const bundle = buildReleaseDecision(cli.releaseDecisionPaths, output, {
        maxAgeHours: cli.releaseMaxAgeHours ?? 24,
        requiredControls: parseRequiredControls(cli.releaseRequired || "audit"),
      });
      const outputs = writeReleaseDecision(bundle, output);
      const [validation] = validateArtifactFiles([outputs.jsonPath]);
      if (!validation?.valid) throw new Error(`Generated release decision failed validation: ${validation?.errors.join("; ")}`);
      console.log(`release-decision.json:  ${outputs.jsonPath}`);
      console.log(`release-decision.md:    ${outputs.markdownPath}`);
      console.log(`release-decision.zh.md: ${outputs.markdownZhPath}`);
      console.log(`release-decision.html:  ${outputs.htmlPath}`);
      console.log(`decision:                ${bundle.decision.toUpperCase()} (${bundle.summary.passed} passed, ${bundle.summary.review} review, ${bundle.summary.failed} failed, ${bundle.summary.missing} missing, ${bundle.summary.stale} stale)`);
      process.exitCode = releaseDecisionExitCode(bundle.decision);
      return;
    }
    if (cli.command === "policy-review") {
      if (cli.config || cli.target || cli.routes.length || cli.crawl !== undefined || cli.storageState || cli.compareReport || cli.baselineReport || cli.allowRemote || cli.mode || cli.failOn || cli.headed || cli.browserPath || cli.force || cli.maxPages !== undefined || cli.maxDepth !== undefined) throw new Error("policy-review accepts two explicit config paths and --output only");
      const output = resolve(cli.output || ".realitycheck/policy-review");
      const review = buildPolicyReview(cli.policyReviewPaths[0], cli.policyReviewPaths[1]);
      const outputs = writePolicyReview(review, output);
      const [validation] = validateArtifactFiles([outputs.jsonPath]);
      if (!validation?.valid) throw new Error(`Generated policy review failed validation: ${validation?.errors.join("; ")}`);
      console.log(`policy-review.json:  ${outputs.jsonPath}`);
      console.log(`policy-review.md:    ${outputs.markdownPath}`);
      console.log(`policy-review.zh.md: ${outputs.markdownZhPath}`);
      console.log(`policy-review.html:  ${outputs.htmlPath}`);
      console.log(`changes:             ${review.summary.changes} (${review.summary.weakened} weakened, ${review.summary.strengthened} strengthened, ${review.summary.review} review)`);
      console.log(`policy gate:         ${review.summary.gateFailed ? "FAILED" : "PASSED"}`);
      process.exitCode = review.summary.gateFailed ? 1 : 0;
      return;
    }
    if (cli.command === "issue-drafts") {
      if (cli.config || cli.target || cli.routes.length || cli.crawl !== undefined || cli.storageState || cli.compareReport || cli.baselineReport || cli.allowRemote || cli.mode || cli.failOn || cli.headed || cli.browserPath || cli.force || cli.maxPages !== undefined || cli.maxDepth !== undefined) throw new Error("issue-drafts accepts repair plan paths and --output only");
      const output = resolve(cli.output || ".realitycheck/issue-drafts");
      const bundle = buildIssueDrafts(cli.issueDraftPaths, output);
      const outputs = writeIssueDrafts(bundle, output);
      const [validation] = validateArtifactFiles([outputs.jsonPath]);
      if (!validation?.valid) throw new Error(`Generated issue drafts failed validation: ${validation?.errors.join("; ")}`);
      console.log(`github-issue-drafts.json:  ${outputs.jsonPath}`);
      console.log(`github-issue-drafts.md:    ${outputs.markdownPath}`);
      console.log(`github-issue-drafts.zh.md: ${outputs.markdownZhPath}`);
      console.log(`github-issue-drafts.csv:   ${outputs.csvPath}`);
      console.log(`github-issue-drafts.html:  ${outputs.htmlPath}`);
      console.log(`drafts:                    ${bundle.summary.drafts} (${bundle.summary.actionable} actionable, ${bundle.summary.review} review, ${bundle.summary.waived} waived, ${bundle.summary.duplicates} duplicates merged)`);
      return;
    }
    if (cli.command === "attest") {
      if (!cli.attestationManifest) throw new Error("attest requires an evidence-manifest.json path");
      if (!cli.privateKey) throw new Error("attest requires --private-key PATH");
      if (cli.output) throw new Error("attest writes beside the evidence manifest; do not pass --output");
      let trust = null;
      if (cli.trustPolicy) {
        const [policyValidation] = validateArtifactFiles([cli.trustPolicy]);
        if (!policyValidation?.valid) throw new Error(`Evidence trust policy failed schema validation: ${policyValidation?.errors.join("; ")}`);
        trust = loadEvidenceTrustPolicy(cli.trustPolicy);
      }
      // Keep the stable current-run pointer transactional: an untrusted signing
      // key may leave a rejected receipt for diagnosis, but must not be
      // published from latest.json/html.
      const outputs = writeEvidenceAttestation(cli.attestationManifest, cli.privateKey, { updateLatest: false });
      const validation = validateArtifactFiles([cli.attestationManifest, outputs.jsonPath], { trustedKeyIds: trust?.trustedKeyIds || cli.trustedKeyIds });
      const failedValidation = validation.filter((item) => !item.valid);
      if (failedValidation.length) throw new Error(`Generated attestation failed validation: ${failedValidation.flatMap((item) => item.errors).join("; ")}`);
      outputs.latestUpdated = updateLatestRunArtifacts({
        outputRoot: dirname(dirname(outputs.jsonPath)),
        runId: outputs.attestation.manifest.runId,
        updatedAt: outputs.attestation.createdAt,
        artifacts: { attestationJson: outputs.jsonPath, attestationHtml: outputs.htmlPath },
      });
      console.log(`evidence-attestation.json: ${outputs.jsonPath}`);
      console.log(`evidence-attestation.html: ${outputs.htmlPath}`);
      console.log(`signer key ID:             ${outputs.attestation.signer.keyId}`);
      if (outputs.latestUpdated) console.log("stable latest:             updated with signed receipt");
      return;
    }
    if (cli.command === "demo") {
      if (cli.target) throw new Error("demo does not accept a target URL; it serves the bundled loopback fixture");
      if (cli.config || cli.routes.length || cli.crawl !== undefined || cli.storageState || cli.allowRemote || cli.compareReport || cli.baselineReport) {
        throw new Error("demo uses an isolated bundled fixture; do not pass project, route, crawl, authentication, comparison, or remote-target options");
      }
      activeDemoServer = await startBundledDemoServer();
      cli.target = activeDemoServer.url;
      cli.mode = cli.mode || "quick";
      cli.failOn = cli.failOn || "major";
      cli.output = cli.output || ".realitycheck/demo";
      cli.crawl = false;
      loaded = { path: null, directory: process.cwd(), cwd: process.cwd(), config: {} };
      console.log(`Bundled demo server started on ${activeDemoServer.url} (loopback only).`);
    } else {
      loaded = loadProjectConfig(cli.config);
    }
    options = mergeProjectOptions(cli, loaded);
    if (options.command === "doctor") {
      process.exitCode = runDoctor(options, loaded);
      return;
    }
    if (!options.target) throw new Error(`A target URL is required. Pass one or set baseUrl in ${CONFIG_FILENAME}`);
    options.target = isPrivateTarget(options.target, options.allowRemote);
    if (options.storageState) inspectStorageState(options.storageState);
  } catch (error) {
    await closeActiveDemoServer();
    console.error(`error: ${error.message}\n\n${usage()}`);
    process.exitCode = 2;
    return;
  }

  const { chromium } = loadPlaywright();
  const executablePath = browserExecutable(chromium, options.browserPath);
  const python = pythonExecutable();
  console.log(`\nRealityCheck project audit`);
  console.log(`Target   ${options.target}`);
  console.log(`Browser  ${executablePath}`);
  console.log(`Config   ${loaded.path || "built-in defaults"}`);
  const configuredPageCount = new Set([options.target, ...options.routes.map((route) => resolveRoute(options.target, route))]).size;
  console.log(`Scope    ${options.crawl.enabled ? `crawl up to ${options.crawl.maxPages} pages / depth ${options.crawl.maxDepth}` : `${configuredPageCount} configured page(s)`}`);
  console.log(`Auth     ${options.storageState ? "authenticated state loaded (not persisted)" : "anonymous context"}`);

  const browser = await chromium.launch({ executablePath, headless: !options.headed });
  const browserVersion = browser.version();
  const siteStartedAt = new Date();
  let discovery;
  const pages = [];
  let siteDirectory = null;
  try {
    discovery = await discoverAuditTargets(browser, options);
    const projectScope = options.crawl.enabled || discovery.urls.length > 1;
    if (projectScope) {
      siteDirectory = join(resolve(options.output), buildSiteRunId(options.target, siteStartedAt));
      mkdirSync(join(siteDirectory, "pages"), { recursive: true });
      console.log(`Discovered ${discovery.urls.length} auditable page(s); ${discovery.discovered} link(s) found${discovery.truncated ? " (limit reached)" : ""}.`);
    }
    for (let index = 0; index < discovery.urls.length; index += 1) {
      const target = discovery.urls[index];
      const outputRoot = projectScope ? join(siteDirectory, "pages", String(index + 1).padStart(2, "0")) : resolve(options.output);
      try {
        const result = await auditPage({ browser, python, browserVersion, options, target, outputRoot, pageNumber: index + 1, pageTotal: discovery.urls.length });
        pages.push({ url: target, ...result });
      } catch (error) {
        const safeError = String(error.message || error).replaceAll(target, "[page]").slice(0, 500);
        pages.push({ url: target, status: "failed", error: safeError });
        console.error(`Page audit failed for ${new URL(target).pathname}: ${safeError}`);
        if (!projectScope) throw error;
      }
    }
  } finally {
    await browser.close();
    await closeActiveDemoServer();
  }

  if (siteDirectory) {
    const finishedAt = new Date();
    const portablePages = pages.map((page) => page.status === "completed"
      ? { ...page, reportPath: relative(siteDirectory, page.reportPath).replaceAll("\\", "/") }
      : page);
    const site = buildSiteReport({
      id: buildSiteRunId(options.target, siteStartedAt),
      baseUrl: options.target,
      mode: options.mode,
      failOn: options.failOn,
      startedAt: siteStartedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      pages: portablePages,
      discovery: {
        enabled: options.crawl.enabled,
        maxPages: options.crawl.maxPages,
        maxDepth: options.crawl.maxDepth,
        visited: discovery.visited,
        discovered: discovery.discovered,
        truncated: discovery.truncated,
        warnings: discovery.warnings,
      },
    });
    const outputs = writeSiteReport(site, siteDirectory);
    console.log(`\nSite score: ${site.summary.averageScore}/100 average · ${site.summary.minimumScore}/100 minimum`);
    let siteGateFailed = site.summary.gateFailed;
    let siteVerificationOutputs = null;
    const comparisonSource = options.compareReport || options.baselineReport;
    if (comparisonSource) {
      const previousPath = resolve(comparisonSource);
      if (!existsSync(previousPath)) throw new Error(`Site comparison report was not found: ${previousPath}`);
      const previousSite = JSON.parse(readFileSync(previousPath, "utf8"));
      if (previousSite.kind !== "site-audit") throw new Error("Multi-page --compare/--baseline requires a site-report.json baseline");
      const verification = compareSiteReports(previousSite, site, {
        regressionsOnly: Boolean(options.baselineReport),
        failOn: options.failOn,
        maxBaselineAgeDays: options.baselineReport ? options.baselinePolicy?.maxAgeDays ?? null : null,
        requireSamePolicy: Boolean(options.baselineReport && options.baselinePolicy?.requireSamePolicy),
      });
      const verificationOutputs = writeSiteVerification(verification, siteDirectory);
      siteVerificationOutputs = verificationOutputs;
      siteGateFailed = verification.threshold.met;
      console.log(`${options.baselineReport ? "Site regression gate" : "Site verification"}: ${siteGateFailed ? "FAILED" : "PASSED"}`);
      console.log(`Open site verification: ${verificationOutputs.htmlPath}`);
    } else {
      console.log(`Site gate:  ${siteGateFailed ? "FAILED" : "PASSED"}`);
    }
    const latestOutputs = publishLatestSite(site, options, outputs, siteGateFailed, siteVerificationOutputs);
    console.log(`Open site report: ${outputs.htmlPath}`);
    console.log(`Stable latest:   ${latestOutputs.htmlPath}`);
    process.exitCode = pages.some((page) => page.status === "failed") ? 2 : (siteGateFailed ? 1 : 0);
    return;
  }

  const page = pages[0];
  const comparisonSource = options.compareReport || options.baselineReport;
  if (comparisonSource) {
    const previousReport = resolve(comparisonSource);
    if (!existsSync(previousReport)) throw new Error(`Comparison report was not found: ${previousReport}`);
    const compareArguments = ["compare", previousReport, page.reportJsonPath, "--fail-on", options.failOn];
    if (options.baselineReport) compareArguments.push("--regressions-only");
    if (options.baselineReport && options.baselinePolicy?.maxAgeDays) compareArguments.push("--max-baseline-age-days", String(options.baselinePolicy.maxAgeDays));
    if (options.baselineReport && options.baselinePolicy?.requireSamePolicy) compareArguments.push("--require-same-policy");
    const compared = runReport(python, compareArguments, new Set([0, 1]));
    const verification = JSON.parse(readFileSync(join(page.runDirectory, "verification.json"), "utf8"));
    console.log(`\n${options.baselineReport ? "Regression-gated against the baseline" : "Verified against the previous run"}\n${compared.stdout.trim()}`);
    console.log(`\nOpen verification: ${join(page.runDirectory, "verification.html")}`);
    const latestOutputs = publishLatestPage(page, options, verification);
    console.log(`Stable latest:      ${latestOutputs.htmlPath}`);
    process.exitCode = compared.status;
    console.log(`\nOpen report: ${page.reportPath}`);
    return;
  }
  const latestOutputs = publishLatestPage(page, options);
  console.log(`\nOpen report: ${page.reportPath}`);
  console.log(`Stable latest: ${latestOutputs.htmlPath}`);
  if (options.command === "demo" && page.exitCode === 1) {
    console.log("\nDemo result: expected findings were detected and preserved; returning success because the bundled page is intentionally broken.");
    process.exitCode = 0;
  } else {
    process.exitCode = page.exitCode;
  }
}

main().catch(async (error) => {
  await closeActiveDemoServer();
  console.error(`error: ${error.stack || error.message}`);
  process.exitCode = 2;
});

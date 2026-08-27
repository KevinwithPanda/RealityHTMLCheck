import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { validateArtifactFiles } from "./artifact-validator.mjs";
import { runLiveDeploymentBrowserProof } from "./note-deploy-browser.mjs";
import { buildNoteDeploymentArtifacts } from "./note-deploy-report.mjs";
import { validateNoteDeploymentBaseUrl, verifyNoteDeployment } from "./note-deploy-verify.mjs";
import { loadVerifiedPublishCapsule } from "./note-publish-stage.mjs";

const CONTROL = /[\u0000-\u001f\u007f]/u;

function usage() {
  return `RealityCheck verified live deployment receipt

Usage:
  realityhtmlcheck verify-deploy <PUBLISH_RUN> <HTTP_OR_HTTPS_BASE_URL/> --allow-remote [options]

Options:
  --output PATH       Evidence root (default: .realitycheck/deployments)
  --browser PATH      Chrome, Edge, or Chromium executable
  --allow-remote      Confirm authorization to verify a public deployment
  --http-only         Compare hosted bytes without browser proof (never green)
  -h, --help          Show this help

The command performs bounded same-origin GETs without credentials, compares
the decoded live response bytes with one complete publish-ready capsule, and
uses a fresh JavaScript-disabled Chromium context for the final live proof.
It never signs in, uploads, deploys, rolls back, or stores response bodies.`;
}

function parseArguments(argv) {
  const args = [...argv];
  if (args[0] === "--") args.shift();
  const options = { source: null, baseUrl: null, output: ".realitycheck/deployments", browserPath: null, allowRemote: false, httpOnly: false };
  while (args.length) {
    const item = args.shift();
    if (item === "-h" || item === "--help") return { help: true };
    if (item === "--allow-remote") { options.allowRemote = true; continue; }
    if (item === "--http-only") { options.httpOnly = true; continue; }
    if (item === "--output" || item === "--browser") {
      const value = args.shift();
      if (!value) throw new Error(`${item} requires a value`);
      if (item === "--output") options.output = value;
      else options.browserPath = value;
      continue;
    }
    if (item.startsWith("--")) throw new Error(`Unknown verify-deploy option: ${item}`);
    if (!options.source) options.source = item;
    else if (!options.baseUrl) options.baseUrl = item;
    else throw new Error(`Unexpected verify-deploy argument: ${item}`);
  }
  if (!options.source || !options.baseUrl) throw new Error("verify-deploy requires a publish run and an HTTP(S) base URL ending in /; only HTTPS can receive a public green decision");
  return options;
}

function samePath(left, right) {
  const normalized = (value) => process.platform === "win32" ? resolve(value).toLowerCase() : resolve(value);
  return normalized(left) === normalized(right);
}

function contained(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function safeExistingDirectory(value, label, { create = false } = {}) {
  const absolute = resolve(value);
  if (CONTROL.test(absolute)) throw new Error(`${label} contains a control character`);
  if (create && !existsSync(absolute)) {
    let ancestor = dirname(absolute);
    while (!existsSync(ancestor)) {
      const parent = dirname(ancestor);
      if (parent === ancestor) throw new Error(`${label} has no existing directory ancestor`);
      ancestor = parent;
    }
    const ancestorStats = lstatSync(ancestor);
    if (!ancestorStats.isDirectory() || ancestorStats.isSymbolicLink() || !samePath(ancestor, realpathSync(ancestor))) {
      throw new Error(`${label} must not traverse a symbolic-link or special ancestor`);
    }
    mkdirSync(absolute, { recursive: true, mode: 0o755 });
  }
  const stats = lstatSync(absolute);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`${label} must be a real directory`);
  const canonical = realpathSync(absolute);
  if (!samePath(absolute, canonical)) throw new Error(`${label} must not traverse a symbolic-link ancestor`);
  return canonical;
}

function slug(value) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  return normalized || "deployment";
}

function timestamp(value) {
  return value.toISOString().replace(/[-:.]/g, "");
}

function roleForPath(path) {
  const lower = path.toLowerCase();
  if (path.startsWith("realitycheck-proof/")) return "public-proof";
  if (path === ".nojekyll") return "platform-marker";
  if (path === "index.html") return "entry-html";
  if (/\.html?$/.test(lower)) return "html";
  if (/\.css$/.test(lower)) return "stylesheet";
  if (/\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/.test(lower)) return "image";
  if (/\.(?:eot|otf|ttf|woff2?)$/.test(lower)) return "font";
  if (/\.(?:aac|flac|m4a|mp3|mp4|ogg|ogv|wav|webm)$/.test(lower)) return "media";
  if (/\.(?:epub|pdf|rtf|docx?|xlsx?|pptx?)$/.test(lower)) return "document";
  if (/\.(?:csv|json|map|txt|xml|ya?ml)$/.test(lower)) return "data";
  return "other";
}

function mimeKind(value, role) {
  if (typeof value !== "string" || value === "invalid") return null;
  if (value === "text/html" || value === "application/xhtml+xml") return "html";
  if (value === "text/css") return "css";
  if (value.startsWith("image/")) return "image";
  if (value.startsWith("font/") || new Set(["application/font-woff", "application/vnd.ms-fontobject"]).has(value)) return "font";
  if (value.startsWith("audio/") || value.startsWith("video/")) return "media";
  if (new Set(["application/pdf", "application/epub+zip", "application/rtf"]).has(value)) return "document";
  if (value.startsWith("text/") || /(?:json|xml|yaml)$/.test(value)) return "data";
  if (value === "application/octet-stream") return "binary";
  if (role === "other" || role === "public-proof") return "other";
  return "other";
}

function redirectFacts(items) {
  return items.map((item) => {
    if (item.decision === "redirect-left-origin" || item.decision === "redirect-credentials-blocked") return { status: item.status, toOriginSame: false, toBasePathSame: false };
    if (item.decision === "redirect-left-base-path") {
      return { status: item.status, toOriginSame: true, toBasePathSame: false };
    }
    return { status: item.status, toOriginSame: true, toBasePathSame: true };
  });
}

function mappedOutcome(check, declared, { attempts = check.attempts, redirects = check.redirects } = {}) {
  const role = roleForPath(declared.path);
  const redirectEvidence = redirectFacts(redirects || []);
  const common = {
    path: declared.path,
    role,
    expectedSha256: declared.sha256,
    expectedBytes: declared.size,
    actualSha256: null,
    actualBytes: null,
    httpStatus: null,
    mimeKind: null,
    attempts,
    redirects: redirectEvidence,
    state: "skipped",
    reasonCode: "request-failed",
  };
  if (check.outcome === "skipped" && check.reason === "platform-marker") return { ...common, attempts: 0, role: "platform-marker", reasonCode: "platform-marker" };
  if (check.outcome === "exact" || check.outcome === "transformed") {
    const kind = mimeKind(check.mime, role);
    return {
      ...common,
      actualSha256: check.actual.sha256,
      actualBytes: check.actual.size,
      httpStatus: check.status,
      mimeKind: kind,
      state: check.outcome === "exact" ? "exact" : "transformed",
      reasonCode: check.outcome === "exact" ? null : "content-transformed",
    };
  }
  if (check.outcome === "broken" && check.reason === "http-status" && Number(check.status) !== 200) {
    return { ...common, httpStatus: check.status, state: "missing", reasonCode: "http-error" };
  }
  if (check.outcome === "broken" && ["redirect-left-origin", "redirect-credentials-blocked"].includes(check.reason)) {
    return { ...common, state: "skipped", reasonCode: "redirect-outside-target" };
  }
  if (check.outcome === "broken" && check.reason === "redirect-left-base-path") {
    return { ...common, state: "skipped", reasonCode: "redirect-outside-target" };
  }
  if (check.outcome === "broken" && /redirect/.test(check.reason || "")) {
    return { ...common, state: "skipped", reasonCode: "redirect-policy-blocked" };
  }
  if (check.reason === "remote-authorization-required") return { ...common, state: "skipped", reasonCode: "request-blocked-by-policy", attempts: 0, redirects: [] };
  const preflight = attempts === 0;
  return { ...common, state: "skipped", reasonCode: preflight ? "verification-limit" : "request-failed" };
}

function severity(check) {
  if (check.outcome === "broken") return 4;
  if (check.outcome === "unverified") return 3;
  if (check.outcome === "transformed") return 2;
  if (check.outcome === "exact") return 1;
  return 0;
}

function mergedEntrypoint(http, declared) {
  const direct = http.entries.find((entry) => entry.path === "index.html");
  const checks = [http.baseProbe, direct].filter(Boolean).sort((left, right) => severity(right) - severity(left));
  const decisive = checks[0];
  const attempts = checks.reduce((sum, item) => sum + (item.attempts || 0), 0);
  const redirects = decisive.redirects || [];
  return mappedOutcome(decisive, declared, { attempts, redirects });
}

function filesFromHttp(http, entries) {
  return entries.map((declared) => declared.path === "index.html"
    ? mergedEntrypoint(http, declared)
    : mappedOutcome(http.entries.find((item) => item.path === declared.path), declared));
}

function summaryForFiles(files) {
  const states = (state) => files.filter((file) => file.state === state);
  const expectedBytes = (items) => items.reduce((sum, item) => sum + item.expectedBytes, 0);
  const fetched = files.filter((file) => file.state === "exact" || file.state === "transformed");
  return {
    expected: { files: files.length, bytes: expectedBytes(files) },
    fetched: { files: fetched.length, bytes: fetched.reduce((sum, item) => sum + item.actualBytes, 0) },
    matched: { files: states("exact").length, bytes: expectedBytes(states("exact")) },
    transformed: { files: states("transformed").length, bytes: expectedBytes(states("transformed")) },
    missing: { files: states("missing").length, bytes: expectedBytes(states("missing")) },
    skipped: { files: states("skipped").length, bytes: expectedBytes(states("skipped")) },
  };
}

function receiptStatus(files, browser, target) {
  const directBroken = files.some((file) => file.state === "missing" || file.reasonCode === "redirect-outside-target" || file.reasonCode === "redirect-policy-blocked") || browser?.status === "failed";
  if (directBroken) return "live-broken";
  const incomplete = files.some((file) => file.state === "skipped" && file.reasonCode !== "platform-marker") || browser === null || browser.status !== "passed" || !target.origin.startsWith("https://");
  if (incomplete) return "unverified";
  return files.some((file) => file.state === "transformed") ? "live-transformed-review" : "live-match";
}

function browserSummary(proof) {
  if (!proof) return null;
  const screenshotSource = proof.screenshots.some((item) => item.source === "diagnostic-with-capsule-fallback")
    ? "diagnostic-with-capsule-fallback"
    : "live-response-only";
  return {
    status: proof.status,
    scenarios: {
      expected: proof.summary.total,
      completed: proof.summary.passed + proof.summary.failed,
      passed: proof.summary.passed,
      failed: proof.summary.failed,
      skipped: proof.summary.incomplete,
    },
    screenshotSource,
    proofId: proof.proofId,
  };
}

function writeCreateOnly(path, value) {
  writeFileSync(path, value, { encoding: "utf8", flag: "wx", mode: 0o644 });
}

function writeDeploymentArtifacts(directory, artifacts, browserProof) {
  if (browserProof) writeCreateOnly(join(directory, "deployment-browser-proof.json"), `${JSON.stringify(browserProof, null, 2)}\n`);
  writeCreateOnly(join(directory, artifacts.artifactNames.json), artifacts.receiptJson);
  writeCreateOnly(join(directory, artifacts.artifactNames.markdown), artifacts.markdown);
  writeCreateOnly(join(directory, artifacts.artifactNames.markdownZhCN), artifacts.markdownZhCN);
  writeCreateOnly(join(directory, artifacts.artifactNames.html), artifacts.reportHtml);
}

export async function runVerifyDeployCommand(argv, dependencies = {}) {
  const options = parseArguments(argv);
  if (options.help) { console.log(usage()); return 0; }
  const now = dependencies.now || (() => new Date());
  const startedAt = now().toISOString();
  const capsule = await (dependencies.loadVerifiedPublishCapsule || loadVerifiedPublishCapsule)(options.source);
  const identity = {
    status: capsule.receipt.status,
    publishReady: capsule.receipt.publishReady,
    finalArchiveBrowserProofPassed: capsule.receipt.finalArchiveBrowserProofPassed,
    archive: { sha256: capsule.archiveSha256, bytes: capsule.archiveBytes.byteLength, readBackVerified: true },
    manifest: { manifestId: capsule.publicManifest.manifestId, deployContentId: capsule.receipt.deployContentId },
    browserProofId: capsule.receipt.finalArchiveBrowserProofId,
    entrypoint: "index.html",
    entries: capsule.entries.map((entry) => ({ path: entry.path, size: entry.size, sha256: entry.sha256 })),
  };
  (dependencies.validateNoteDeploymentBaseUrl || validateNoteDeploymentBaseUrl)(options.baseUrl, { allowRemote: options.allowRemote });
  const requestedOutputRoot = resolve(options.output);
  if (contained(capsule.runDirectory, requestedOutputRoot) || contained(requestedOutputRoot, capsule.runDirectory)) throw new Error("deployment evidence output must be separate from the publish run");
  const outputRoot = safeExistingDirectory(requestedOutputRoot, "deployment evidence root", { create: true });
  const http = await (dependencies.verifyNoteDeployment || verifyNoteDeployment)({ baseUrl: options.baseUrl, allowRemote: options.allowRemote, identity });
  const targetHash = createHash("sha256").update(`${http.target.origin}${http.target.basePath}`).digest("hex").slice(0, 10);
  const runId = `${timestamp(new Date(startedAt))}-${slug(new URL(http.target.origin).hostname)}-${targetHash}`;
  const finalDirectory = join(outputRoot, runId);
  const temporary = join(outputRoot, `.${runId}.${process.pid}.tmp`);
  if (existsSync(finalDirectory) || existsSync(temporary)) throw new Error("deployment evidence run already exists; no output was overwritten");
  mkdirSync(temporary, { mode: 0o700 });
  let exposed = false;
  try {
    let browserProof = null;
    if (!options.httpOnly && new Set(["exact-match", "transformed-review"]).has(http.status)) {
      try {
        browserProof = await (dependencies.runLiveDeploymentBrowserProof || runLiveDeploymentBrowserProof)({
          targetUrl: http.target.baseUrl,
          entries: new Map(capsule.entries.map((entry) => [entry.path, entry.bytes])),
          source: {
            archiveSha256: capsule.archiveSha256,
            archiveBytes: capsule.archiveBytes.byteLength,
            deployContentId: capsule.receipt.deployContentId,
            publishManifestId: capsule.publicManifest.manifestId,
            finalArchiveBrowserProofId: capsule.receipt.finalArchiveBrowserProofId,
          },
          entrypoint: "index.html",
          browserPath: options.browserPath,
          outputDirectory: temporary,
          generatedAt: now().toISOString(),
        });
      } catch (error) {
        if (dependencies.rethrowBrowserError) throw error;
        rmSync(join(temporary, "screenshots"), { recursive: true, force: true });
      }
    }
    const files = filesFromHttp(http, identity.entries);
    const browser = browserSummary(browserProof);
    const status = receiptStatus(files, browser, http.target);
    const verifiedAt = now().toISOString();
    const artifacts = (dependencies.buildNoteDeploymentArtifacts || buildNoteDeploymentArtifacts)({
      status,
      source: {
        archiveSha256: capsule.archiveSha256,
        archiveBytes: capsule.archiveBytes.byteLength,
        deployContentId: capsule.receipt.deployContentId,
        publishManifestId: capsule.publicManifest.manifestId,
        finalArchiveBrowserProofId: capsule.receipt.finalArchiveBrowserProofId,
      },
      target: { origin: http.target.origin, basePath: http.target.basePath },
      verification: {
        startedAt,
        verifiedAt,
        attempts: files.reduce((sum, file) => sum + file.attempts, 0),
        coverageComplete: files.every((file) => file.state !== "skipped" || file.reasonCode === "platform-marker"),
      },
      summary: summaryForFiles(files),
      files,
      browser,
    });
    writeDeploymentArtifacts(temporary, artifacts, browserProof);
    const validation = (dependencies.validateArtifactFiles || validateArtifactFiles)([temporary]);
    const invalid = validation.filter((item) => !item.valid);
    if (invalid.length) throw new Error(`generated deployment evidence failed validation: ${invalid.flatMap((item) => item.errors).join("; ")}`);
    renameSync(temporary, finalDirectory);
    exposed = true;
    console.log(`Live deployment status: ${artifacts.receipt.status}`);
    console.log(`Target:                 ${artifacts.receipt.target.origin}${artifacts.receipt.target.basePath}`);
    console.log(`Matched files:          ${artifacts.receipt.summary.matched.files}/${artifacts.receipt.summary.expected.files}`);
    console.log(`Deployment receipt:     ${join(finalDirectory, artifacts.artifactNames.html)}`);
    console.log(`Machine receipt:        ${join(finalDirectory, artifacts.artifactNames.json)}`);
    console.log("RealityCheck did not deploy or roll back this site. The receipt is point-in-time evidence only.");
    return artifacts.receipt.status === "live-match" ? 0 : artifacts.receipt.status === "unverified" ? 2 : 1;
  } finally {
    if (!exposed) rmSync(temporary, { recursive: true, force: true });
  }
}

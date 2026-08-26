#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadPublishInput } from "./note-publish-input.mjs";
import { preparePublishCandidate } from "./note-publish-candidate.mjs";
import { runPublishBrowserProof } from "./note-publish-browser.mjs";
import { PUBLISH_LIMITS, publishPlatformDecisions } from "./note-publish-policy.mjs";
import { buildNotePublishArtifacts } from "./note-publish-report.mjs";
import { verifyStoredZip, writeStoredZipWithManifest } from "./note-zip.mjs";

const encoder = new TextEncoder();
const READY_STATUSES = new Set(["ready", "warnings"]);
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function usage() {
  return `RealityCheck Publish — repair, prove, and package a passive HTML note site

Usage:
  realitycheck note publish <HTML|DIRECTORY|ZIP> [options]
  realitycheck publish <HTML|DIRECTORY|ZIP> [options]

Options:
  --entry PATH        Exact HTML entry when no root index.html exists
  --name NAME         Output slug (does not rename internal files)
  --output PATH       Evidence/output root (default: .realitycheck/publish)
  --browser PATH      Chrome, Edge, or Chromium executable
  --headed            Show browser proof scenarios
  --static-only       Stop after static preflight; output is not publish-ready
  --language en|zh-CN Terminal and repair-plan language (default: zh-CN)
  -h, --help          Show this help

The command never uploads or deploys the site. Only ready/warnings results use
the .realitycheck-publish.zip name; every incomplete result is clearly named
.realitycheck-working-copy.zip.`;
}

function parseArguments(argv) {
  const args = [...argv];
  const options = { input: null, entry: null, name: null, output: ".realitycheck/publish", browserPath: null, headed: false, staticOnly: false, language: "zh-CN", help: false };
  while (args.length) {
    const item = args.shift();
    if (item === "-h" || item === "--help") { options.help = true; continue; }
    if (item === "--headed") { options.headed = true; continue; }
    if (item === "--static-only") { options.staticOnly = true; continue; }
    if (["--entry", "--name", "--output", "--browser", "--language"].includes(item)) {
      const value = args.shift();
      if (!value) throw new Error(`${item} requires a value`);
      if (item === "--entry") options.entry = value.replaceAll("\\", "/");
      else if (item === "--name") options.name = value;
      else if (item === "--output") options.output = value;
      else if (item === "--browser") options.browserPath = value;
      else options.language = value;
      continue;
    }
    if (item.startsWith("--")) throw new Error(`Unknown publish option: ${item}`);
    if (options.input) throw new Error(`Unexpected publish argument: ${item}`);
    options.input = item;
  }
  if (!options.help && !options.input) throw new Error("publish requires an HTML file, directory, or ZIP archive");
  if (!new Set(["en", "zh-CN"]).has(options.language)) throw new Error("--language must be en or zh-CN");
  if (options.staticOnly && (options.headed || options.browserPath)) throw new Error("--static-only cannot be combined with --headed or --browser");
  return options;
}

function allocateRunDirectory(outputRoot, slug) {
  mkdirSync(outputRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  for (let index = 0; index < 1000; index += 1) {
    const suffix = index ? `-${String(index).padStart(3, "0")}` : "";
    const path = join(outputRoot, `${stamp}-${slug}${suffix}`);
    try {
      mkdirSync(path);
      return path;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error("Could not allocate a unique publish evidence directory");
}

function sha256Id(value) {
  return `sha256:${createHash("sha256").update(typeof value === "string" ? value : value).digest("hex")}`;
}

function proofId(proof) {
  return sha256Id(JSON.stringify(proof));
}

function findingSummary(candidate, { browserFailed = false } = {}) {
  const unverifiedStatic = candidate.blockers.filter((item) => /unverified|not-verified/.test(item.code)).reduce((sum, item) => sum + (Number(item.affected) || 1), 0);
  const errors = candidate.blockers.filter((item) => !/unverified|not-verified/.test(item.code)).reduce((sum, item) => sum + (Number(item.affected) || 1), 0);
  return {
    errors,
    warnings: Math.max(0, Number(candidate.after.summary.counts.warning) || 0),
    advice: Math.max(0, Number(candidate.after.summary.counts.advice) || 0),
    unverified: unverifiedStatic + (browserFailed ? 1 : 0),
  };
}

function browserPassed(result) {
  return Boolean(result?.proof?.passed);
}

function projectMountPassed(result) {
  const scenarios = result?.proof?.scenarios?.filter((scenario) => scenario.id.includes("project-mount")) || [];
  return scenarios.length === 2 && scenarios.every((scenario) => scenario.status === "passed");
}

function hasSubstantivePlatformReview(platforms) {
  const procedural = new Set(["cloudflare-direct-upload-cannot-switch-to-git", "github-pages-zip-requires-extraction-or-action"]);
  return Object.values(platforms).some((decision) => decision.status === "review" && decision.reasons.some((reason) => !procedural.has(reason)));
}

function deriveStatus(candidate, platforms, browserResult, browserError, staticOnly) {
  if (!candidate.staticGatePassed) return "working-copy";
  if (staticOnly || browserError) return "browser-proof-required";
  if (!browserPassed(browserResult)) return "working-copy";
  const counts = candidate.after.summary.counts;
  return counts.warning || counts.advice || hasSubstantivePlatformReview(platforms) ? "warnings" : "ready";
}

function markdownPlan(candidate, status, language) {
  const zh = language === "zh-CN";
  const lines = zh
    ? ["# RealityCheck HTML 发布技术报告", "", `- 发布状态：${status}`, `- 内容身份：${candidate.deployContentId}`, `- 首页：${candidate.entry}`, `- 安全元数据修复：${candidate.changes.metadata.length}`, `- 唯一路径修复：${candidate.changes.references.length}`, ""]
    : ["# RealityCheck HTML publish technical report", "", `- Publish status: ${status}`, `- Content identity: ${candidate.deployContentId}`, `- Entry: ${candidate.entry}`, `- Safe metadata fixes: ${candidate.changes.metadata.length}`, `- Unique path repairs: ${candidate.changes.references.length}`, ""];
  if (candidate.changes.metadata.length || candidate.changes.references.length) {
    lines.push(zh ? "## 已自动应用并复检" : "## Automatically applied and rechecked", "");
    for (const change of candidate.changes.metadata) lines.push(`- ${change.path}: ${change.ruleId}`);
    for (const change of candidate.changes.references) lines.push(`- ${change.path}:${change.line} — \`${change.before}\` → \`${change.after}\``);
    lines.push("");
  }
  const findings = [
    ...candidate.after.reports.flatMap((report) => report.findings.map((finding) => ({ ...finding, owner: report.path }))),
    ...candidate.after.packageFindings.map((finding) => ({ ...finding, owner: finding.evidence?.[0]?.path || "package" })),
  ].filter((finding) => finding.level !== "advice" || status !== "ready");
  if (findings.length) {
    lines.push(zh ? "## 仍需处理或人工复核" : "## Remaining repair or human review", "");
    for (const finding of findings) {
      lines.push(`- **[${finding.id}] ${zh ? finding.title.zhCN : finding.title.en}** (${finding.level}, ${finding.owner})`);
      lines.push(`  - ${zh ? "原因" : "Why"}: ${zh ? finding.summary.zhCN : finding.summary.en}`);
      lines.push(`  - ${zh ? "修改方法" : "How to fix"}: ${zh ? finding.remediation.zhCN : finding.remediation.en}`);
      for (const evidence of (finding.evidence || []).slice(0, 3)) lines.push(`  - \`${evidence.path}:${evidence.line}\` — ${evidence.excerpt}`);
    }
    lines.push("");
  }
  if (candidate.blockers.length) {
    lines.push(zh ? "## 发布阻断" : "## Publish blockers", "");
    for (const blocker of candidate.blockers) lines.push(`- ${blocker.code}${blocker.path ? ` — ${blocker.path}` : ""}`);
    lines.push("");
  }
  if (status === "ready" || status === "warnings") {
    lines.push(zh
      ? `发布包已经完成本地验证${status === "warnings" ? "，上传前请先复核上述非阻断提醒" : ""}。内容发生任何变化后才需要重新运行；RealityCheck 不会自动上传或部署文件。`
      : `The publish package has completed local verification${status === "warnings" ? "; review the non-blocking notes above before upload" : ""}. Rerun only after the content changes; RealityCheck never uploads or deploys files automatically.`);
  } else if (status === "browser-proof-required") {
    lines.push(zh ? "静态预检已完成，但仍需可用的 Chrome/Edge/Chromium。准备好浏览器后重新运行同一条 publish 命令；当前工作副本不可发布。" : "Static preflight completed, but Chrome/Edge/Chromium proof is still required. Rerun the same publish command when a browser is available; the current working copy is not publish-ready.");
  } else {
    lines.push(zh ? "处理上述阻断后，请重新运行同一条 publish 命令。RealityCheck 不会自动上传或部署文件。" : "Resolve the blockers above, then rerun the same publish command. RealityCheck never uploads or deploys files automatically.");
  }
  return `${lines.join("\n")}\n`;
}

async function makeArchive(entries) {
  const values = [...entries].sort(([left], [right]) => compareText(left, right)).map(([path, bytes]) => ({ path, bytes }));
  const totalBytes = values.reduce((sum, entry) => sum + entry.bytes.byteLength, 0);
  if (values.length > PUBLISH_LIMITS.maxFiles) throw new Error(`Final publish package exceeds the ${PUBLISH_LIMITS.maxFiles}-file limit`);
  if (totalBytes > PUBLISH_LIMITS.maxTotalBytes) throw new Error(`Final publish package exceeds the ${PUBLISH_LIMITS.maxTotalBytes}-byte content limit`);
  const oversized = values.find((entry) => entry.bytes.byteLength > PUBLISH_LIMITS.maxFileBytes);
  if (oversized) throw new Error(`Final publish file exceeds the ${PUBLISH_LIMITS.maxFileBytes}-byte limit: ${oversized.path}`);
  const built = await writeStoredZipWithManifest(values, { output: "uint8array" });
  await verifyStoredZip(built.archive, built.manifest);
  return built;
}

function addPublicProof(entries, artifacts, browserProof = null) {
  const output = new Map(entries);
  if ([...output.keys()].some((path) => path === "realitycheck-proof" || path.startsWith("realitycheck-proof/"))) {
    throw new Error("Refused to overwrite the input's reserved realitycheck-proof path");
  }
  output.set("realitycheck-proof/report.html", encoder.encode(artifacts.reportHtml));
  output.set("realitycheck-proof/manifest.json", encoder.encode(`${JSON.stringify(artifacts.manifest, null, 2)}\n`));
  if (browserProof) {
    if (proofId(browserProof) !== artifacts.manifest.browserProofId) throw new Error("Public browser proof differs from the manifest-bound proof ID");
    output.set("realitycheck-proof/browser-proof.json", encoder.encode(`${JSON.stringify(browserProof, null, 2)}\n`));
  }
  return output;
}

function technicalBundle(candidate, loaded, status, platforms, browserError, browserResult, finalBrowserResult) {
  return {
    schemaVersion: "1",
    kind: "html-note-publish-technical-report",
    generatedAt: new Date().toISOString(),
    status,
    source: { kind: loaded.sourceKind, files: loaded.files, bytes: loaded.bytes, contentId: loaded.sourceContentId, rootStripped: loaded.rootStripped },
    deploy: { contentId: candidate.deployContentId, entry: candidate.entry, gatewayGenerated: candidate.gatewayGenerated, files: candidate.contentContract.entries.length },
    changes: candidate.changes,
    blockers: candidate.blockers,
    analysis: { before: candidate.before, after: candidate.after },
    platforms,
    browser: {
      error: browserError ? String(browserError.message || browserError) : null,
      provisional: browserResult?.proof || null,
      finalArchive: finalBrowserResult?.proof || null,
    },
    boundaries: { uploaded: false, deployed: false, sourceModified: false, sourceExcerptsMayBePresent: true },
  };
}

/** End-to-end passive HTML publish capsule command. */
export async function runNotePublishCommand(argv, { runBrowserProof = runPublishBrowserProof } = {}) {
  const options = parseArguments(argv);
  if (options.help) { console.log(usage()); return 0; }
  const loaded = await loadPublishInput(options.input, { name: options.name });
  const candidate = preparePublishCandidate(loaded.entries, { entry: options.entry });
  if (candidate.blockers.some((blocker) => blocker.code === "reserved-proof-path")) {
    throw new Error("Refused to overwrite the input's reserved realitycheck-proof path; rename or remove that user-owned directory before publishing");
  }
  const outputRoot = resolve(options.output);
  const runDirectory = allocateRunDirectory(outputRoot, loaded.slug);
  const provisional = await makeArchive(candidate.entries);
  let browserResult = null;
  let browserError = null;
  if (candidate.staticGatePassed && !options.staticOnly) {
    try {
      browserResult = await runBrowserProof({
        archive: provisional.archive,
        manifest: provisional.manifest,
        deployManifestEntries: candidate.contentContract.entries,
        deployContentId: candidate.deployContentId,
        entrypoint: "index.html",
        outputDirectory: join(runDirectory, "browser-deploy-content"),
        browserPath: options.browserPath,
        headed: options.headed,
      });
    } catch (error) { browserError = error; }
  }
  const platforms = publishPlatformDecisions({
    files: candidate.policy.files,
    bytes: candidate.policy.bytes,
    maxFileBytes: candidate.policy.maxFileBytes,
    hasRootIndex: candidate.entries.has("index.html"),
    browserProofPassed: browserPassed(browserResult),
    projectMountPassed: projectMountPassed(browserResult),
    blockers: candidate.blockers,
  });
  let status = deriveStatus(candidate, platforms, browserResult, browserError, options.staticOnly);
  const embeddedBrowserProofId = browserResult?.proof ? proofId(browserResult.proof) : null;
  let findings = findingSummary(candidate, { browserFailed: status === "working-copy" && candidate.staticGatePassed });
  const generatedAt = new Date().toISOString();
  let publicBrowserProof = browserResult?.proof || null;
  let publicArtifacts = buildNotePublishArtifacts({ generatedAt, deployContentId: candidate.deployContentId, browserProofId: embeddedBrowserProofId, status, platformDecisions: platforms, findingsSummary: findings });
  let finalEntries = addPublicProof(candidate.entries, publicArtifacts, publicBrowserProof);
  let finalArchive = await makeArchive(finalEntries);
  let finalBrowserResult = null;
  let finalBrowserError = null;
  if (READY_STATUSES.has(status)) {
    try {
      finalBrowserResult = await runBrowserProof({
        archive: finalArchive.archive,
        manifest: finalArchive.manifest,
        deployManifestEntries: candidate.contentContract.entries,
        deployContentId: candidate.deployContentId,
        entrypoint: "index.html",
        outputDirectory: join(runDirectory, "browser-final-archive"),
        browserPath: options.browserPath,
        headed: options.headed,
      });
    } catch (error) { finalBrowserError = error; }
    if (!browserPassed(finalBrowserResult)) {
      status = finalBrowserResult?.proof ? "working-copy" : "browser-proof-required";
      findings = findingSummary(candidate, { browserFailed: status === "working-copy" });
      const downgradedPlatforms = publishPlatformDecisions({ files: candidate.policy.files, bytes: candidate.policy.bytes, maxFileBytes: candidate.policy.maxFileBytes, hasRootIndex: true, browserProofPassed: false, projectMountPassed: false, blockers: candidate.blockers });
      Object.assign(platforms, downgradedPlatforms);
      publicBrowserProof = finalBrowserResult?.proof || null;
      publicArtifacts = buildNotePublishArtifacts({ generatedAt, deployContentId: candidate.deployContentId, browserProofId: publicBrowserProof ? proofId(publicBrowserProof) : null, status, platformDecisions: platforms, findingsSummary: findings });
      finalEntries = addPublicProof(candidate.entries, publicArtifacts, publicBrowserProof);
      finalArchive = await makeArchive(finalEntries);
    }
  }
  const publishReady = READY_STATUSES.has(status) && browserPassed(finalBrowserResult);
  const stem = `${loaded.slug}.${publishReady ? "realitycheck-publish" : "realitycheck-working-copy"}`;
  const archiveName = `${stem}.zip`;
  const archivePath = join(runDirectory, archiveName);
  writeFileSync(archivePath, finalArchive.archive);
  const archiveSha256 = createHash("sha256").update(finalArchive.archive).digest("hex");
  writeFileSync(`${archivePath}.sha256`, `${archiveSha256}  ${archiveName}\n`, "utf8");
  const finalProofId = finalBrowserResult?.proof ? proofId(finalBrowserResult.proof) : null;
  const receipt = {
    schemaVersion: "1",
    kind: "html-note-publish-receipt",
    generatedAt: new Date().toISOString(),
    status,
    publishReady,
    archive: { filename: archiveName, bytes: finalArchive.archive.byteLength, sha256: archiveSha256, readBackVerified: true },
    sourceContentId: loaded.sourceContentId,
    deployContentId: candidate.deployContentId,
    embeddedBrowserProofId: publicArtifacts.manifest.browserProofId,
    finalArchiveBrowserProofId: finalProofId,
    finalArchiveBrowserProofPassed: browserPassed(finalBrowserResult),
    browserProofError: finalBrowserError ? String(finalBrowserError.message || finalBrowserError).slice(0, 500) : browserError ? String(browserError.message || browserError).slice(0, 500) : null,
    platformDecisions: platforms,
    boundaries: { uploaded: false, deployed: false, archiveSidecarBindsContainerBytes: true, publicManifestBindsDeployContent: true },
  };
  writeFileSync(join(runDirectory, `${stem}.receipt.json`), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  writeFileSync(join(runDirectory, `${stem}.manifest.json`), `${JSON.stringify(publicArtifacts.manifest, null, 2)}\n`, "utf8");
  writeFileSync(join(runDirectory, `${stem}.report.html`), publicArtifacts.reportHtml, "utf8");
  writeFileSync(join(runDirectory, "technical-report.json"), `${JSON.stringify(technicalBundle(candidate, loaded, status, platforms, browserError || finalBrowserError, browserResult, finalBrowserResult), null, 2)}\n`, "utf8");
  writeFileSync(join(runDirectory, options.language === "zh-CN" ? "repair-plan.zh-CN.md" : "repair-plan.md"), markdownPlan(candidate, status, options.language), "utf8");
  const zh = options.language === "zh-CN";
  console.log(zh ? `发布判断：${status}` : `Publish decision: ${status}`);
  console.log(zh ? `交付文件：${archivePath}` : `Deliverable: ${archivePath}`);
  console.log(zh ? `公开证明：${join(runDirectory, `${stem}.report.html`)}` : `Public proof: ${join(runDirectory, `${stem}.report.html`)}`);
  console.log(zh ? `技术报告：${join(runDirectory, "technical-report.json")}` : `Technical report: ${join(runDirectory, "technical-report.json")}`);
  console.log(zh ? `校验收据：${join(runDirectory, `${stem}.receipt.json`)}` : `Verification receipt: ${join(runDirectory, `${stem}.receipt.json`)}`);
  console.log(zh ? `ZIP 校验和：${archivePath}.sha256` : `ZIP checksum: ${archivePath}.sha256`);
  console.log(zh ? "RealityCheck 未上传或部署该文件。" : "RealityCheck did not upload or deploy this file.");
  return publishReady ? 0 : 1;
}

const direct = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (direct) {
  runNotePublishCommand(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(`RealityCheck Publish error: ${error.message}`);
    process.exitCode = 2;
  });
}

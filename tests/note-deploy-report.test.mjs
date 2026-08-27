import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  buildNoteDeploymentArtifacts,
  buildNoteDeploymentReceipt,
  NOTE_DEPLOY_ARTIFACT_NAMES,
  NOTE_DEPLOY_STATUSES,
  renderNoteDeploymentReceiptHtml,
  renderNoteDeploymentReceiptMarkdown,
  validateNoteDeploymentReceipt,
} from "../realitycheck/scripts/note-deploy-report.mjs";
import { validateArtifactFiles } from "../realitycheck/scripts/artifact-validator.mjs";
import { inspectPassiveStaticEntries } from "../realitycheck/scripts/note-publish-policy.mjs";

const ARCHIVE_SHA = "f".repeat(64);
const BROWSER_PROOF_ID = `sha256:${"e".repeat(64)}`;

function expectedFiles() {
  return [
    { path: "index.html", role: "entry-html", expectedSha256: "a".repeat(64), expectedBytes: 100 },
    { path: "assets/author's&theme`print.css", role: "stylesheet", expectedSha256: "b".repeat(64), expectedBytes: 50 },
  ];
}

function deployContentId(expected = expectedFiles()) {
  const entries = [...expected]
    .filter((file) => file.role !== "public-proof")
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
    .map((file) => ({ path: file.path, size: file.expectedBytes, sha256: file.expectedSha256 }));
  const contract = { contract: "realitycheck-publish-deploy-content-v1", entrypoint: "index.html", entries };
  return `sha256:${createHash("sha256").update(JSON.stringify(contract), "utf8").digest("hex")}`;
}

function exact(file, overrides = {}) {
  return {
    ...file,
    actualSha256: file.expectedSha256,
    actualBytes: file.expectedBytes,
    httpStatus: 200,
    mimeKind: file.role.includes("html") ? "html" : "css",
    attempts: 1,
    redirects: [],
    state: "exact",
    reasonCode: null,
    ...overrides,
  };
}

function summary(files) {
  const byState = (state) => files.filter((file) => file.state === state);
  const expectedBytes = (items) => items.reduce((sum, file) => sum + file.expectedBytes, 0);
  const fetched = files.filter((file) => ["exact", "transformed"].includes(file.state));
  return {
    expected: { files: files.length, bytes: expectedBytes(files) },
    fetched: { files: fetched.length, bytes: fetched.reduce((sum, file) => sum + file.actualBytes, 0) },
    matched: { files: byState("exact").length, bytes: expectedBytes(byState("exact")) },
    transformed: { files: byState("transformed").length, bytes: expectedBytes(byState("transformed")) },
    missing: { files: byState("missing").length, bytes: expectedBytes(byState("missing")) },
    skipped: { files: byState("skipped").length, bytes: expectedBytes(byState("skipped")) },
  };
}

function passedBrowser() {
  return { status: "passed", scenarios: { expected: 3, completed: 3, passed: 3, failed: 0, skipped: 0 }, screenshotSource: "live-response-only", proofId: BROWSER_PROOF_ID };
}

function input({ status = "live-match", files = expectedFiles().map((file) => exact(file)), browser = passedBrowser(), coverageComplete = files.every((file) => file.state !== "skipped"), overrides = {} } = {}) {
  return {
    status,
    source: {
      archiveSha256: ARCHIVE_SHA,
      archiveBytes: 4096,
      deployContentId: deployContentId(files),
      publishManifestId: `sha256:${"d".repeat(64)}`,
      finalArchiveBrowserProofId: `sha256:${"f".repeat(64)}`,
    },
    target: { origin: "https://notes.example", basePath: "/research&notes/" },
    verification: {
      startedAt: "2026-08-27T10:00:00.000Z",
      verifiedAt: "2026-08-27T10:00:03.000Z",
      attempts: files.reduce((sum, file) => sum + file.attempts, 0),
      coverageComplete,
    },
    summary: summary(files),
    files,
    browser,
    ...overrides,
  };
}

function transformedInput() {
  const [entry, style] = expectedFiles();
  const files = [exact(entry), exact(style, {
    actualSha256: "c".repeat(64),
    actualBytes: 54,
    state: "transformed",
    reasonCode: "content-transformed",
    redirects: [{ status: 301, toOriginSame: true, toBasePathSame: true }],
  })];
  return input({ status: "live-transformed-review", files });
}

function brokenInput() {
  const [entry, style] = expectedFiles();
  const files = [exact(entry), exact(style, {
    actualSha256: null,
    actualBytes: null,
    httpStatus: 404,
    mimeKind: "html",
    state: "missing",
    reasonCode: "http-error",
  })];
  const browser = { status: "failed", scenarios: { expected: 3, completed: 3, passed: 2, failed: 1, skipped: 0 }, screenshotSource: "live-response-only", proofId: BROWSER_PROOF_ID };
  return input({ status: "live-broken", files, browser });
}

function unverifiedInput() {
  const [entry, style] = expectedFiles();
  const files = [exact(entry), exact(style, {
    actualSha256: null,
    actualBytes: null,
    httpStatus: null,
    mimeKind: null,
    attempts: 2,
    state: "skipped",
    reasonCode: "request-failed",
  })];
  return input({ status: "unverified", files, browser: null, coverageComplete: false });
}

test("deployment receipt artifacts are deterministic, bilingual, self-contained, escaped, and privacy-bounded", () => {
  const first = buildNoteDeploymentArtifacts(input());
  const second = buildNoteDeploymentArtifacts(input({ files: [...input().files].reverse() }));
  assert.deepEqual(second, first);
  assert.deepEqual(first.artifactNames, NOTE_DEPLOY_ARTIFACT_NAMES);
  assert.deepEqual(first.artifactNames, {
    json: "deployment-receipt.json",
    markdown: "deployment-receipt.md",
    markdownZhCN: "deployment-receipt.zh-CN.md",
    html: "deployment-receipt.html",
  });
  assert.equal(first.receipt.kind, "html-note-deployment-receipt");
  assert.equal(first.receipt.status, "live-match");
  assert.match(first.receipt.receiptId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.receipt.source.deployContentId, deployContentId());
  assert.deepEqual(first.receipt.reasonCodes, []);
  assert.deepEqual(first.receipt.verification.freshness, {
    basis: "point-in-time-only",
    statementCode: "live-state-may-change-after-verification",
  });
  assert.equal(first.receipt.limitations.responseBodiesStored, false);
  assert.equal(first.receipt.limitations.credentialsStored, false);
  assert.equal(first.receipt.limitations.browserScreenshotsStored, true);
  assert.equal(first.receipt.browser.screenshotSource, "live-response-only");

  assert.match(first.reportHtml, /^<!doctype html>/);
  assert.match(first.reportHtml, /LIVE BYTES MATCH/);
  assert.match(first.reportHtml, /线上字节一致/);
  assert.match(first.reportHtml, /type="radio" name="report-language" id="language-en" checked/);
  assert.match(first.reportHtml, /type="radio" name="report-language" id="language-zh"/);
  assert.match(first.reportHtml, /#language-zh:checked~\.report \.i18n-en\{display:none\}/);
  assert.match(first.reportHtml, /https:\/\/notes\.example\/research&amp;notes\//);
  assert.match(first.reportHtml, /author&#39;s&amp;theme`print\.css/);
  assert.doesNotMatch(first.reportHtml, /author's&theme/);
  assert.doesNotMatch(first.reportHtml, /<script\b|<img\b|<link[^>]+stylesheet|javascript\s*:/i);
  assert.match(first.reportHtml, /default-src 'none';style-src 'unsafe-inline';script-src 'none'/);
  assert.doesNotMatch(first.reportHtml, /responseBody|responseHeaders|cookieValue|authorizationValue/);
  assert.match(first.reportHtml, /rendered only from reverified target responses/);
  assert.match(first.reportHtml, /仅由已复核目标响应渲染/);
  assert.deepEqual(inspectPassiveStaticEntries([{ path: "deployment-receipt.html", bytes: new TextEncoder().encode(first.reportHtml) }]).blockers, []);

  assert.match(first.markdown, /# RealityCheck live deployment receipt/);
  assert.match(first.markdown, /Freshness: point-in-time only/);
  assert.match(first.markdown, /rendered only from reverified target responses/);
  assert.match(first.markdown, /author's&theme&#96;print\.css/);
  assert.match(first.markdownZhCN, /# RealityCheck 线上部署回执/);
  assert.match(first.markdownZhCN, /新鲜度：仅代表上述时间点/);
  assert.equal(first.receiptJson, `${JSON.stringify(first.receipt, null, 2)}\n`);
});

test("all four live states carry distinct evidence-bound decisions", () => {
  const match = buildNoteDeploymentReceipt(input());
  assert.equal(match.status, "live-match");
  assert.deepEqual(match.summary.matched, { files: 2, bytes: 150 });

  const transformed = buildNoteDeploymentReceipt(transformedInput());
  assert.equal(transformed.status, "live-transformed-review");
  assert.deepEqual(transformed.reasonCodes, ["host-transformed-content"]);
  assert.deepEqual(transformed.summary.transformed, { files: 1, bytes: 50 });
  assert.deepEqual(transformed.summary.fetched, { files: 2, bytes: 154 });
  assert.match(renderNoteDeploymentReceiptHtml(transformed), /HOST TRANSFORMATION REVIEW/);
  assert.match(renderNoteDeploymentReceiptMarkdown(transformed, "zh-CN"), /托管平台改变了一个或多个部署文件的字节/);

  const broken = buildNoteDeploymentReceipt(brokenInput());
  assert.equal(broken.status, "live-broken");
  assert.deepEqual(broken.reasonCodes, ["browser-failed", "live-resource-missing"]);
  assert.deepEqual(broken.summary.missing, { files: 1, bytes: 50 });
  assert.match(renderNoteDeploymentReceiptHtml(broken), /LIVE DEPLOYMENT BROKEN/);

  const unverified = buildNoteDeploymentReceipt(unverifiedInput());
  assert.equal(unverified.status, "unverified");
  assert.deepEqual(unverified.reasonCodes, ["browser-not-run", "request-failed", "verification-coverage-incomplete"]);
  assert.deepEqual(unverified.summary.skipped, { files: 1, bytes: 50 });
  assert.equal(unverified.limitations.browserScreenshotsStored, false);
  assert.match(renderNoteDeploymentReceiptHtml(unverified), /LIVE STATE UNVERIFIED/);

  const insecure = buildNoteDeploymentReceipt(input({ status: "unverified", overrides: { target: { origin: "http://notes.example", basePath: "/" } } }));
  assert.deepEqual(insecure.reasonCodes, ["target-not-https"]);

  const incompleteBrowser = buildNoteDeploymentReceipt(input({
    status: "unverified",
    browser: { status: "incomplete", scenarios: { expected: 3, completed: 2, passed: 2, failed: 0, skipped: 1 }, screenshotSource: "diagnostic-with-capsule-fallback", proofId: BROWSER_PROOF_ID },
  }));
  assert.deepEqual(incompleteBrowser.reasonCodes, ["browser-incomplete"]);
  assert.equal(incompleteBrowser.limitations.browserScreenshotsStored, true);
  assert.match(renderNoteDeploymentReceiptHtml(incompleteBrowser), /capture scenario used verified-capsule fallback bytes/);
  assert.match(renderNoteDeploymentReceiptMarkdown(incompleteBrowser, "zh-CN"), /截图场景使用了已验证 capsule 的回放字节/);

  const markerExpected = { path: ".nojekyll", role: "platform-marker", expectedSha256: "d".repeat(64), expectedBytes: 0 };
  const marker = exact(markerExpected, {
    actualSha256: null,
    actualBytes: null,
    httpStatus: null,
    mimeKind: null,
    attempts: 0,
    state: "skipped",
    reasonCode: "platform-marker",
  });
  const markerFiles = [...expectedFiles().map((file) => exact(file)), marker];
  const markerMatch = buildNoteDeploymentReceipt(input({ files: markerFiles, coverageComplete: true }));
  assert.equal(markerMatch.status, "live-match");
  assert.deepEqual(markerMatch.summary.skipped, { files: 1, bytes: 0 });
  assert.deepEqual(markerMatch.reasonCodes, []);

  const publicProof = exact({ path: "realitycheck-proof/report.html", role: "public-proof", expectedSha256: "9".repeat(64), expectedBytes: 40 }, { mimeKind: "html" });
  const proofFiles = [...expectedFiles().map((file) => exact(file)), publicProof];
  const proofMatch = buildNoteDeploymentReceipt(input({ files: proofFiles }));
  assert.equal(proofMatch.source.deployContentId, deployContentId(expectedFiles()));
  assert.deepEqual(proofMatch.summary.expected, { files: 3, bytes: 190 });
  assert.deepEqual(proofMatch.summary.matched, { files: 3, bytes: 190 });
  const missingMimeFiles = expectedFiles().map((file) => exact(file));
  missingMimeFiles[0].mimeKind = null;
  const missingMime = buildNoteDeploymentReceipt(input({ files: missingMimeFiles }));
  assert.equal(missingMime.status, "live-match");
  assert.equal(missingMime.files.find((file) => file.path === "index.html").mimeKind, null);
  assert.deepEqual(NOTE_DEPLOY_STATUSES, ["live-match", "live-transformed-review", "live-broken", "unverified"]);
});

test("builders reject contradictory green claims, incomplete match evidence, leaks, unsafe targets, and bad bindings", () => {
  assert.throws(() => buildNoteDeploymentReceipt(input({ browser: null })), /live-match contradicts/);
  assert.throws(() => buildNoteDeploymentReceipt(input({ status: "unverified" })), /unverified requires incomplete proof/);
  assert.throws(() => buildNoteDeploymentReceipt(input({ status: "live-broken" })), /live-broken requires direct/);

  const unchangedTransformation = transformedInput();
  unchangedTransformation.files[1].actualSha256 = unchangedTransformation.files[1].expectedSha256;
  unchangedTransformation.files[1].actualBytes = unchangedTransformation.files[1].expectedBytes;
  unchangedTransformation.summary = summary(unchangedTransformation.files);
  assert.throws(() => buildNoteDeploymentReceipt(unchangedTransformation), /transformed state requires/);

  const badSummary = input();
  badSummary.summary.matched.files = 1;
  assert.throws(() => buildNoteDeploymentReceipt(badSummary), /summary counts or bytes/);

  const badDeployId = input();
  badDeployId.source.deployContentId = `sha256:${"0".repeat(64)}`;
  assert.throws(() => buildNoteDeploymentReceipt(badDeployId), /deployContentId does not bind/);

  const duplicate = input();
  duplicate.files.push(structuredClone(duplicate.files[0]));
  duplicate.summary = summary(duplicate.files);
  duplicate.verification.attempts = duplicate.files.reduce((sum, file) => sum + file.attempts, 0);
  assert.throws(() => buildNoteDeploymentReceipt(duplicate), /duplicate path/);

  const disguisedProof = input();
  disguisedProof.files[1].role = "public-proof";
  assert.throws(() => buildNoteDeploymentReceipt(disguisedProof), /public-proof role/);
  const unmarkedProof = input();
  unmarkedProof.files[1].path = "realitycheck-proof/report.html";
  assert.throws(() => buildNoteDeploymentReceipt(unmarkedProof), /public-proof role/);
  const disguisedMarker = input();
  disguisedMarker.files[1].role = "platform-marker";
  assert.throws(() => buildNoteDeploymentReceipt(disguisedMarker), /platform-marker role/);

  assert.throws(() => buildNoteDeploymentReceipt(input({ overrides: { target: { origin: "https://alice:secret@notes.example", basePath: "/" } } })), /without credentials/);
  assert.throws(() => buildNoteDeploymentReceipt(input({ overrides: { target: { origin: "https://notes.example?token=secret", basePath: "/" } } })), /without credentials, path, query, or fragment/);
  assert.throws(() => buildNoteDeploymentReceipt(input({ overrides: { target: { origin: "https://notes.example", basePath: "/notes/?token=secret" } } })), /canonical absolute pathname/);
  assert.throws(() => buildNoteDeploymentReceipt({ ...input(), operatorMessage: "private response body" }), /unsupported fields/);
  assert.throws(() => renderNoteDeploymentReceiptMarkdown(buildNoteDeploymentReceipt(input()), "fr"), /language must be en or zh-CN/);
});

test("schema and semantic artifact validation reject tampering after JSON persistence", () => {
  const directory = mkdtempSync(join(tmpdir(), "realitycheck-deployment-receipt-"));
  const path = join(directory, "deployment-receipt.json");
  try {
    const standalone = buildNoteDeploymentReceipt(unverifiedInput());
    writeFileSync(path, `${JSON.stringify(standalone, null, 2)}\n`, "utf8");
    let [result] = validateArtifactFiles([directory]);
    assert.equal(result.kind, "html-note-deployment-receipt");
    assert.equal(result.valid, true, result.errors.join("\n"));
    assert.deepEqual(validateNoteDeploymentReceipt(standalone), standalone);

    const canonicalRootReceipt = buildNoteDeploymentReceipt({ ...unverifiedInput(), target: { origin: "https://notes.example", basePath: "/" } });
    writeFileSync(path, `${JSON.stringify(canonicalRootReceipt, null, 2)}\n`, "utf8");
    [result] = validateArtifactFiles([path]);
    assert.equal(result.valid, true, result.errors.join("\n"));

    const receipt = buildNoteDeploymentReceipt(input());

    const contradictory = structuredClone(receipt);
    contradictory.status = "unverified";
    writeFileSync(path, `${JSON.stringify(contradictory, null, 2)}\n`, "utf8");
    [result] = validateArtifactFiles([path]);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /unverified requires incomplete proof/);

    const badCount = structuredClone(receipt);
    badCount.summary.expected.files = 1;
    writeFileSync(path, `${JSON.stringify(badCount, null, 2)}\n`, "utf8");
    [result] = validateArtifactFiles([path]);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /summary counts or bytes/);

    const badHashBinding = structuredClone(receipt);
    badHashBinding.source.deployContentId = `sha256:${"0".repeat(64)}`;
    writeFileSync(path, `${JSON.stringify(badHashBinding, null, 2)}\n`, "utf8");
    [result] = validateArtifactFiles([path]);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /deployContentId does not bind/);

    const hiddenScreenshots = structuredClone(receipt);
    hiddenScreenshots.limitations.browserScreenshotsStored = false;
    writeFileSync(path, `${JSON.stringify(hiddenScreenshots, null, 2)}\n`, "utf8");
    [result] = validateArtifactFiles([path]);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /limitations are unsupported or altered/);

    const freeTextLeak = structuredClone(receipt);
    freeTextLeak.error = "Authorization: Bearer private-token";
    writeFileSync(path, `${JSON.stringify(freeTextLeak, null, 2)}\n`, "utf8");
    [result] = validateArtifactFiles([path]);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /additional properties/);

    const mimeLeak = structuredClone(receipt);
    mimeLeak.files[0].mimeKind = "text/html; authorization=secret";
    writeFileSync(path, `${JSON.stringify(mimeLeak, null, 2)}\n`, "utf8");
    [result] = validateArtifactFiles([path]);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /mimeKind/);

    const unsafePath = structuredClone(receipt);
    unsafePath.files[0].path = "C:\\Users\\Alice\\private.html";
    writeFileSync(path, `${JSON.stringify(unsafePath, null, 2)}\n`, "utf8");
    [result] = validateArtifactFiles([path]);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /files\/0\/path|portable/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

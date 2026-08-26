import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNotePublishArtifacts,
  buildNotePublishManifest,
  NOTE_PUBLISH_STATUSES,
  renderNotePublishReport,
} from "../realitycheck/scripts/note-publish-report.mjs";
import { inspectPassiveStaticEntries } from "../realitycheck/scripts/note-publish-policy.mjs";

const DEPLOY_ID = `sha256:${"a".repeat(64)}`;
const BROWSER_ID = `sha256:${"b".repeat(64)}`;

function findings(overrides = {}) {
  return { errors: 0, warnings: 0, advice: 0, unverified: 0, ...overrides };
}

function platforms(overrides = {}) {
  return {
    netlifyDrop: { status: "pass", reasons: [] },
    cloudflarePagesDirectUpload: { status: "review", reasons: ["cloudflare-direct-upload-cannot-switch-to-git"] },
    githubPages: { status: "review", reasons: ["github-pages-zip-requires-extraction-or-action"] },
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    generatedAt: "2026-08-27T09:30:00.000Z",
    deployContentId: DEPLOY_ID,
    browserProofId: BROWSER_ID,
    status: "ready",
    platformDecisions: platforms(),
    findingsSummary: findings(),
    ...overrides,
  };
}

test("public publish proof is deterministic, bilingual, self-contained, and source-free", () => {
  const first = buildNotePublishArtifacts(input());
  const second = buildNotePublishArtifacts(input({
    platformDecisions: {
      githubPages: { status: "review", reasons: ["github-pages-zip-requires-extraction-or-action", "github-pages-zip-requires-extraction-or-action"] },
      cloudflarePagesDirectUpload: { status: "review", reasons: ["cloudflare-direct-upload-cannot-switch-to-git"] },
      netlifyDrop: { status: "pass", reasons: [] },
    },
  }));
  assert.deepEqual(second.manifest, first.manifest);
  assert.equal(second.reportHtml, first.reportHtml);
  assert.match(first.manifest.manifestId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.manifest.deployContentId, DEPLOY_ID);
  assert.equal(first.manifest.browserProofId, BROWSER_ID);
  assert.deepEqual(first.manifest.boundaries, {
    sourceUploaded: false,
    sourceTextIncluded: false,
    absoluteLocalPathsIncluded: false,
    automaticDeployment: false,
    remoteHostVerified: false,
    javascriptExecuted: false,
    externalRequestsAllowed: false,
    browserProofPresent: true,
  });
  assert.equal(first.manifest.platformPolicy.checkedAt, "2026-08-27");
  assert.match(first.manifest.platformPolicy.sources.cloudflarePagesDirectUpload, /^https:\/\/developers\.cloudflare\.com\//);

  const html = first.reportHtml;
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /VERIFIED LOCALLY · READY TO UPLOAD/);
  assert.match(html, /已完成本地验证 · 可上传/);
  assert.match(html, /GitHub Pages 不会直接发布此 ZIP/);
  assert.match(html, /直接上传项目之后不能切换为 Git 集成/);
  assert.match(html, /realitycheck-deploy-content-id/);
  assert.match(html, /realitycheck-publish-manifest-id/);
  assert.match(html, /default-src 'none';style-src 'unsafe-inline';script-src 'none'/);
  assert.match(html, /connect-src 'none';font-src 'none';object-src 'none'/);
  assert.doesNotMatch(html, /<script\b/i);
  assert.doesNotMatch(html, /\son[a-z0-9_-]+\s*=|javascript\s*:/i);
  assert.doesNotMatch(html, /<link[^>]+stylesheet|<img\b|@import|url\(https?:/i);
  assert.doesNotMatch(html, /C:\\Users\\|\/home\/|127\.0\.0\.1|localhost|private-note-source/i);
  assert.match(html, /type="radio" name="report-language" id="language-en" checked/);
  assert.match(html, /type="radio" name="report-language" id="language-zh"/);
  assert.match(html, /#language-zh:checked~\.report \.i18n-en\{display:none\}/);
  assert.match(html, /#language-zh:checked~\.report \.i18n-zh\{display:inline\}/);
  const passiveInspection = inspectPassiveStaticEntries([{ path: "publish-proof.html", bytes: new TextEncoder().encode(html) }]);
  assert.deepEqual(passiveInspection.blockers, []);
});

test("the four public states have distinct truthful decisions", () => {
  const ready = buildNotePublishArtifacts(input());
  assert.equal(ready.manifest.status, "ready");
  assert.match(ready.reportHtml, /No local blockers for the selected hosts/);

  const warning = buildNotePublishArtifacts(input({
    status: "warnings",
    findingsSummary: findings({ warnings: 2, advice: 1 }),
    platformDecisions: platforms({
      netlifyDrop: { status: "review", reasons: ["netlify-file-recommendation"] },
    }),
  }));
  assert.match(warning.reportHtml, /WARNINGS DISCLOSED/);
  assert.match(warning.reportHtml, /提醒已披露/);
  assert.equal(warning.manifest.findingsSummary.warnings, 2);

  const proofRequired = buildNotePublishArtifacts(input({
    status: "browser-proof-required",
    browserProofId: null,
    platformDecisions: platforms({
      netlifyDrop: { status: "block", reasons: ["required-gate-failed"] },
      cloudflarePagesDirectUpload: { status: "block", reasons: ["required-gate-failed", "cloudflare-direct-upload-cannot-switch-to-git"] },
      githubPages: { status: "block", reasons: ["required-gate-failed", "github-pages-zip-requires-extraction-or-action"] },
    }),
  }));
  assert.equal(proofRequired.manifest.boundaries.browserProofPresent, false);
  assert.match(proofRequired.reportHtml, /STATIC PREFLIGHT ONLY/);
  assert.match(proofRequired.reportHtml, /仅完成静态预检/);
  assert.match(proofRequired.reportHtml, /Not attached/);

  const working = buildNotePublishArtifacts(input({
    status: "working-copy",
    browserProofId: null,
    findingsSummary: findings({ errors: 1, unverified: 2 }),
    platformDecisions: platforms({
      netlifyDrop: { status: "block", reasons: ["required-gate-failed"] },
      cloudflarePagesDirectUpload: { status: "block", reasons: ["required-gate-failed", "cloudflare-file-count", "cloudflare-direct-upload-cannot-switch-to-git"] },
      githubPages: { status: "block", reasons: ["required-gate-failed", "github-pages-zip-requires-extraction-or-action"] },
    }),
  }));
  assert.match(working.reportHtml, /WORKING COPY ONLY · DO NOT PUBLISH/);
  assert.match(working.reportHtml, /仅限工作副本 · 请勿发布/);
  assert.deepEqual(NOTE_PUBLISH_STATUSES, ["ready", "warnings", "browser-proof-required", "working-copy"]);
});

test("the public contract rejects free text, local paths, unknown reasons, and contradictory states", () => {
  assert.throws(() => buildNotePublishManifest({
    ...input(),
    sourcePath: "C:\\Users\\Alice\\Desktop\\private-note-source.html",
  }), /missing or unsupported fields/);
  assert.throws(() => buildNotePublishManifest(input({ deployContentId: "a".repeat(64) })), /sha256:/);
  assert.throws(() => buildNotePublishManifest(input({ browserProofId: `sha256:${"A".repeat(64)}` })), /sha256:/);
  assert.throws(() => buildNotePublishManifest(input({ generatedAt: "August 27" })), /canonical ISO-8601/);
  assert.throws(() => buildNotePublishManifest(input({
    platformDecisions: platforms({ netlifyDrop: { status: "review", reasons: ["C:\\Users\\Alice\\secret"] } }),
  })), /unsupported reason code/);
  assert.throws(() => buildNotePublishManifest(input({
    platformDecisions: platforms({ netlifyDrop: { status: "pass", reasons: ["netlify-file-recommendation"] } }),
  })), /cannot attach reasons to a pass/);
  assert.throws(() => buildNotePublishManifest(input({ status: "ready", findingsSummary: findings({ warnings: 1 }) })), /ready status contradicts/);
  assert.throws(() => buildNotePublishManifest(input({ status: "warnings", findingsSummary: findings() })), /warnings status contradicts/);
  assert.throws(() => buildNotePublishManifest(input({ status: "browser-proof-required" })), /browser-proof-required status contradicts/);
  assert.throws(() => buildNotePublishManifest(input({ status: "working-copy", browserProofId: null })), /working-copy status requires/);
});

test("rendering refuses altered manifests instead of presenting stale or injected proof", () => {
  const manifest = buildNotePublishManifest(input());
  const changedStatus = structuredClone(manifest);
  changedStatus.status = "warnings";
  assert.throws(() => renderNotePublishReport(changedStatus), /contradicts|altered public fields/);

  const changedBoundary = structuredClone(manifest);
  changedBoundary.boundaries.automaticDeployment = true;
  assert.throws(() => renderNotePublishReport(changedBoundary), /unsupported or altered public fields/);

  const changedId = structuredClone(manifest);
  changedId.manifestId = `sha256:${"c".repeat(64)}`;
  assert.throws(() => renderNotePublishReport(changedId), /manifest ID does not match/);

  const injected = structuredClone(manifest);
  injected.sourceText = "private-note-source";
  assert.throws(() => renderNotePublishReport(injected), /unsupported or altered public fields/);
});

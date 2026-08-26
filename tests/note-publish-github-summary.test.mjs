import assert from "node:assert/strict";
import test from "node:test";

import { buildNotePublishGitHubSummary } from "../realitycheck/scripts/note-publish-github-summary.mjs";

const id = (character) => `sha256:${character.repeat(64)}`;

function receipt(overrides = {}) {
  return {
    kind: "html-note-publish-receipt",
    status: "ready",
    publishReady: true,
    archive: { filename: "research-notes.realitycheck-publish.zip", sha256: "a".repeat(64) },
    deployContentId: id("b"),
    finalArchiveBrowserProofPassed: true,
    platformDecisions: {
      netlifyDrop: { status: "pass", reasons: [] },
      cloudflarePagesDirectUpload: { status: "review", reasons: ["cloudflare-direct-upload-cannot-switch-to-git"] },
      githubPages: { status: "review", reasons: ["github-pages-zip-requires-extraction-or-action"] },
    },
    ...overrides,
  };
}

const manifest = {
  kind: "html-note-publish-proof",
  manifestId: id("c"),
  findingsSummary: { errors: 0, warnings: 0, advice: 0, unverified: 0 },
};

test("publish Job Summary leads with the decision, identities, hosts, and full-artifact privacy boundary", () => {
  const output = buildNotePublishGitHubSummary(receipt(), manifest, { language: "en", artifactUpload: true });
  assert.match(output, /READY TO UPLOAD/);
  assert.match(output, /research-notes\.realitycheck-publish\.zip/);
  assert.match(output, /Container SHA-256/);
  assert.match(output, /Final-ZIP browser proof: \*\*PASS\*\*/);
  assert.match(output, /Cloudflare Pages Direct Upload \| \*\*REVIEW\*\*/);
  assert.match(output, /complete HTML, images, styles, and attachments/);
  assert.match(output, /did not deploy/);
  assert.doesNotMatch(output, /C:\\Users|browserProofError|source text/i);
});

test("publish Job Summary localizes a working copy and distinguishes disabled artifact upload", () => {
  const output = buildNotePublishGitHubSummary(receipt({
    status: "working-copy",
    publishReady: false,
    archive: { filename: "notes.realitycheck-working-copy.zip", sha256: "d".repeat(64) },
    finalArchiveBrowserProofPassed: false,
    platformDecisions: {
      netlifyDrop: { status: "block", reasons: ["required-gate-failed"] },
      cloudflarePagesDirectUpload: { status: "block", reasons: ["required-gate-failed", "cloudflare-direct-upload-cannot-switch-to-git"] },
      githubPages: { status: "block", reasons: ["required-gate-failed", "github-pages-zip-requires-extraction-or-action"] },
    },
  }), { ...manifest, findingsSummary: { errors: 1, warnings: 0, advice: 0, unverified: 1 } }, { language: "zh-CN", artifactUpload: false });
  assert.match(output, /仅限工作副本/);
  assert.match(output, /当前文件只能用于修复与复检/);
  assert.match(output, /1 错误/);
  assert.match(output, /未请求上传 GitHub Artifact/);
  assert.match(output, /需把 ZIP 解压到发布源/);
});

test("publish Job Summary rejects unsupported receipt and platform states", () => {
  assert.throws(() => buildNotePublishGitHubSummary({}, manifest), /receipt/);
  assert.throws(() => buildNotePublishGitHubSummary(receipt({ status: "unknown" }), manifest), /receipt/);
  assert.throws(() => buildNotePublishGitHubSummary(receipt({ platformDecisions: { ...receipt().platformDecisions, netlifyDrop: { status: "maybe", reasons: [] } } }), manifest), /Unsupported platform/);
});

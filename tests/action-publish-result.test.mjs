import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";

import { run, validateActionPublishResult } from "../realitycheck/scripts/action-publish-result.mjs";
import { runNotePublishCommand } from "../realitycheck/scripts/note-publish.mjs";

const healthy = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pipeline handoff</title></head><body><main><h1 id="start">Pipeline handoff</h1><p>This complete passive HTML note has enough useful text for a deterministic publish-result contract and exact artifact handoff.</p><a href="#start">Return to start</a></main></body></html>';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-action-publish-result-"));
  const workspace = join(root, "workspace");
  const input = join(workspace, "export");
  const output = join(workspace, ".realitycheck", "publish");
  const result = join(root, "command-result.json");
  mkdirSync(input, { recursive: true });
  writeFileSync(join(input, "index.html"), healthy, "utf8");
  return { root, workspace, input, output, result, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function observer(entry) {
  return {
    serverRequestCount: 0,
    serverRequests: [],
    coverageTruncated: false,
    consoleTotal: 0,
    consoleByType: {},
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    httpErrors: [],
    unexpectedRequests: [],
    responseVerificationErrors: [],
    responseProof: [{ path: entry.path, bytes: entry.size, sha256: entry.sha256 }],
    popups: 0,
    dialogs: 0,
    downloads: 0,
    workers: 0,
    websockets: 0,
    truncatedKinds: [],
  };
}

function validBrowserStub({ failCall = null } = {}) {
  let calls = 0;
  return async ({ archive, manifest, deployManifestEntries, deployContentId, entrypoint, outputDirectory }) => {
    calls += 1;
    mkdirSync(outputDirectory, { recursive: true });
    const screenshotBytes = Buffer.from("bounded-test-png");
    const screenshotSha = createHash("sha256").update(screenshotBytes).digest("hex");
    for (const name of ["desktop.png", "mobile.png"]) writeFileSync(join(outputDirectory, name), screenshotBytes);
    const entry = deployManifestEntries.find((item) => item.path === entrypoint);
    const common = observer(entry);
    const measurement = { titleLength: 16, textLength: 120, scrollWidth: 800, clientWidth: 800, scrollHeight: 600, elementCount: 12, finalPath: "/", finalHash: "" };
    const page = (id, mount, source, width, height) => ({
      id, status: "passed", viewport: { width, height }, source, mount, navigationError: null,
      measurement: { ...measurement, finalPath: mount }, overflow: false, ...structuredClone(common),
    });
    const proof = {
      schemaVersion: "1",
      kind: "html-note-publish-browser-proof",
      profile: "passive-static-v1",
      deploy: {
        contentId: deployContentId,
        entrypoint,
        files: deployManifestEntries.length,
        bytes: deployManifestEntries.reduce((sum, item) => sum + item.size, 0),
        contract: "realitycheck-publish-deploy-content-v1",
      },
      browser: { name: "Chromium", version: "1.0" },
      safety: {
        javaScriptEnabled: false,
        serviceWorkers: "block",
        downloadsAccepted: false,
        externalRequestsAllowed: false,
        businessActionsActivated: false,
        offlineMeaning: "browser-offline-exact-package-replay",
      },
      archive: {
        bytes: archive.byteLength,
        sha256: createHash("sha256").update(archive).digest("hex"),
        manifestFiles: manifest.entries.length,
      },
      limits: {
        maxHtmlFiles: 200, maxFragments: 500, maxLinksPerHtml: 1000, maxTotalLinks: 5000,
        maxEventRecords: 100, maxRequestRecords: 2000, maxResponseBodies: 1000,
        maxRecordedTextCharacters: 300, maxRecordedPathCharacters: 500,
      },
      scenarios: [
        page("desktop-root", "/", "loopback-exact-bytes", 1440, 900),
        page("mobile-375-root", "/", "loopback-exact-bytes", 375, 812),
        page("desktop-project-mount", "/project/", "loopback-exact-bytes", 1440, 900),
        page("mobile-375-project-mount", "/project/", "loopback-exact-bytes", 375, 812),
        page("offline-exact-replay", "/offline/", "offline-exact-replay", 1280, 800),
        { id: "local-pages-and-fragments", status: "passed", source: "loopback-exact-bytes", mount: "/project/", htmlFiles: 1, totalLinks: 1, fragments: 1, failures: [], ...structuredClone(common) },
      ],
      screenshots: [
        { role: "desktop", path: "desktop.png", bytes: screenshotBytes.byteLength, sha256: screenshotSha },
        { role: "mobile", path: "mobile.png", bytes: screenshotBytes.byteLength, sha256: screenshotSha },
      ],
      evidenceTruncated: false,
      passed: true,
    };
    if (calls === failCall) {
      proof.scenarios[0].status = "failed";
      proof.scenarios[0].navigationError = "bounded final-archive failure";
      proof.passed = false;
    }
    writeFileSync(join(outputDirectory, "browser-proof.json"), `${JSON.stringify(proof, null, 2)}\n`, "utf8");
    return { proof };
  };
}

async function publish(item, { ready = false } = {}) {
  const args = [item.input, "--output", item.output, "--result-json", item.result, "--language", "en"];
  if (!ready) args.push("--static-only");
  const exitCode = await runNotePublishCommand(args, ready ? { runBrowserProof: validBrowserStub() } : {});
  return { exitCode, result: JSON.parse(readFileSync(item.result, "utf8")) };
}

test("Action parser accepts an exit-1 working copy, emits only working-copy outputs, and itself exits zero", async () => {
  const item = fixture();
  try {
    const published = await publish(item);
    assert.equal(published.exitCode, 1);
    const validated = validateActionPublishResult({ resultPath: item.result, outputRoot: item.output, workspace: item.workspace });
    assert.equal(validated.outputs["result-valid"], "true");
    assert.equal(validated.outputs["exit-code"], "1");
    assert.equal(validated.outputs["publish-ready"], "false");
    assert.ok(validated.outputs["working-copy-path"]);
    assert.equal(Object.hasOwn(validated.outputs, "archive-path"), false);
    assert.equal(validated.outputs["artifact-path"], published.result.runDirectory);
    assert.equal(validated.outputs["report-json-path"], validated.outputs["receipt-path"]);
    assert.equal(validated.validations.every((result) => result.valid), true);

    const githubOutput = join(item.root, "github-output.txt");
    writeFileSync(githubOutput, "", "utf8");
    assert.equal(run(["--result", item.result, "--output-root", item.output, "--workspace", item.workspace, "--github-output", githubOutput]), 0);
    const emitted = readFileSync(githubOutput, "utf8");
    assert.match(emitted, /^result-valid=true$/m);
    assert.match(emitted, /^exit-code=1$/m);
    assert.match(emitted, /^working-copy-path=/m);
    assert.doesNotMatch(emitted, /^archive-path=/m);

    const cli = spawnSync(process.execPath, [
      join(process.cwd(), "realitycheck", "scripts", "action-publish-result.mjs"),
      "--result", item.result, "--output-root", item.output, "--workspace", item.workspace,
    ], { encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /^exit-code=1$/m);
  } finally { item.cleanup(); }
});

test("Action parser accepts a fully bound exit-0 capsule and emits only archive outputs", async () => {
  const item = fixture();
  try {
    const published = await publish(item, { ready: true });
    assert.equal(published.exitCode, 0);
    const validated = validateActionPublishResult({ resultPath: item.result, outputRoot: item.output, workspace: item.workspace });
    assert.equal(validated.outputs["exit-code"], "0");
    assert.equal(validated.outputs["publish-ready"], "true");
    assert.ok(validated.outputs["archive-path"]);
    assert.ok(validated.outputs["browser-proof-path"]);
    assert.equal(Object.hasOwn(validated.outputs, "working-copy-path"), false);
    assert.equal(validated.outputs["archive-sha256"], published.result.archiveSha256);
  } finally { item.cleanup(); }
});

test("a failed final proof is preserved as diagnostic evidence without claiming it binds the rebuilt working copy", async () => {
  const item = fixture();
  try {
    const args = [item.input, "--output", item.output, "--result-json", item.result, "--language", "en"];
    const exitCode = await runNotePublishCommand(args, { runBrowserProof: validBrowserStub({ failCall: 2 }) });
    assert.equal(exitCode, 1);
    const result = JSON.parse(readFileSync(item.result, "utf8"));
    assert.equal(result.publishReady, false);
    assert.match(result.artifacts.browserProof, /browser-failed-final-attempt[\\/]browser-proof\.json$/);
    assert.equal(existsSync(join(result.runDirectory, "browser-final-archive", "browser-proof.json")), false);
    const validated = validateActionPublishResult({ resultPath: item.result, outputRoot: item.output, workspace: item.workspace });
    assert.equal(validated.outputs["exit-code"], "1");
    assert.ok(validated.outputs["working-copy-path"]);
    const receipt = JSON.parse(readFileSync(result.artifacts.receipt, "utf8"));
    assert.equal(receipt.finalArchiveBrowserProofId, null);
    assert.equal(receipt.finalArchiveBrowserProofPassed, false);
    assert.match(receipt.browserProofError, /did not pass/);
  } finally { item.cleanup(); }
});

test("a failed initial deploy proof stays diagnostic and is not exposed as final-archive proof", async () => {
  const item = fixture();
  try {
    const args = [item.input, "--output", item.output, "--result-json", item.result, "--language", "en"];
    const exitCode = await runNotePublishCommand(args, { runBrowserProof: validBrowserStub({ failCall: 1 }) });
    assert.equal(exitCode, 1);
    const result = JSON.parse(readFileSync(item.result, "utf8"));
    assert.equal(result.status, "working-copy");
    assert.equal(result.artifacts.browserProof, null);
    assert.equal(existsSync(join(result.runDirectory, "browser-deploy-content", "browser-proof.json")), true);
    const validated = validateActionPublishResult({ resultPath: item.result, outputRoot: item.output, workspace: item.workspace });
    assert.equal(Object.hasOwn(validated.outputs, "browser-proof-path"), false);
    assert.ok(validated.outputs["working-copy-path"]);
    const mislabeled = join(item.root, "mislabeled-provisional-proof.json");
    writeFileSync(mislabeled, `${JSON.stringify({
      ...result,
      artifacts: { ...result.artifacts, browserProof: join(result.runDirectory, "browser-deploy-content", "browser-proof.json") },
    }, null, 2)}\n`, "utf8");
    assert.throws(
      () => validateActionPublishResult({ resultPath: mislabeled, outputRoot: item.output, workspace: item.workspace }),
      /failed-final-attempt browser proof/,
    );
    const receipt = JSON.parse(readFileSync(result.artifacts.receipt, "utf8"));
    assert.equal(receipt.finalArchiveBrowserProofId, null);
    assert.equal(receipt.finalArchiveBrowserProofPassed, false);
    assert.match(receipt.browserProofError, /Initial deploy-content browser proof did not pass/);
  } finally { item.cleanup(); }
});

test("Action parser rejects escaped paths, result files inside output, and identity tampering", async () => {
  const item = fixture();
  try {
    const { result } = await publish(item);
    const outside = join(item.workspace, "outside.html");
    writeFileSync(outside, "outside", "utf8");
    const escapedPath = join(item.root, "escaped.json");
    writeFileSync(escapedPath, `${JSON.stringify({ ...result, artifacts: { ...result.artifacts, report: outside } }, null, 2)}\n`, "utf8");
    assert.throws(
      () => validateActionPublishResult({ resultPath: escapedPath, outputRoot: item.output, workspace: item.workspace }),
      /escaped the publish run directory/,
    );

    const tamperedPath = join(item.root, "tampered.json");
    writeFileSync(tamperedPath, `${JSON.stringify({ ...result, archiveSha256: "0".repeat(64) }, null, 2)}\n`, "utf8");
    assert.throws(
      () => validateActionPublishResult({ resultPath: tamperedPath, outputRoot: item.output, workspace: item.workspace }),
      /SHA-256 differs/,
    );

    const inside = join(result.runDirectory, "command-result.json");
    writeFileSync(inside, readFileSync(item.result));
    assert.throws(
      () => validateActionPublishResult({ resultPath: inside, outputRoot: item.output, workspace: item.workspace }),
      /must stay outside the uploaded output root/,
    );
  } finally { item.cleanup(); }
});

test("Action parser rejects symlinked result and artifact paths when supported", async (context) => {
  const item = fixture();
  try {
    const { result } = await publish(item);
    const linkedResult = join(item.root, "linked-result.json");
    const linkedReport = join(result.runDirectory, "linked-report.html");
    try {
      symlinkSync(item.result, linkedResult, "file");
      symlinkSync(result.artifacts.report, linkedReport, "file");
    } catch {
      context.skip("symbolic-link creation is unavailable");
      return;
    }
    assert.throws(
      () => validateActionPublishResult({ resultPath: linkedResult, outputRoot: item.output, workspace: item.workspace }),
      /must not be a symbolic link/,
    );
    const alternate = join(item.root, "linked-artifact.json");
    writeFileSync(alternate, `${JSON.stringify({ ...result, artifacts: { ...result.artifacts, report: linkedReport } }, null, 2)}\n`, "utf8");
    assert.throws(
      () => validateActionPublishResult({ resultPath: alternate, outputRoot: item.output, workspace: item.workspace }),
      /symbolic link/,
    );
    assert.throws(
      () => validateActionPublishResult({ resultPath: item.result, outputRoot: item.output, workspace: item.workspace }),
      /contains a symbolic link/,
      "an undeclared symlink must not ride along in the exact uploaded run directory",
    );
  } finally { item.cleanup(); }
});

test("Action parser validates only the exact command result instead of selecting a newer-looking directory", async () => {
  const item = fixture();
  try {
    const { result } = await publish(item);
    const decoy = join(item.output, "99999999T999999Z-decoy");
    mkdirSync(decoy);
    writeFileSync(join(decoy, "publish.zip"), "decoy", "utf8");
    const validated = validateActionPublishResult({ resultPath: item.result, outputRoot: item.output, workspace: item.workspace });
    assert.equal(validated.outputs["artifact-path"], result.runDirectory);
    assert.notEqual(validated.outputs["artifact-path"], decoy);
    assert.equal(existsSync(join(validated.outputs["artifact-path"], "publish.zip")), false);
    assert.equal(relative(item.output, validated.outputs["artifact-path"]).startsWith(".."), false);
  } finally { item.cleanup(); }
});

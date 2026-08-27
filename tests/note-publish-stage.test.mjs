import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";

import { runNotePublishCommand } from "../realitycheck/scripts/note-publish.mjs";
import { stageVerifiedPublishCapsule } from "../realitycheck/scripts/note-publish-stage.mjs";
import { readStoredZipEntries } from "../realitycheck/scripts/note-zip.mjs";
import { validateArtifactFiles } from "../realitycheck/scripts/artifact-validator.mjs";

function inputFixture(root) {
  const input = join(root, "export");
  mkdirSync(join(input, "nested"), { recursive: true });
  mkdirSync(join(input, "assets"));
  mkdirSync(join(input, ".well-known"));
  writeFileSync(join(input, "index.html"), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verified stage fixture</title></head><body><main><h1 id="start">Verified stage fixture</h1><p>This passive static note contains enough meaningful content to prove exact materialization of a browser-verified publish capsule.</p><a href="nested/Guide Page.html#method">Read the method</a></main></body></html>', "utf8");
  writeFileSync(join(input, "nested", "Guide Page.html"), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verified staging method</title></head><body><main><h1 id="method">Verified staging method</h1><p>The staged site must preserve Unicode, spaces, nested pages, hidden public files, and every exact archive byte.</p><a href="../index.html#start">Return home</a></main></body></html>', "utf8");
  writeFileSync(join(input, "assets", "图 表.txt"), "unicode asset bytes\n", "utf8");
  writeFileSync(join(input, ".well-known", "security.txt"), "Contact: mailto:security@example.invalid\n", "utf8");
  return input;
}

function observer(entry) {
  return {
    serverRequestCount: 0, serverRequests: [], coverageTruncated: false, consoleTotal: 0, consoleByType: {},
    consoleErrors: [], pageErrors: [], requestFailures: [], httpErrors: [], unexpectedRequests: [], responseVerificationErrors: [],
    responseProof: [{ path: entry.path, bytes: entry.size, sha256: entry.sha256 }],
    popups: 0, dialogs: 0, downloads: 0, workers: 0, websockets: 0, truncatedKinds: [],
  };
}

function validBrowserStub() {
  return async ({ archive, manifest, deployManifestEntries, deployContentId, entrypoint, outputDirectory }) => {
    mkdirSync(outputDirectory, { recursive: true });
    const image = Buffer.from("stage-proof-png");
    const imageSha = createHash("sha256").update(image).digest("hex");
    writeFileSync(join(outputDirectory, "desktop.png"), image);
    writeFileSync(join(outputDirectory, "mobile.png"), image);
    const entry = deployManifestEntries.find((item) => item.path === entrypoint);
    const common = observer(entry);
    const measurement = { titleLength: 15, textLength: 120, scrollWidth: 800, clientWidth: 800, scrollHeight: 600, elementCount: 12, finalPath: "/", finalHash: "" };
    const page = (id, mount, source, width, height) => ({
      id, status: "passed", viewport: { width, height }, source, mount, navigationError: null,
      measurement: { ...measurement, finalPath: mount }, overflow: false, ...structuredClone(common),
    });
    const proof = {
      schemaVersion: "1", kind: "html-note-publish-browser-proof", profile: "passive-static-v1",
      deploy: {
        contentId: deployContentId, entrypoint, files: deployManifestEntries.length,
        bytes: deployManifestEntries.reduce((sum, item) => sum + item.size, 0), contract: "realitycheck-publish-deploy-content-v1",
      },
      browser: { name: "Chromium", version: "1.0" },
      safety: {
        javaScriptEnabled: false, serviceWorkers: "block", downloadsAccepted: false, externalRequestsAllowed: false,
        businessActionsActivated: false, offlineMeaning: "browser-offline-exact-package-replay",
      },
      archive: { bytes: archive.byteLength, sha256: createHash("sha256").update(archive).digest("hex"), manifestFiles: manifest.entries.length },
      limits: {
        maxHtmlFiles: 200, maxFragments: 500, maxLinksPerHtml: 1000, maxTotalLinks: 5000, maxEventRecords: 100,
        maxRequestRecords: 2000, maxResponseBodies: 1000, maxRecordedTextCharacters: 300, maxRecordedPathCharacters: 500,
      },
      scenarios: [
        page("desktop-root", "/", "loopback-exact-bytes", 1440, 900),
        page("mobile-375-root", "/", "loopback-exact-bytes", 375, 812),
        page("desktop-project-mount", "/project/", "loopback-exact-bytes", 1440, 900),
        page("mobile-375-project-mount", "/project/", "loopback-exact-bytes", 375, 812),
        page("offline-exact-replay", "/offline/", "offline-exact-replay", 1280, 800),
        { id: "local-pages-and-fragments", status: "passed", source: "loopback-exact-bytes", mount: "/project/", htmlFiles: 2, totalLinks: 2, fragments: 2, failures: [], ...structuredClone(common) },
      ],
      screenshots: [
        { role: "desktop", path: "desktop.png", bytes: image.byteLength, sha256: imageSha },
        { role: "mobile", path: "mobile.png", bytes: image.byteLength, sha256: imageSha },
      ],
      evidenceTruncated: false,
      passed: true,
    };
    writeFileSync(join(outputDirectory, "browser-proof.json"), `${JSON.stringify(proof, null, 2)}\n`, "utf8");
    return { proof };
  };
}

async function publishFixture({ ready = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-publish-stage-"));
  const input = inputFixture(root);
  const output = join(root, "publish");
  const args = [input, "--output", output, "--language", "en"];
  if (!ready) args.push("--static-only");
  const exitCode = await runNotePublishCommand(args, ready ? { runBrowserProof: validBrowserStub() } : {});
  const run = join(output, readdirSync(output, { withFileTypes: true }).find((entry) => entry.isDirectory()).name);
  const names = readdirSync(run);
  return {
    root, input, output, run, exitCode,
    archive: join(run, names.find((name) => name.endsWith(".zip"))),
    receipt: join(run, names.find((name) => name.endsWith(".receipt.json"))),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function diskFiles(root) {
  const files = new Map();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else files.set(relative(root, fullPath).replaceAll("\\", "/"), readFileSync(fullPath));
    }
  };
  visit(root);
  return files;
}

test("publish-ready run stages every ZIP entry byte-for-byte and returns a source-free receipt", async () => {
  const item = await publishFixture();
  try {
    assert.equal(item.exitCode, 0);
    const destination = join(item.root, "pages site");
    const receipt = await stageVerifiedPublishCapsule(item.run, destination, { now: () => new Date("2026-08-27T00:00:00.000Z") });
    assert.equal(receipt.kind, "html-note-publish-stage-receipt");
    assert.equal(receipt.status, "ready-for-static-host-artifact");
    assert.equal(receipt.generatedAt, "2026-08-27T00:00:00.000Z");
    assert.equal(receipt.checks.byteForByte, true);
    assert.equal(receipt.boundaries.receiptWrittenIntoSite, false);
    assert.match(receipt.stage.contentId, /^sha256:[a-f0-9]{64}$/);
    const archive = await readStoredZipEntries(new Uint8Array(readFileSync(item.archive)));
    const staged = diskFiles(destination);
    assert.equal(staged.size, archive.entries.size);
    for (const [path, bytes] of archive.entries) assert.deepEqual(staged.get(path), Buffer.from(bytes), path);
    for (const path of ["index.html", "404.html", ".nojekyll", ".well-known/security.txt", "assets/图 表.txt", "nested/Guide Page.html", "realitycheck-proof/manifest.json"]) {
      assert.equal(staged.has(path), true, path);
      assert.equal(lstatSync(join(destination, ...path.split("/"))).isFile(), true, path);
    }
    assert.equal([...staged.keys()].some((path) => /stage-receipt/i.test(path)), false);

    const receiptPath = join(item.root, "site.realitycheck-stage.receipt.json");
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    let [validation] = validateArtifactFiles([receiptPath]);
    assert.equal(validation.kind, "html-note-publish-stage-receipt");
    assert.equal(validation.valid, true, validation.errors.join("\n"));
    const tamperedReceipt = structuredClone(receipt);
    tamperedReceipt.stage.contentId = `sha256:${"0".repeat(64)}`;
    writeFileSync(receiptPath, `${JSON.stringify(tamperedReceipt, null, 2)}\n`, "utf8");
    [validation] = validateArtifactFiles([receiptPath]);
    assert.equal(validation.valid, false);
    assert.match(validation.errors.join("\n"), /contentId/);

    const secondDestination = join(item.root, "explicit source stage");
    const explicit = await stageVerifiedPublishCapsule({ receiptPath: item.receipt, archivePath: item.archive }, secondDestination);
    assert.equal(explicit.stage.contentId, receipt.stage.contentId);
    assert.deepEqual([...diskFiles(secondDestination).keys()].sort(), [...staged.keys()].sort());
  } finally { item.cleanup(); }
});

test("working copies are refused without creating a destination", async () => {
  const item = await publishFixture({ ready: false });
  try {
    assert.equal(item.exitCode, 1);
    const destination = join(item.root, "must-not-exist");
    await assert.rejects(stageVerifiedPublishCapsule(item.run, destination), /working copy, not a publish-ready capsule/);
    assert.equal(existsSync(destination), false);
  } finally { item.cleanup(); }
});

test("tampered archives and missing final proof are refused before staging", async () => {
  const tampered = await publishFixture();
  try {
    const bytes = readFileSync(tampered.archive);
    bytes[Math.min(80, bytes.length - 1)] ^= 0xff;
    writeFileSync(tampered.archive, bytes);
    const destination = join(tampered.root, "tampered-stage");
    await assert.rejects(stageVerifiedPublishCapsule(tampered.run, destination), /failed validation|sha256|readback/i);
    assert.equal(existsSync(destination), false);
  } finally { tampered.cleanup(); }

  const missing = await publishFixture();
  try {
    rmSync(join(missing.run, "browser-final-archive", "browser-proof.json"));
    const destination = join(missing.root, "missing-proof-stage");
    await assert.rejects(stageVerifiedPublishCapsule(missing.run, destination), /failed validation|browser proof sibling is missing/i);
    assert.equal(existsSync(destination), false);
  } finally { missing.cleanup(); }
});

test("existing and overlapping destinations are refused without changing their contents", async () => {
  const item = await publishFixture();
  try {
    const existing = join(item.root, "existing");
    mkdirSync(existing);
    writeFileSync(join(existing, "owner.txt"), "owner", "utf8");
    await assert.rejects(stageVerifiedPublishCapsule(item.run, existing), /already exists/);
    assert.equal(readFileSync(join(existing, "owner.txt"), "utf8"), "owner");

    const insideRun = join(item.run, "stage");
    await assert.rejects(stageVerifiedPublishCapsule(item.run, insideRun), /separate from the publish evidence run/);
    assert.equal(existsSync(insideRun), false);
  } finally { item.cleanup(); }
});

test("symlinked source, destination, and destination ancestors are refused when supported", async (context) => {
  const item = await publishFixture();
  try {
    const outside = join(item.root, "outside");
    mkdirSync(outside);
    const runLink = join(item.root, "run-link");
    const destinationLink = join(item.root, "destination-link");
    const parentLink = join(item.root, "parent-link");
    try {
      symlinkSync(item.run, runLink, "dir");
      symlinkSync(outside, destinationLink, "dir");
      symlinkSync(outside, parentLink, "dir");
    } catch {
      context.skip("symbolic-link creation is unavailable");
      return;
    }
    await assert.rejects(stageVerifiedPublishCapsule(runLink, join(item.root, "unused")), /symbolic link/);
    await assert.rejects(stageVerifiedPublishCapsule(item.run, destinationLink), /already exists|symbolic link/);
    await assert.rejects(stageVerifiedPublishCapsule(item.run, join(parentLink, "site")), /symbolic link|symbolic-link/);
    assert.deepEqual(readdirSync(outside), []);
  } finally { item.cleanup(); }
});

test("injected write and rename failures remove temporary trees, locks, and partial destinations", async () => {
  const item = await publishFixture();
  try {
    const before = new Set(readdirSync(item.root));
    const writeDestination = join(item.root, "write-failure");
    let writes = 0;
    await assert.rejects(stageVerifiedPublishCapsule(item.run, writeDestination, {
      operations: {
        writeFileSync(path, bytes, options) {
          writes += 1;
          if (writes === 2) throw new Error("injected write failure");
          return writeFileSync(path, bytes, options);
        },
      },
    }), /injected write failure/);
    assert.equal(existsSync(writeDestination), false);

    const renameDestination = join(item.root, "rename-failure");
    await assert.rejects(stageVerifiedPublishCapsule(item.run, renameDestination, {
      operations: { renameSync() { throw new Error("injected rename failure"); } },
    }), /injected rename failure/);
    assert.equal(existsSync(renameDestination), false);
    assert.deepEqual(new Set(readdirSync(item.root)), before);

    const successDestination = join(item.root, "atomic-success");
    let destinationVisibleDuringWrites = false;
    await stageVerifiedPublishCapsule(item.run, successDestination, {
      operations: {
        writeFileSync(path, bytes, options) {
          destinationVisibleDuringWrites ||= existsSync(successDestination);
          return writeFileSync(path, bytes, options);
        },
        renameSync,
      },
    });
    assert.equal(destinationVisibleDuringWrites, false);
    assert.equal(existsSync(successDestination), true);
  } finally { item.cleanup(); }
});

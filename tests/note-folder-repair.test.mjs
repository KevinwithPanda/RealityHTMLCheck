import assert from "node:assert/strict";
import test from "node:test";

import { analyzeHtmlNote, applySafeNoteFixes, buildRepairTask, normalizeNotePath } from "../realitycheck/scripts/note-analyzer.mjs";
import { analyzeNotePackage } from "../realitycheck/scripts/note-package.mjs";
import { buildPackageRepairTask, noteDecision, summarizeNoteReports, summarizePackageFindings } from "../realitycheck/scripts/note-summary.mjs";
import { bindSafeFolderCandidate, buildVerifiedFolderRepairZip, FOLDER_REPAIR_LIMITS, prepareFolderRepairInventory } from "../site/note-folder-repair.mjs";
import { analyzeBrowserNoteSources, verifySafeNotePackageRepair } from "../site/note-repair-verification.mjs";
import { buildPortableNoteReport } from "../site/note-share-report.mjs";

const helpers = { analyzeHtmlNote, applySafeNoteFixes, analyzeNotePackage, summarizeNoteReports, summarizePackageFindings, normalizeNotePath };
const decoder = new TextDecoder();

function parseStoreEntries(blob) {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const eocd = bytes.byteLength - 22;
    const count = view.getUint16(eocd + 10, true);
    let cursor = view.getUint32(eocd + 16, true);
    const entries = new Map();
    for (let index = 0; index < count; index += 1) {
      assert.equal(view.getUint32(cursor, true), 0x02014b50);
      const size = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const localOffset = view.getUint32(cursor + 42, true);
      const path = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      const localNameLength = view.getUint16(localOffset + 26, true);
      const dataStart = localOffset + 30 + localNameLength;
      entries.set(path, bytes.slice(dataStart, dataStart + size));
      cursor += 46 + nameLength;
    }
    return entries;
  });
}

test("folder ZIP includes every selected byte, cumulative repaired HTML, and local proof", async () => {
  const draft = '<html><head><title>Folder draft</title><link rel="stylesheet" href="assets/theme.css"></head><body><h1>Folder draft</h1><p>This selected folder note proves that safe metadata repairs and binary assets stay in one portable hierarchy.</p><img src="../notes/assets/chart.svg" alt="Chart"></body></html>';
  const clean = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Clean note</title></head><body><h1>Clean note</h1><p>This sibling remains byte-for-byte unchanged in the repaired folder.</p></body></html>';
  const css = new TextEncoder().encode("body{max-width:70rem}\n");
  const image = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
  const selected = [
    { path: "notes/draft.html", file: new File([draft], "draft.html", { type: "text/html" }) },
    { path: "notes/clean.html", file: new File([clean], "clean.html", { type: "text/html" }) },
    { path: "notes/assets/theme.css", file: new File([css], "theme.css", { type: "text/css" }) },
    { path: "notes/assets/chart.svg", file: new File([image], "chart.svg", { type: "image/svg+xml" }) },
  ];
  const inventory = await prepareFolderRepairInventory(selected, { normalizeNotePath });
  assert.equal(inventory.eligible, true, JSON.stringify(inventory.blockers));
  assert.equal(inventory.repairedRootName, "notes.realitycheck-safe-metadata");
  const analysis = {
    htmlSources: [{ path: "notes/draft.html", html: draft }, { path: "notes/clean.html", html: clean }],
    cssSources: [{ path: "notes/assets/theme.css", text: decoder.decode(css) }],
    knownFiles: selected.map((item) => item.path),
  };
  const before = analyzeBrowserNoteSources(analysis, helpers);
  assert.equal(before.reports.find((report) => report.path === "notes/draft.html").findings.some((finding) => finding.ruleId === "missing-local-file"), false);
  const verification = await bindSafeFolderCandidate(verifySafeNotePackageRepair({ beforeBundle: before, analysis }, helpers));
  const reorderedCandidate = await bindSafeFolderCandidate({
    ...verification,
    candidateHtmlByPath: new Map([...verification.candidateHtmlByPath.entries()].reverse()),
  });
  assert.equal(reorderedCandidate.candidateId, verification.candidateId, "candidate ID must not depend on Map insertion order");
  const changedCleanCandidate = new Map(verification.candidateHtmlByPath);
  changedCleanCandidate.set("notes/clean.html", `${changedCleanCandidate.get("notes/clean.html")}<!-- different clean sibling -->`);
  const changedClean = await bindSafeFolderCandidate({ ...verification, candidateHtmlByPath: changedCleanCandidate });
  assert.notEqual(changedClean.candidateId, verification.candidateId, "unchanged sibling content is part of the cumulative candidate");
  const changedDraftCandidate = new Map(verification.candidateHtmlByPath);
  changedDraftCandidate.set("notes/draft.html", `${changedDraftCandidate.get("notes/draft.html")}<!-- different repaired body -->`);
  const changedDraft = await bindSafeFolderCandidate({ ...verification, candidateHtmlByPath: changedDraftCandidate });
  assert.notEqual(changedDraft.candidateId, verification.candidateId, "repaired HTML bytes are part of the cumulative candidate");
  const changedCssCandidate = new Map(verification.candidateCssByPath);
  changedCssCandidate.set("notes/assets/theme.css", "body{max-width:71rem}\n");
  const changedCss = await bindSafeFolderCandidate({ ...verification, candidateCssByPath: changedCssCandidate });
  assert.notEqual(changedCss.candidateId, verification.candidateId, "analyzed CSS text is part of the cumulative candidate");
  for (const candidate of [changedClean, changedCss]) {
    const mismatchedReport = buildPortableNoteReport({ ...candidate.after, generatedAt: "2026-08-27T00:00:00.000Z", reportContext: "folder-candidate", safePackageRepairVerification: candidate }, { buildRepairTask, buildPackageRepairTask, noteDecision });
    await assert.rejects(buildVerifiedFolderRepairZip({
      inventory,
      verification: candidate,
      reportHtml: mismatchedReport,
      generatedAt: "2026-08-27T00:00:00.000Z",
    }), /candidate differs from the selected source|CSS changed after the cumulative analysis/);
  }
  const missingCss = await bindSafeFolderCandidate({ ...verification, candidateCssByPath: new Map() });
  const missingCssReport = buildPortableNoteReport({ ...missingCss.after, generatedAt: "2026-08-27T00:00:00.000Z", reportContext: "folder-candidate", safePackageRepairVerification: missingCss }, { buildRepairTask, buildPackageRepairTask, noteDecision });
  await assert.rejects(buildVerifiedFolderRepairZip({
    inventory,
    verification: missingCss,
    reportHtml: missingCssReport,
    generatedAt: "2026-08-27T00:00:00.000Z",
  }), /CSS candidate differs from the browser-selected CSS scope/);
  const reportHtml = buildPortableNoteReport({ ...verification.after, generatedAt: "2026-08-27T00:00:00.000Z", reportContext: "folder-candidate", safePackageRepairVerification: verification }, { buildRepairTask, buildPackageRepairTask, noteDecision });
  const first = await buildVerifiedFolderRepairZip({ inventory, verification, reportHtml, generatedAt: "2026-08-27T00:00:00.000Z" });
  const second = await buildVerifiedFolderRepairZip({ inventory, verification, reportHtml, generatedAt: "2026-08-27T00:00:00.000Z" });
  const reversedInventory = await prepareFolderRepairInventory([...selected].reverse(), { normalizeNotePath });
  const third = await buildVerifiedFolderRepairZip({ inventory: reversedInventory, verification, reportHtml, generatedAt: "2026-08-27T00:00:00.000Z" });
  assert.equal(first.kind, "html-note-safe-folder-zip");
  assert.equal(first.filename, "notes.realitycheck-safe-metadata.zip");
  assert.equal(first.selectedInventoryIncluded, true);
  assert.equal(first.manifest.files, selected.length + 2);
  assert.deepEqual(new Uint8Array(await first.blob.arrayBuffer()), new Uint8Array(await second.blob.arrayBuffer()));
  assert.deepEqual(new Uint8Array(await first.blob.arrayBuffer()), new Uint8Array(await third.blob.arrayBuffer()));

  const packed = await parseStoreEntries(first.blob);
  assert.deepEqual([...packed.keys()], [
    "notes.realitycheck-safe-metadata/notes/assets/chart.svg",
    "notes.realitycheck-safe-metadata/notes/assets/theme.css",
    "notes.realitycheck-safe-metadata/notes/clean.html",
    "notes.realitycheck-safe-metadata/notes/draft.html",
    "notes.realitycheck-safe-metadata/.realitycheck/repair-proof.json",
    "notes.realitycheck-safe-metadata/.realitycheck/after-report.html",
  ]);
  assert.deepEqual(packed.get("notes.realitycheck-safe-metadata/notes/assets/chart.svg"), image);
  assert.deepEqual(packed.get("notes.realitycheck-safe-metadata/notes/assets/theme.css"), css);
  assert.equal(decoder.decode(packed.get("notes.realitycheck-safe-metadata/notes/clean.html")), clean);
  assert.equal(decoder.decode(packed.get("notes.realitycheck-safe-metadata/notes/draft.html")), verification.repairedHtmlByPath.get("notes/draft.html"));
  assert.equal(decoder.decode(packed.get(first.reportPath)), reportHtml);
  const proof = JSON.parse(decoder.decode(packed.get(first.proofPath)));
  assert.equal(proof.bundlePolicy, "all-browser-selected-files");
  assert.equal(proof.candidateId, verification.candidateId);
  assert.match(proof.candidateId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(proof.archiveBoundary.selectedInventoryIncluded, true);
  assert.equal(proof.archiveBoundary.readBackVerifiedBeforeDownload, true);
  assert.equal(proof.archiveBoundary.remoteResourcesBundled, false);
  assert.equal(proof.repair.changedHtmlFiles, 1);
  assert.equal(proof.selection.inventory.length, selected.length);
  assert.match(proof.selection.inventorySha256, /^[a-f0-9]{64}$/);
  const draftEvidence = proof.selection.inventory.find((item) => item.sourcePath === "notes/draft.html");
  const imageEvidence = proof.selection.inventory.find((item) => item.sourcePath === "notes/assets/chart.svg");
  assert.equal(draftEvidence.transformation, "safe-metadata-utf8");
  assert.notEqual(draftEvidence.sourceSha256, draftEvidence.packedSha256);
  assert.equal(imageEvidence.transformation, "byte-for-byte");
  assert.equal(imageEvidence.sourceSha256, imageEvidence.packedSha256);
  assert.match(imageEvidence.packedCrc32, /^[a-f0-9]{8}$/);
  for (const evidence of proof.selection.inventory) {
    const manifestEntry = first.manifest.entries.find((entry) => entry.path === evidence.archivePath);
    assert.equal(manifestEntry.sha256, evidence.packedSha256);
    assert.equal(manifestEntry.crc32Hex, evidence.packedCrc32);
    assert.equal(manifestEntry.size, evidence.packedBytes);
  }
  assert.doesNotMatch(JSON.stringify(proof), /This selected folder note proves/);
  assert.equal(await selected[0].file.text(), draft);
  assert.deepEqual(new Uint8Array(await selected[3].file.arrayBuffer()), image);
});

test("folder inventory blocks sensitive, non-folder, conflicting, and oversized selections before reads", async () => {
  assert.equal(FOLDER_REPAIR_LIMITS.maxSelectedBytes, 52 * 1024 * 1024);
  assert.equal(FOLDER_REPAIR_LIMITS.maxFileBytes, 32 * 1024 * 1024);
  let reads = 0;
  const file = (size = 1) => ({ size, async arrayBuffer() { reads += 1; return new ArrayBuffer(size); } });
  for (const [entries, code] of [
    [[{ path: "note.html", file: file() }], "missing-folder-root"],
    [[{ path: "notes/.env", file: file() }], "sensitive-path"],
    [[{ path: "notes/secrets.json", file: file() }], "sensitive-path"],
    [[{ path: "notes/auth.yaml", file: file() }], "sensitive-path"],
    [[{ path: "notes/service-account.json", file: file() }], "sensitive-path"],
    [[{ path: "notes/.netrc", file: file() }], "sensitive-path"],
    [[{ path: "notes/.git/config", file: file() }], "sensitive-path"],
    [[{ path: "notes/key.pem", file: file() }], "sensitive-path"],
    [[{ path: "notes/a.html", file: file() }, { path: "other/b.html", file: file() }], "multiple-folder-roots"],
    [[{ path: "notes/a/../b.html", file: file() }], "unsafe-path"],
    [[{ path: "notes/a.html", file: Object.assign(file(), { name: "b.html" }) }], "file-name-mismatch"],
    [[{ path: "notes/CON/file.txt", file: file() }], "zip-path-or-layout"],
    [[{ path: "notes/Index.html", file: file() }, { path: "notes/index.html", file: file() }], "zip-path-or-layout"],
    [[{ path: "notes/large.bin", file: file(33 * 1024 * 1024) }], "file-too-large"],
    [[{ path: `notes/${"a".repeat(1020)}.html`, file: file() }], "path-too-long"],
  ]) {
    const inventory = await prepareFolderRepairInventory(entries, { normalizeNotePath });
    assert.equal(inventory.eligible, false, code);
    assert.equal(inventory.blockers.some((item) => item.code === code), true, JSON.stringify(inventory.blockers));
  }
  const pathHeavy = Array.from({ length: 600 }, (_, index) => ({ path: `notes/${String(index).padStart(3, "0")}-${"p".repeat(880)}.bin`, file: file() }));
  const pathHeavyInventory = await prepareFolderRepairInventory(pathHeavy, { normalizeNotePath });
  assert.equal(pathHeavyInventory.blockers.some((item) => item.code === "paths-too-large"), true);
  assert.equal(reads, 0);
});

test("folder ZIP refuses a verification whose known inventory differs from selected Files", async () => {
  const draft = "<html><head><title>Draft</title></head><body><h1>Draft</h1><p>This draft has enough content for a safe metadata repair.</p></body></html>";
  const selected = [{ path: "notes/draft.html", file: new File([draft], "draft.html") }];
  const inventory = await prepareFolderRepairInventory(selected, { normalizeNotePath });
  const analysis = { htmlSources: [{ path: "notes/draft.html", html: draft }], cssSources: [], knownFiles: ["notes/draft.html"] };
  const before = analyzeBrowserNoteSources(analysis, helpers);
  const verification = await bindSafeFolderCandidate(verifySafeNotePackageRepair({ beforeBundle: before, analysis }, helpers));
  const reportHtml = buildPortableNoteReport({ ...verification.after, generatedAt: "2026-08-27T00:00:00.000Z", reportContext: "folder-candidate", safePackageRepairVerification: verification }, { buildRepairTask, buildPackageRepairTask, noteDecision });
  await assert.rejects(buildVerifiedFolderRepairZip({
    inventory,
    verification,
    reportHtml: "<!doctype html><html><body>unbound report</body></html>",
    generatedAt: "2026-08-27T00:00:00.000Z",
  }), /not bound/);
  const crossCandidate = await bindSafeFolderCandidate({
    ...verification,
    scope: { ...verification.scope, knownFiles: ["notes/different.html"] },
  });
  await assert.rejects(buildVerifiedFolderRepairZip({
    inventory,
    verification: crossCandidate,
    reportHtml,
    generatedAt: "2026-08-27T00:00:00.000Z",
  }), /not bound/);
  const scopeMismatch = await bindSafeFolderCandidate({
    ...verification,
    scope: { ...verification.scope, knownFiles: [...verification.scope.knownFiles, "notes/not-selected.bin"] },
  });
  const scopeMismatchReport = buildPortableNoteReport({ ...scopeMismatch.after, generatedAt: "2026-08-27T00:00:00.000Z", reportContext: "folder-candidate", safePackageRepairVerification: scopeMismatch }, { buildRepairTask, buildPackageRepairTask, noteDecision });
  await assert.rejects(buildVerifiedFolderRepairZip({
    inventory,
    verification: scopeMismatch,
    reportHtml: scopeMismatchReport,
    generatedAt: "2026-08-27T00:00:00.000Z",
  }), /scope differs/);

  const tamperedHtml = new Map(verification.candidateHtmlByPath);
  tamperedHtml.set("notes/draft.html", `${tamperedHtml.get("notes/draft.html")}<!-- changed after binding -->`);
  await assert.rejects(buildVerifiedFolderRepairZip({
    inventory,
    verification: { ...verification, candidateHtmlByPath: tamperedHtml },
    reportHtml,
    generatedAt: "2026-08-27T00:00:00.000Z",
  }), /candidate ID is missing or invalid/);

  const tamperedRepair = new Map(verification.repairedHtmlByPath);
  tamperedRepair.set("notes/draft.html", `${tamperedRepair.get("notes/draft.html")}<!-- packed bytes changed -->`);
  await assert.rejects(buildVerifiedFolderRepairZip({
    inventory,
    verification: { ...verification, repairedHtmlByPath: tamperedRepair },
    reportHtml,
    generatedAt: "2026-08-27T00:00:00.000Z",
  }), /repaired HTML differs from the cumulative candidate/);

  const extraRepair = new Map(verification.repairedHtmlByPath);
  extraRepair.set("notes/clean.html", "<!doctype html><html><body>undeclared replacement</body></html>");
  await assert.rejects(buildVerifiedFolderRepairZip({
    inventory,
    verification: { ...verification, repairedHtmlByPath: extraRepair },
    reportHtml,
    generatedAt: "2026-08-27T00:00:00.000Z",
  }), /repaired HTML set differs from the declared folder changes/);

  await assert.rejects(buildVerifiedFolderRepairZip({
    inventory,
    verification: { ...verification, after: { ...verification.after, summary: { ...verification.after.summary, score: verification.after.summary.score - 1 } } },
    reportHtml,
    generatedAt: "2026-08-27T00:00:00.000Z",
  }), /candidate ID is missing or invalid/);

  await assert.rejects(buildVerifiedFolderRepairZip({
    inventory,
    verification: { ...verification, changes: verification.changes.map((change) => ({ ...change, rules: [...change.rules, "not-a-declared-fix"] })) },
    reportHtml,
    generatedAt: "2026-08-27T00:00:00.000Z",
  }), /candidate ID is missing or invalid/);
});

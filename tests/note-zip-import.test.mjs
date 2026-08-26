import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deflateRawSync } from "node:zlib";

import { analyzeHtmlNote, applySafeNoteFixes, buildRepairTask, normalizeNotePath } from "../realitycheck/scripts/note-analyzer.mjs";
import { analyzeNotePackage } from "../realitycheck/scripts/note-package.mjs";
import { buildPackageRepairTask, noteDecision, summarizeNoteReports, summarizePackageFindings } from "../realitycheck/scripts/note-summary.mjs";
import { bindSafeFolderCandidate, buildVerifiedFolderRepairZip, prepareFolderRepairInventory } from "../site/note-folder-repair.mjs";
import { analyzeBrowserNoteSources, verifySafeNotePackageRepair } from "../site/note-repair-verification.mjs";
import { buildPortableNoteReport } from "../site/note-share-report.mjs";
import { extractHtmlNoteZip, importHtmlNoteZip, ZIP_IMPORT_LIMITS } from "../realitycheck/scripts/note-zip-import.mjs";
import { extractHtmlNoteZipFile, readPortableZipArchive } from "../realitycheck/scripts/note-zip-import-node.mjs";
import * as publishedZipImport from "../realitycheck/scripts/note-zip-import.mjs";
import * as siteZipImport from "../site/note-zip-import.mjs";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const analysisHelpers = { analyzeHtmlNote, applySafeNoteFixes, analyzeNotePackage, summarizeNoteReports, summarizePackageFindings, normalizeNotePath };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    table[value] = crc >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ value) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function extraField(id, data) {
  const bytes = new Uint8Array(4 + data.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, id, true);
  view.setUint16(2, data.byteLength, true);
  bytes.set(data, 4);
  return bytes;
}

function unicodePathExtra(rawName, path) {
  const name = encoder.encode(path);
  const data = new Uint8Array(5 + name.byteLength);
  const view = new DataView(data.buffer);
  data[0] = 1;
  view.setUint32(1, crc32(rawName), true);
  data.set(name, 5);
  return extraField(0x7075, data);
}

function concat(parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function buildZip(definitions, { comment = "", trailing = new Uint8Array() } = {}) {
  const locals = [];
  const central = [];
  let localOffset = 0;
  for (const definition of definitions) {
    const content = definition.bytes instanceof Uint8Array ? definition.bytes : encoder.encode(definition.bytes ?? "");
    const rawName = definition.rawName || encoder.encode(definition.path);
    const localName = definition.localName || rawName;
    const flags = definition.flags ?? 0x0800;
    const method = definition.method ?? 0;
    const compressed = method === 8 ? new Uint8Array(deflateRawSync(content)) : content;
    const checksum = definition.checksum ?? crc32(content);
    const compressedSize = definition.compressedSize ?? compressed.byteLength;
    const uncompressedSize = definition.uncompressedSize ?? content.byteLength;
    const localExtra = definition.localExtra || new Uint8Array();
    const centralExtra = definition.centralExtra || localExtra;
    const descriptor = definition.descriptor
      ? (() => {
          const signed = definition.descriptor !== "unsigned";
          const value = new Uint8Array(signed ? 16 : 12);
          const view = new DataView(value.buffer);
          let offset = 0;
          if (signed) { view.setUint32(0, 0x08074b50, true); offset = 4; }
          view.setUint32(offset, definition.descriptorChecksum ?? checksum, true);
          view.setUint32(offset + 4, compressedSize, true);
          view.setUint32(offset + 8, uncompressedSize, true);
          return value;
        })()
      : new Uint8Array();
    const local = new Uint8Array(30 + localName.byteLength + localExtra.byteLength + compressed.byteLength + descriptor.byteLength);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, definition.descriptor ? 0 : checksum, true);
    lv.setUint32(18, definition.descriptor ? 0 : compressedSize, true);
    lv.setUint32(22, definition.descriptor ? 0 : uncompressedSize, true);
    lv.setUint16(26, localName.byteLength, true);
    lv.setUint16(28, localExtra.byteLength, true);
    local.set(localName, 30);
    local.set(localExtra, 30 + localName.byteLength);
    local.set(compressed, 30 + localName.byteLength + localExtra.byteLength);
    local.set(descriptor, 30 + localName.byteLength + localExtra.byteLength + compressed.byteLength);

    const entryComment = encoder.encode(definition.comment || "");
    const record = new Uint8Array(46 + rawName.byteLength + centralExtra.byteLength + entryComment.byteLength);
    const cv = new DataView(record.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, definition.madeBy ?? 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, checksum, true);
    cv.setUint32(20, compressedSize, true);
    cv.setUint32(24, uncompressedSize, true);
    cv.setUint16(28, rawName.byteLength, true);
    cv.setUint16(30, centralExtra.byteLength, true);
    cv.setUint16(32, entryComment.byteLength, true);
    cv.setUint32(38, definition.externalAttributes ?? 0, true);
    cv.setUint32(42, definition.localOffset ?? localOffset, true);
    record.set(rawName, 46);
    record.set(centralExtra, 46 + rawName.byteLength);
    record.set(entryComment, 46 + rawName.byteLength + centralExtra.byteLength);
    locals.push(local);
    central.push(record);
    localOffset += local.byteLength;
  }
  const centralBytes = concat(central);
  const archiveComment = encoder.encode(comment);
  const eocd = new Uint8Array(22 + archiveComment.byteLength);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, definitions.length, true);
  ev.setUint16(10, definitions.length, true);
  ev.setUint32(12, centralBytes.byteLength, true);
  ev.setUint32(16, localOffset, true);
  ev.setUint16(20, archiveComment.byteLength, true);
  eocd.set(archiveComment, 22);
  return concat([...locals, centralBytes, eocd, trailing]);
}

function archive(bytes, name = "notes.zip") {
  return new File([bytes], name, { type: "application/zip" });
}

function findSignature(bytes, signature) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset + 4 <= bytes.byteLength; offset += 1) if (view.getUint32(offset, true) === signature) return offset;
  return -1;
}

test("the browser ZIP-import adapter exposes the npm-published parser API", () => {
  for (const name of ["ZIP_IMPORT_LIMITS", "extractHtmlNoteZip", "importHtmlNoteZip"]) {
    assert.equal(siteZipImport[name], publishedZipImport[name], name);
  }
});

test("Node file intake extracts ordinary STORE and DEFLATE ZIPs without DOM File", async () => {
  const root = mkdtempSync(join(tmpdir(), "realitycheck-node-zip-"));
  try {
    const html = "<!doctype html><html><body><h1>Node ZIP</h1></body></html>";
    const binary = new Uint8Array([0, 1, 2, 127, 128, 255]);
    const path = join(root, "ordinary-export.zip");
    writeFileSync(path, buildZip([
      { path: "notes/index.html", bytes: html, method: 8 },
      { path: "notes/assets/data.bin", bytes: binary, method: 0 },
    ]));
    const extracted = await extractHtmlNoteZipFile(path);
    assert.equal(extracted.kind, "html-note-zip-extract");
    assert.deepEqual(extracted.manifest.methods, ["deflate", "store"]);
    assert.deepEqual(extracted.entries.map((entry) => entry.path), ["notes/assets/data.bin", "notes/index.html"]);
    assert.deepEqual(extracted.entries[0].data, binary);
    assert.equal(decoder.decode(extracted.entries[1].data), html);
    assert.equal(Object.hasOwn(extracted.entries[0], "file"), false);
    assert.equal(Object.hasOwn(extracted.entries[0], "data"), true);

    const archiveBytes = new Uint8Array(await import("node:fs/promises").then(({ readFile }) => readFile(path)));
    const portable = await readPortableZipArchive(archiveBytes, { name: "ordinary-export.zip" });
    assert.deepEqual([...portable.entries.keys()], ["notes/assets/data.bin", "notes/index.html"]);
    assert.deepEqual(portable.entries.get("notes/assets/data.bin"), binary);
    assert.equal(decoder.decode(portable.entries.get("notes/index.html")), html);
    assert.equal(portable.manifest.archiveName, "ordinary-export.zip");
    assert.match(portable.manifest.importContentId, /^sha256:[a-f0-9]{64}$/);

    const bytes = buildZip([{ path: "notes/index.html", bytes: html, method: 0 }]);
    const fileLike = { name: "memory.zip", size: bytes.byteLength, async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } };
    const memory = await extractHtmlNoteZip(fileLike);
    assert.equal(memory.kind, "html-note-zip-extract");
    assert.equal(decoder.decode(memory.entries[0].data), html);

    const undersized = join(root, "undersized-declaration.zip");
    writeFileSync(undersized, buildZip([{ path: "notes/index.html", bytes: html, method: 8, uncompressedSize: 4 }]));
    await assert.rejects(extractHtmlNoteZipFile(undersized), /DEFLATE output exceeds/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ZIP import opens STORE and DEFLATE entries, preserves a root, and verifies exact bytes", async () => {
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Imported</title><link rel="stylesheet" href="assets/note.css"></head><body><h1>Imported</h1><p>A complete exported note is opened directly from its ZIP.</p></body></html>';
  const css = "body{max-width:72rem}\n";
  const image = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
  const source = archive(buildZip([
    { path: "notes/", externalAttributes: 0x10 },
    { path: "notes/index.html", bytes: html, method: 8 },
    { path: "notes/assets/note.css", bytes: css, method: 8 },
    { path: "notes/assets/chart.bin", bytes: image },
  ], { comment: "ordinary archive comment" }), "research-export.zip");
  const imported = await importHtmlNoteZip(source);
  assert.equal(imported.kind, "html-note-zip-import");
  assert.equal(imported.source, source);
  assert.equal(imported.manifest.rootName, "notes");
  assert.equal(imported.manifest.rootWrapped, false);
  assert.equal(imported.manifest.importedFiles, 3);
  assert.equal(imported.manifest.ignoredDirectories, 1);
  assert.deepEqual(imported.manifest.methods, ["deflate", "store"]);
  assert.match(imported.manifest.archiveSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(imported.fileEntries.map((entry) => entry.path), [
    "notes/assets/chart.bin",
    "notes/assets/note.css",
    "notes/index.html",
  ]);
  assert.deepEqual(new Uint8Array(await imported.files[0].arrayBuffer()), image);
  assert.equal(await imported.files[1].text(), css);
  assert.equal(await imported.files[2].text(), html);
  for (const entry of imported.manifest.entries) {
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert.match(entry.crc32Hex, /^[a-f0-9]{8}$/);
  }
});

test("rootless ZIPs receive one portable wrapper without changing internal relationships", async () => {
  const bytes = buildZip([
    { path: "index.html", bytes: '<html><body><h1>Root note</h1><img src="assets/x.svg"></body></html>', method: 8 },
    { path: "assets/x.svg", bytes: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>" },
  ], { comment: "kept only in the source archive" });
  const imported = await importHtmlNoteZip(archive(bytes, "AI Draft 1.zip"));
  const renamed = await importHtmlNoteZip(archive(bytes, "AI Draft 2.zip"));
  assert.equal(imported.manifest.rootName, "imported-notes");
  assert.equal(imported.manifest.rootWrapped, true);
  assert.deepEqual(imported.fileEntries.map((entry) => entry.path), ["imported-notes/assets/x.svg", "imported-notes/index.html"]);
  assert.equal(imported.manifest.centralDirectoryEntriesOnly, true);
  assert.deepEqual(renamed.fileEntries.map((entry) => entry.path), imported.fileEntries.map((entry) => entry.path));
  assert.equal(renamed.manifest.importContentId, imported.manifest.importContentId);
  assert.equal(renamed.manifest.archiveSha256, imported.manifest.archiveSha256);
});

test("importContentId is stable for identical content while sourceArchiveSha256 binds exact ZIP bytes", async () => {
  const firstBytes = buildZip([{ path: "notes/index.html", bytes: "<html><body><h1>Stable content</h1></body></html>", method: 8 }]);
  const secondBytes = new Uint8Array(firstBytes);
  const central = findSignature(secondBytes, 0x02014b50);
  new DataView(secondBytes.buffer).setUint16(10, 1, true);
  new DataView(secondBytes.buffer).setUint16(central + 12, 1, true);
  const first = await importHtmlNoteZip(archive(firstBytes));
  const second = await importHtmlNoteZip(archive(secondBytes));
  assert.notEqual(first.manifest.archiveSha256, second.manifest.archiveSha256);
  assert.equal(first.manifest.importContentId, second.manifest.importContentId);
  assert.match(first.manifest.importContentId, /^sha256:[a-f0-9]{64}$/);
});

test("Unicode path extra fields allow portable non-ASCII names without trusting a legacy code page", async () => {
  const rawName = new Uint8Array([0x82, 0x2f, 0x69, 0x6e, 0x64, 0x65, 0x78, 0x2e, 0x68, 0x74, 0x6d, 0x6c]);
  const path = "笔记/index.html";
  const extra = unicodePathExtra(rawName, path);
  const imported = await importHtmlNoteZip(archive(buildZip([{ path, rawName, flags: 0, localExtra: extra, centralExtra: extra, bytes: "<html><body><h1>笔记</h1></body></html>" }]), "unicode.zip"));
  assert.equal(imported.fileEntries[0].path, path);
  assert.equal(imported.manifest.rootWrapped, false);
  const damaged = new Uint8Array(extra);
  damaged[5] ^= 0xff;
  await assert.rejects(importHtmlNoteZip(archive(buildZip([{ path, rawName, flags: 0, localExtra: damaged, centralExtra: damaged, bytes: "<html></html>" }]))), /Unicode path extra field does not match/);
  await assert.rejects(importHtmlNoteZip(archive(buildZip([{ path: "invalid.html", rawName: new Uint8Array([0xff, 0x2e, 0x68, 0x74, 0x6d, 0x6c]), flags: 0x0800, bytes: "<html></html>" }]))), /encoded data was not valid|not valid for encoding/i);
  const otherExtra = unicodePathExtra(rawName, "其他/index.html");
  await assert.rejects(importHtmlNoteZip(archive(buildZip([{ path, rawName, flags: 0, localExtra: otherExtra, centralExtra: extra, bytes: "<html></html>" }]))), /local and central Unicode paths disagree/);
  await assert.rejects(importHtmlNoteZip(archive(buildZip([{ path, rawName, flags: 0, centralExtra: extra, bytes: "<html></html>" }]))), /local and central Unicode paths disagree/);
  const utf8Name = encoder.encode("notes/index.html");
  const conflictingExtra = unicodePathExtra(utf8Name, "other/index.html");
  await assert.rejects(importHtmlNoteZip(archive(buildZip([{ path: "notes/index.html", rawName: utf8Name, flags: 0x0800, localExtra: conflictingExtra, centralExtra: conflictingExtra, bytes: "<html></html>" }]))), /UTF-8 name and Unicode path extra field disagree/);
});

test("CP437 names and signed or unsigned streaming data descriptors are verified", async () => {
  const cp437Name = new Uint8Array([0x82, 0x78, 0x70, 0x6f, 0x72, 0x74, 0x2f, 0x69, 0x6e, 0x64, 0x65, 0x78, 0x2e, 0x68, 0x74, 0x6d, 0x6c]);
  for (const descriptor of ["signed", "unsigned"]) {
    const imported = await importHtmlNoteZip(archive(buildZip([{
      path: "éxport/index.html",
      rawName: cp437Name,
      localName: cp437Name,
      flags: 0x0008,
      method: 8,
      descriptor,
      bytes: "<html><body><h1>Streaming export</h1></body></html>",
    }])), { limits: { maxTotalBytes: 1024 * 1024 } });
    assert.equal(imported.fileEntries[0].path, "éxport/index.html");
  }
});

test("ZIP import rejects traversal, encryption, symlinks, unsupported methods, and portable collisions", async () => {
  const badArchives = [
    [buildZip([{ path: "../evil.html", bytes: "<html></html>" }]), /Parent traversal/],
    [buildZip([{ path: "/absolute.html", bytes: "<html></html>" }]), /Absolute ZIP entry path/],
    [buildZip([{ path: "notes\\bad.html", bytes: "<html></html>" }]), /forward slashes/],
    [buildZip([{ path: "notes/index.html", bytes: "<html></html>", flags: 0x0801 }]), /Encrypted ZIP entries/],
    [buildZip([{ path: "notes/index.html", bytes: "<html></html>", method: 99 }]), /compression method 99/],
    [buildZip([{ path: "notes/link.html", bytes: "target", madeBy: (3 << 8) | 20, externalAttributes: 0xa1ff0000 }]), /Non-regular Unix ZIP entries/],
    [buildZip([{ path: "notes/link.html", bytes: "target", madeBy: (19 << 8) | 20, externalAttributes: 0xa1ff0000 }]), /Non-regular Unix ZIP entries/],
    [buildZip([{ path: "notes/pipe.html", bytes: "target", madeBy: (3 << 8) | 20, externalAttributes: 0x11ff0000 }]), /Non-regular Unix ZIP entries/],
    [buildZip([{ path: "notes/Index.html", bytes: "<html></html>" }, { path: "notes/index.html", bytes: "<html></html>" }]), /Case-folded ZIP path collision/],
    [buildZip([{ path: "notes/café.html", bytes: "<html></html>" }, { path: "notes/café.html", bytes: "<html></html>" }]), /Unicode-normalized ZIP path collision/],
    [buildZip([{ path: "notes/page", bytes: "file" }, { path: "notes/page/index.html", bytes: "<html></html>" }]), /cross-platform directory prefix/],
    [buildZip([{ path: "notes/Page", bytes: "file" }, { path: "notes/page/index.html", bytes: "<html></html>" }]), /cross-platform directory prefix/],
    [buildZip([{ path: "notes/café", bytes: "file" }, { path: "notes/café/index.html", bytes: "<html></html>" }]), /cross-platform directory prefix/],
    [buildZip([{ path: "notes/.env", bytes: "SECRET=x" }, { path: "notes/index.html", bytes: "<html></html>" }]), /sensitive ZIP path is blocked before extraction/],
  ];
  for (const [bytes, expected] of badArchives) await assert.rejects(importHtmlNoteZip(archive(bytes)), expected);
});

test("ZIP import rejects CRC, local-name, trailing-data, ZIP64, and declared-size tampering", async () => {
  const crcTampered = buildZip([{ path: "notes/index.html", bytes: "<html><body>correct</body></html>" }]);
  crcTampered[30 + encoder.encode("notes/index.html").byteLength + 5] ^= 0xff;
  await assert.rejects(importHtmlNoteZip(archive(crcTampered)), /CRC32 verification/);

  await assert.rejects(importHtmlNoteZip(archive(buildZip([{ path: "notes/index.html", localName: encoder.encode("notes/other.html"), bytes: "<html></html>" }]))), /local and central paths differ/);
  await assert.rejects(importHtmlNoteZip(archive(buildZip([{ path: "notes/index.html", bytes: "<html></html>" }], { trailing: new Uint8Array([1]) }))), /trailing data/);

  const ambiguousBase = buildZip([{ path: "notes/index.html", bytes: "<html></html>" }]);
  const ambiguousFirst = new Uint8Array(ambiguousBase);
  new DataView(ambiguousFirst.buffer).setUint16(ambiguousFirst.byteLength - 2, 22, true);
  const ambiguous = concat([ambiguousFirst, ambiguousBase.slice(-22)]);
  await assert.rejects(importHtmlNoteZip(archive(ambiguous)), /ambiguous end-of-central-directory/);

  const zip64 = buildZip([{ path: "notes/index.html", bytes: "<html></html>" }]);
  const centralOffset = findSignature(zip64, 0x02014b50);
  new DataView(zip64.buffer).setUint32(centralOffset + 24, 0xffffffff, true);
  await assert.rejects(importHtmlNoteZip(archive(zip64)), /ZIP64/);

  await assert.rejects(importHtmlNoteZip(archive(buildZip([{ path: "notes/index.html", bytes: "<html><body>expands beyond declaration</body></html>", method: 8, uncompressedSize: 4 }]))), /DEFLATE output exceeds/);

  await assert.rejects(importHtmlNoteZip(archive(buildZip([{ path: "notes/index.html", bytes: "<html></html>", method: 8, flags: 0x0808 }]))), /data descriptor is missing/);
  await assert.rejects(importHtmlNoteZip(archive(buildZip([{ path: "notes/index.html", bytes: "<html></html>", method: 8, flags: 0x0808, descriptor: "signed", descriptorChecksum: 123 }]))), /data descriptor is missing or differs/);
});

test("declared limits fail before archive reads and pending reads remain cancellable", async () => {
  assert.equal(ZIP_IMPORT_LIMITS.maxArchiveBytes, 64 * 1024 * 1024);
  assert.equal(ZIP_IMPORT_LIMITS.maxTotalBytes, 48 * 1024 * 1024);
  assert.equal(ZIP_IMPORT_LIMITS.maxEntryPathBytes, 1024);
  assert.equal(ZIP_IMPORT_LIMITS.maxAggregatePathBytes, 512 * 1024);
  let reads = 0;
  const oversized = { name: "too-large.zip", size: 9, async arrayBuffer() { reads += 1; return new ArrayBuffer(9); } };
  await assert.rejects(importHtmlNoteZip(oversized, { limits: { maxArchiveBytes: 8 } }), /input limit/);
  assert.equal(reads, 0);
  await assert.rejects(importHtmlNoteZip(archive(buildZip([{ path: `notes/${"a".repeat(40)}.html`, bytes: "<html></html>" }])), { limits: { maxEntryPathBytes: 32 } }), /path limit/);
  await assert.rejects(importHtmlNoteZip(archive(buildZip([{ path: "notes/a.html", bytes: "<html></html>" }, { path: "notes/b.html", bytes: "<html></html>" }])), { limits: { maxAggregatePathBytes: 20 } }), /aggregate limit/);

  let resolveRead;
  const pending = {
    name: "pending.zip",
    size: 4,
    arrayBuffer() { return new Promise((resolve) => { resolveRead = resolve; }); },
  };
  const controller = new AbortController();
  const operation = importHtmlNoteZip(pending, { signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  resolveRead(new ArrayBuffer(4));
  await assert.rejects(operation, { name: "AbortError" });
});

test("archives without an HTML note are rejected after bounded byte verification", async () => {
  await assert.rejects(importHtmlNoteZip(archive(buildZip([{ path: "notes/readme.txt", bytes: "No HTML here" }]))), /no \.html or \.htm note/);
});

test("imported ZIP identity is bound through cumulative repair, report, proof, and output read-back", async () => {
  const draft = '<html><head><title>ZIP draft</title><link rel="stylesheet" href="assets/note.css"></head><body><h1>ZIP draft</h1><p>This export proves a source ZIP can become one checked and read-back-verified safe-metadata copy.</p></body></html>';
  const css = "body{max-width:72rem}\n";
  const imported = await importHtmlNoteZip(archive(buildZip([
    { path: "notes/index.html", bytes: draft, method: 8 },
    { path: "notes/assets/note.css", bytes: css, method: 8 },
  ]), "ai-export.zip"));
  const tamperedManifest = {
    ...imported,
    manifest: {
      ...imported.manifest,
      entries: imported.manifest.entries.map((entry, index) => index === 0 ? { ...entry, sha256: "f".repeat(64) } : entry),
    },
  };
  const rejectedInventory = await prepareFolderRepairInventory(imported.fileEntries, { normalizeNotePath, sourceArchive: tamperedManifest });
  assert.equal(rejectedInventory.eligible, false);
  assert.equal(rejectedInventory.blockers.some((item) => item.code === "source-archive-invalid"), true);
  const inventory = await prepareFolderRepairInventory(imported.fileEntries, { normalizeNotePath, sourceArchive: imported });
  assert.equal(inventory.eligible, true, JSON.stringify(inventory.blockers));
  const analysis = {
    htmlSources: [{ path: "notes/index.html", html: await imported.fileEntries.find((entry) => entry.path.endsWith("index.html")).file.text() }],
    cssSources: [{ path: "notes/assets/note.css", text: await imported.fileEntries.find((entry) => entry.path.endsWith("note.css")).file.text() }],
    knownFiles: imported.fileEntries.map((entry) => entry.path),
  };
  const before = analyzeBrowserNoteSources(analysis, analysisHelpers);
  const verification = await bindSafeFolderCandidate({
    ...verifySafeNotePackageRepair({ beforeBundle: before, analysis }, analysisHelpers),
    sourceArchive: {
      archiveSha256: imported.manifest.archiveSha256,
      importContentId: imported.manifest.importContentId,
    },
  });
  const reportHtml = buildPortableNoteReport({
    ...verification.after,
    generatedAt: "2026-08-27T00:00:00.000Z",
    reportContext: "folder-candidate",
    safePackageRepairVerification: verification,
    importedArchive: imported.manifest,
  }, { buildRepairTask, buildPackageRepairTask, noteDecision });
  const artifact = await buildVerifiedFolderRepairZip({ inventory, verification, reportHtml, generatedAt: "2026-08-27T00:00:00.000Z" });
  assert.equal(artifact.sourceArchiveVerified, true);
  assert.equal(artifact.proof.sourceArchive.archiveSha256, imported.manifest.archiveSha256);
  assert.equal(artifact.proof.sourceArchive.importContentId, imported.manifest.importContentId);
  assert.equal(artifact.proof.sourceArchive.readBackSha256Verified, true);
  assert.match(reportHtml, new RegExp(imported.manifest.archiveSha256));
  assert.match(reportHtml, new RegExp(imported.manifest.importContentId));
  assert.match(reportHtml, /Source archive verified before analysis/);
  await assert.rejects(importHtmlNoteZip(new File([artifact.blob], "realitycheck-output.zip", { type: "application/zip" })), /generated RealityCheck output ZIP/);

  const wrongSource = await bindSafeFolderCandidate({
    ...verification,
    sourceArchive: { ...verification.sourceArchive, importContentId: `sha256:${"f".repeat(64)}` },
  });
  const wrongReport = buildPortableNoteReport({
    ...wrongSource.after,
    generatedAt: "2026-08-27T00:00:00.000Z",
    reportContext: "folder-candidate",
    safePackageRepairVerification: wrongSource,
    importedArchive: { ...imported.manifest, importContentId: wrongSource.sourceArchive.importContentId },
  }, { buildRepairTask, buildPackageRepairTask, noteDecision });
  await assert.rejects(buildVerifiedFolderRepairZip({ inventory, verification: wrongSource, reportHtml: wrongReport, generatedAt: "2026-08-27T00:00:00.000Z" }), /not bound to the imported source ZIP/);
});

test("a clean imported ZIP still produces a no-op verified output instead of losing the core handoff", async () => {
  const clean = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Clean ZIP note</title></head><body><h1>Clean ZIP note</h1><p>This already-correct export still needs a verified deterministic handoff without invented edits.</p></body></html>';
  const imported = await importHtmlNoteZip(archive(buildZip([{ path: "clean/index.html", bytes: clean, method: 8 }]), "clean-export.zip"));
  const inventory = await prepareFolderRepairInventory(imported.fileEntries, { normalizeNotePath, sourceArchive: imported });
  const analysis = { htmlSources: [{ path: "clean/index.html", html: clean }], cssSources: [], knownFiles: ["clean/index.html"] };
  const before = analyzeBrowserNoteSources(analysis, analysisHelpers);
  assert.throws(() => verifySafeNotePackageRepair({ beforeBundle: before, analysis }, analysisHelpers), /No safe metadata repair/);
  const verification = await bindSafeFolderCandidate({
    ...verifySafeNotePackageRepair({ beforeBundle: before, analysis, allowNoop: true }, analysisHelpers),
    sourceArchive: { archiveSha256: imported.manifest.archiveSha256, importContentId: imported.manifest.importContentId },
  });
  assert.deepEqual(verification.changes, []);
  assert.equal(verification.totalChanges, 0);
  assert.deepEqual(verification.before.summary, verification.after.summary);
  const reportHtml = buildPortableNoteReport({
    ...verification.after,
    generatedAt: "2026-08-27T00:00:00.000Z",
    reportContext: "folder-candidate",
    safePackageRepairVerification: verification,
    importedArchive: imported.manifest,
  }, { buildRepairTask, buildPackageRepairTask, noteDecision });
  assert.match(reportHtml, /No metadata bytes needed to change/);
  const artifact = await buildVerifiedFolderRepairZip({ inventory, verification, reportHtml, generatedAt: "2026-08-27T00:00:00.000Z" });
  assert.equal(artifact.sourceArchiveVerified, true);
  assert.equal(artifact.proof.repair.changedHtmlFiles, 0);
  assert.equal(artifact.proof.repair.totalMetadataChanges, 0);
  assert.equal(artifact.proof.selection.inventory[0].transformation, "byte-for-byte");
});

import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_ZIP_LIMITS, verifyStoredZip, writeStoredZip, writeStoredZipWithManifest } from "../site/note-zip.mjs";

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

function independentCrc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function independentSha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function parseStoredZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset) => view.getUint16(offset, true);
  const u32 = (offset) => view.getUint32(offset, true);
  const eocd = bytes.byteLength - 22;
  assert.equal(u32(eocd), 0x06054b50);
  assert.equal(u16(eocd + 4), 0);
  assert.equal(u16(eocd + 6), 0);
  assert.equal(u16(eocd + 8), u16(eocd + 10));
  assert.equal(u16(eocd + 20), 0);
  const count = u16(eocd + 10);
  const centralSize = u32(eocd + 12);
  const centralOffset = u32(eocd + 16);
  assert.equal(centralOffset + centralSize, eocd);
  let cursor = centralOffset;
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    assert.equal(u32(cursor), 0x02014b50);
    assert.equal(u16(cursor + 8), 0x0800);
    assert.equal(u16(cursor + 10), 0);
    assert.equal(u16(cursor + 12), 0);
    assert.equal(u16(cursor + 14), 0x21);
    const checksum = u32(cursor + 16);
    const compressed = u32(cursor + 20);
    const uncompressed = u32(cursor + 24);
    const nameLength = u16(cursor + 28);
    const extraLength = u16(cursor + 30);
    const commentLength = u16(cursor + 32);
    const disk = u16(cursor + 34);
    const localOffset = u32(cursor + 42);
    assert.equal(compressed, uncompressed);
    assert.equal(extraLength, 0);
    assert.equal(commentLength, 0);
    assert.equal(disk, 0);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

    assert.equal(u32(localOffset), 0x04034b50);
    assert.equal(u16(localOffset + 6), 0x0800);
    assert.equal(u16(localOffset + 8), 0);
    assert.equal(u16(localOffset + 10), 0);
    assert.equal(u16(localOffset + 12), 0x21);
    assert.equal(u32(localOffset + 14), checksum);
    assert.equal(u32(localOffset + 18), compressed);
    assert.equal(u32(localOffset + 22), uncompressed);
    assert.equal(u16(localOffset + 28), 0);
    const localNameLength = u16(localOffset + 26);
    assert.equal(decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)), name);
    const dataStart = localOffset + 30 + localNameLength;
    const data = bytes.slice(dataStart, dataStart + uncompressed);
    assert.equal(independentCrc32(data), checksum);
    entries.push({ name, checksum, data });
    cursor += 46 + nameLength;
  }
  assert.equal(cursor, centralOffset + centralSize);
  return entries;
}

test("stored ZIP has valid ordered local records, central directory, CRCs, Unicode, and exact bytes", async () => {
  const text = encoder.encode("研究笔记\nexact UTF-8");
  const binary = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
  const archive = await writeStoredZip([
    { path: "notes/研究.html", bytes: text },
    { path: "assets/raw.bin", blob: new Blob([binary]) },
    { path: "normalized/path.txt", bytes: encoder.encode("ordinary segment") },
  ], { output: "uint8array" });
  const parsed = parseStoredZip(archive);
  assert.deepEqual(parsed.map((entry) => entry.name), ["notes/研究.html", "assets/raw.bin", "normalized/path.txt"]);
  assert.deepEqual(parsed[0].data, text);
  assert.deepEqual(parsed[1].data, binary);
  assert.deepEqual(parsed[2].data, encoder.encode("ordinary segment"));
});

test("stored ZIP output is deterministic and Blob output has identical bytes", async () => {
  const entries = [
    { path: "b.txt", bytes: encoder.encode("second") },
    { path: "a.txt", file: new File(["first"], "a.txt") },
  ];
  const first = await writeStoredZip(entries, { output: "uint8array" });
  const second = await writeStoredZip(entries, { output: "uint8array" });
  const blob = await writeStoredZip(entries);
  assert.deepEqual(first, second);
  assert.equal(blob.type, "application/zip");
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), first);
  assert.deepEqual(parseStoredZip(first).map((entry) => entry.name), ["b.txt", "a.txt"]);
});

test("stored ZIP manifest binds every ordered path to its size, CRC32, and SHA-256", async () => {
  const result = await writeStoredZipWithManifest([
    { path: "one.txt", bytes: encoder.encode("one") },
    { path: "资料/two.bin", bytes: new Uint8Array([2, 0, 2, 6]) },
  ], { output: "uint8array" });
  const parsed = parseStoredZip(result.archive);
  assert.equal(result.manifest.format, "zip32-store");
  assert.equal(result.manifest.modifiedAt, "1980-01-01T00:00:00.000Z");
  assert.equal(result.manifest.archiveBytes, result.archive.byteLength);
  assert.equal(result.manifest.totalUncompressedBytes, 7);
  assert.deepEqual(result.manifest.entries, await Promise.all(parsed.map(async (entry) => ({
    path: entry.name,
    size: entry.data.byteLength,
    crc32: entry.checksum,
    crc32Hex: entry.checksum.toString(16).padStart(8, "0"),
    sha256: await independentSha256(entry.data),
  }))));
  assert.deepEqual(await verifyStoredZip(result.archive, result.manifest), result.manifest);
  const corrupted = new Uint8Array(result.archive);
  corrupted[30 + encoder.encode("one.txt").byteLength] ^= 0xff;
  await assert.rejects(verifyStoredZip(corrupted, result.manifest), /CRC verification/);
  await assert.rejects(verifyStoredZip(result.archive, { ...result.manifest, archiveBytes: result.manifest.archiveBytes + 1 }), /expected manifest/);
});

test("stored ZIP rejects unsafe, directory, control, and duplicate normalized paths", async () => {
  const invalidPaths = [
    "", "/root.txt", "C:/root.txt", "../escape.txt", "a/../escape.txt", "a\\b.txt", "folder/", ".", "a/./b.txt", "a//b.txt",
    "nul\0.txt", "line\nbreak.txt", "zero\u200bwidth.txt", "photo\u202egnp.exe", "name. ", "name.", "file:name.txt", "https://host/file", "CON", "con.txt", "folder/AUX.md", "COM1.log", "LPT9",
  ];
  for (const path of invalidPaths) {
    await assert.rejects(writeStoredZip([{ path, bytes: new Uint8Array() }], { output: "uint8array" }), undefined, path);
  }
  for (const paths of [
    ["a/b.txt", "a/b.txt"],
    ["cafe\u0301.txt", "café.txt"],
    ["Notes/Index.html", "notes/index.html"],
    ["straße.html", "STRASSE.html"],
  ]) {
    await assert.rejects(writeStoredZip(paths.map((path) => ({ path, bytes: new Uint8Array() })), { output: "uint8array" }), /(?:Duplicate normalized|Unicode-normalized|Case-folded) ZIP entry path/);
  }
  await assert.rejects(writeStoredZip([{ path: "directory", directory: true, bytes: new Uint8Array() }], { output: "uint8array" }), /Directory ZIP entries/);
  await assert.rejects(writeStoredZip([{ path: "secret.txt", encrypted: true, bytes: new Uint8Array() }], { output: "uint8array" }), /Encrypted ZIP entries/);
  await assert.rejects(writeStoredZip([{ path: "compressed.txt", compression: "deflate", bytes: new Uint8Array() }], { output: "uint8array" }), /STORE mode/);
});

test("read-back rejects timestamp, version, symlink-attribute, and duplicate-path tampering", async () => {
  const base = await writeStoredZip([
    { path: "A.txt", bytes: encoder.encode("A") },
    { path: "b.txt", bytes: encoder.encode("B") },
  ], { output: "uint8array" });
  const eocd = base.byteLength - 22;
  const baseView = new DataView(base.buffer, base.byteOffset, base.byteLength);
  const central = baseView.getUint32(eocd + 16, true);
  const local = baseView.getUint32(central + 42, true);
  for (const [offset, width, value, pattern] of [
    [central + 4, 2, 21, /fixed archive contract/],
    [central + 12, 2, 1, /fixed archive contract/],
    [central + 38, 4, 0xa0000000, /file attribute/],
    [local + 10, 2, 1, /local entry does not match/],
  ]) {
    const changed = new Uint8Array(base);
    const view = new DataView(changed.buffer);
    if (width === 2) view.setUint16(offset, value, true);
    else view.setUint32(offset, value, true);
    await assert.rejects(verifyStoredZip(changed), pattern);
  }

  const duplicate = new Uint8Array(base);
  const duplicateView = new DataView(duplicate.buffer);
  const firstNameLength = duplicateView.getUint16(central + 28, true);
  const secondCentral = central + 46 + firstNameLength;
  const secondLocal = duplicateView.getUint32(secondCentral + 42, true);
  duplicate[secondCentral + 46] = "a".charCodeAt(0);
  duplicate[secondLocal + 30] = "a".charCodeAt(0);
  await assert.rejects(verifyStoredZip(duplicate), /Case-folded ZIP entry collision/);
});

test("all declared limits and ZIP32 boundaries fail before any Blob or File is read", async () => {
  assert.deepEqual(DEFAULT_ZIP_LIMITS, { maxFiles: 5000, maxFileBytes: 32 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024 });
  let reads = 0;
  const countedBlob = (size) => ({
    size,
    async arrayBuffer() {
      reads += 1;
      return new ArrayBuffer(Math.min(size, 16));
    },
  });

  await assert.rejects(writeStoredZip([
    { path: "first.bin", blob: countedBlob(4) },
    { path: "second.bin", blob: countedBlob(4) },
  ], { output: "uint8array", limits: { maxFiles: 1 } }), /file count/);
  assert.equal(reads, 0);

  await assert.rejects(writeStoredZip([{ path: "large.bin", blob: countedBlob(9) }], {
    output: "uint8array", limits: { maxFileBytes: 8, maxTotalBytes: 20 },
  }), /per-file limit/);
  assert.equal(reads, 0);

  await assert.rejects(writeStoredZip([
    { path: "a.bin", blob: countedBlob(6) },
    { path: "b.bin", blob: countedBlob(6) },
  ], { output: "uint8array", limits: { maxFileBytes: 10, maxTotalBytes: 10 } }), /total limit/);
  assert.equal(reads, 0);

  await assert.rejects(writeStoredZip([{ path: "zip32.bin", blob: countedBlob(0x1_0000_0000) }], {
    output: "uint8array", limits: { maxFileBytes: 0xffffffff, maxTotalBytes: 0xffffffff },
  }), /ZIP32 file size limit/);
  assert.equal(reads, 0);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(writeStoredZip([{ path: "aborted.bin", blob: countedBlob(1) }], { output: "uint8array", signal: controller.signal }), /aborted/);
  assert.equal(reads, 0);
});

test("source shape, output choice, UTF-8 path length, and Blob size changes fail closed", async () => {
  await assert.rejects(writeStoredZip([{ path: "missing.bin" }], { output: "uint8array" }), /exactly one/);
  await assert.rejects(writeStoredZip([], { output: "uint8array" }), /at least one file/);
  await assert.rejects(writeStoredZip([{ path: "two.bin", bytes: new Uint8Array(), blob: new Blob() }], { output: "uint8array" }), /exactly one/);
  await assert.rejects(writeStoredZip([{ path: "bad.bin", bytes: "not bytes" }], { output: "uint8array" }), /bytes, Blob, or File/);
  await assert.rejects(writeStoredZip([], { output: "stream" }), /output must be/);
  await assert.rejects(writeStoredZip([{ path: `${"界".repeat(21846)}.txt`, bytes: new Uint8Array() }], { output: "uint8array" }), /path is too long/);
  await assert.rejects(writeStoredZip([{ path: "changed.bin", blob: { size: 2, async arrayBuffer() { return new ArrayBuffer(1); } } }], { output: "uint8array" }), /size changed/);
});

test("pending reads and chunked CRC read-back can be cancelled before download readiness", async () => {
  let markStarted;
  let finishRead;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const pending = { size: 1, arrayBuffer() { markStarted(); return new Promise((resolve) => { finishRead = resolve; }); } };
  const readController = new AbortController();
  const writing = writeStoredZip([{ path: "pending.bin", blob: pending }], { output: "uint8array", signal: readController.signal });
  await started;
  readController.abort();
  finishRead(new ArrayBuffer(1));
  await assert.rejects(writing, (error) => error?.name === "AbortError");

  const large = await writeStoredZip([{ path: "large.bin", bytes: new Uint8Array(3 * 1024 * 1024) }], { output: "uint8array" });
  const verifyController = new AbortController();
  setTimeout(() => verifyController.abort(), 0);
  await assert.rejects(verifyStoredZip(large, null, { signal: verifyController.signal }), (error) => error?.name === "AbortError");
});

import { digestZipSource, validatePortableZipEntryPath } from "./note-zip.mjs?v=0.9.0";
import { isSensitiveNoteArchivePath } from "./note-path-policy.mjs?v=0.9.0";

const EOCD_BYTES = 22;
const CENTRAL_HEADER_BYTES = 46;
const LOCAL_HEADER_BYTES = 30;
const UTF8_FLAG = 0x0800;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const STORE_METHOD = 0;
const DEFLATE_METHOD = 8;
const ZIP32_MAX = 0xffffffff;
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const fatalUtf8 = new TextDecoder("utf-8", { fatal: true });

export const ZIP_IMPORT_LIMITS = Object.freeze({
  maxArchiveBytes: 64 * 1024 * 1024,
  maxEntries: 5000,
  maxFiles: 4998,
  maxFileBytes: 32 * 1024 * 1024,
  maxTotalBytes: 48 * 1024 * 1024,
  maxEntryPathBytes: 1024,
  maxAggregatePathBytes: 512 * 1024,
});

const CP437_HIGH = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

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

function abortError() {
  if (typeof DOMException === "function") return new DOMException("ZIP import was aborted", "AbortError");
  const error = new Error("ZIP import was aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function configuredLimits(input = {}) {
  const limits = {};
  for (const [name, fallback] of Object.entries(ZIP_IMPORT_LIMITS)) {
    const value = input[name] ?? fallback;
    if (!Number.isSafeInteger(value) || value < 0 || value > ZIP32_MAX) throw new RangeError(`${name} must be a non-negative ZIP32 integer`);
    limits[name] = value;
  }
  if (limits.maxFiles > limits.maxEntries) throw new RangeError("maxFiles must not exceed maxEntries");
  return limits;
}

function extraFields(bytes, label) {
  const fields = new Map();
  let cursor = 0;
  while (cursor < bytes.byteLength) {
    if (cursor + 4 > bytes.byteLength) throw new Error(`${label} has a truncated ZIP extra field`);
    const view = new DataView(bytes.buffer, bytes.byteOffset + cursor, bytes.byteLength - cursor);
    const id = view.getUint16(0, true);
    const size = view.getUint16(2, true);
    cursor += 4;
    if (cursor + size > bytes.byteLength) throw new Error(`${label} has an invalid ZIP extra field length`);
    if (fields.has(id)) throw new Error(`${label} repeats ZIP extra field 0x${id.toString(16).padStart(4, "0")}`);
    fields.set(id, bytes.slice(cursor, cursor + size));
    cursor += size;
  }
  return fields;
}

function decodeUnicodePath(nameBytes, fields) {
  const unicode = fields.get(0x7075);
  if (!unicode) return null;
  if (unicode.byteLength < 6 || unicode[0] !== 1) throw new Error("ZIP Unicode path extra field is invalid");
  const view = new DataView(unicode.buffer, unicode.byteOffset, unicode.byteLength);
  if (view.getUint32(1, true) !== crc32(nameBytes)) throw new Error("ZIP Unicode path extra field does not match the stored name");
  return fatalUtf8.decode(unicode.subarray(5));
}

function decodeEntryPath(nameBytes, flags, fields) {
  const unicodePath = decodeUnicodePath(nameBytes, fields);
  if (flags & UTF8_FLAG) {
    const utf8Path = fatalUtf8.decode(nameBytes);
    if (unicodePath !== null && unicodePath !== utf8Path) throw new Error("ZIP UTF-8 name and Unicode path extra field disagree");
    return utf8Path;
  }
  if (unicodePath !== null) return unicodePath;
  return [...nameBytes].map((value) => value < 0x80 ? String.fromCharCode(value) : CP437_HIGH[value - 0x80]).join("");
}

function locateEocd(bytes) {
  const minimum = Math.max(0, bytes.byteLength - EOCD_BYTES - 0xffff);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const candidates = [];
  for (let offset = bytes.byteLength - EOCD_BYTES; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + EOCD_BYTES + commentLength === bytes.byteLength) candidates.push(offset);
  }
  if (candidates.length > 1) throw new Error("ZIP contains ambiguous end-of-central-directory records");
  if (candidates.length === 1) return candidates[0];
  throw new Error("ZIP end-of-central-directory record is missing or has trailing data");
}

function registerPortablePath(path, seen, seenNfc, seenCaseFolded) {
  if (seen.has(path)) throw new Error(`Duplicate ZIP entry path: ${path}`);
  seen.add(path);
  const nfc = path.normalize("NFC");
  if (seenNfc.has(nfc)) throw new Error(`Unicode-normalized ZIP path collision: ${seenNfc.get(nfc)} and ${path}`);
  seenNfc.set(nfc, path);
  const folded = nfc.toUpperCase().toLowerCase();
  if (seenCaseFolded.has(folded)) throw new Error(`Case-folded ZIP path collision: ${seenCaseFolded.get(folded)} and ${path}`);
  seenCaseFolded.set(folded, path);
}

function parseCentralDirectory(bytes, limits) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = locateEocd(bytes);
  if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0) throw new Error("Multi-disk ZIP archives are not supported");
  const diskEntries = view.getUint16(eocd + 8, true);
  const totalEntries = view.getUint16(eocd + 10, true);
  if (diskEntries !== totalEntries) throw new Error("Multi-disk ZIP entry counts are not supported");
  if (totalEntries > limits.maxEntries) throw new RangeError(`ZIP contains more than ${limits.maxEntries} entries`);
  const centralBytes = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (centralBytes === ZIP32_MAX || centralOffset === ZIP32_MAX) throw new Error("ZIP64 archives are not supported");
  if (centralOffset + centralBytes !== eocd) throw new Error("ZIP central directory boundary is invalid");

  const entries = [];
  const seen = new Set();
  const seenNfc = new Map();
  const seenCaseFolded = new Map();
  let cursor = centralOffset;
  let fileCount = 0;
  let totalUncompressedBytes = 0;
  let aggregatePathBytes = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + CENTRAL_HEADER_BYTES > eocd || view.getUint32(cursor, true) !== 0x02014b50) throw new Error("ZIP central directory entry is invalid");
    const madeBy = view.getUint16(cursor + 4, true);
    const needed = view.getUint16(cursor + 6, true);
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const checksum = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const diskStart = view.getUint16(cursor + 34, true);
    const externalAttributes = view.getUint32(cursor + 38, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const end = cursor + CENTRAL_HEADER_BYTES + nameLength + extraLength + commentLength;
    if (end > eocd) throw new Error("ZIP central directory entry extends beyond its declared boundary");
    if (needed > 20 || diskStart !== 0 || compressedSize === ZIP32_MAX || uncompressedSize === ZIP32_MAX || localOffset === ZIP32_MAX) throw new Error("ZIP64 or unsupported ZIP features are not supported");
    if (flags & 0x0001) throw new Error("Encrypted ZIP entries are not supported");
    if (flags & ~0x080e) throw new Error("ZIP entry uses unsupported general-purpose flags");
    if (method !== STORE_METHOD && method !== DEFLATE_METHOD) throw new Error(`ZIP compression method ${method} is not supported`);
    if (method === STORE_METHOD && (flags & 0x0006)) throw new Error("Stored ZIP entries use invalid compression-option flags");
    const rawName = bytes.slice(cursor + CENTRAL_HEADER_BYTES, cursor + CENTRAL_HEADER_BYTES + nameLength);
    const fields = extraFields(bytes.slice(cursor + CENTRAL_HEADER_BYTES + nameLength, cursor + CENTRAL_HEADER_BYTES + nameLength + extraLength), "Central directory entry");
    if (fields.has(0x0001)) throw new Error("ZIP64 extra fields are not supported");
    const decoded = decodeEntryPath(rawName, flags, fields);
    const slashDirectory = decoded.endsWith("/");
    const portable = validatePortableZipEntryPath(slashDirectory ? decoded.slice(0, -1) : decoded);
    const portablePathBytes = new TextEncoder().encode(portable).byteLength;
    if (portablePathBytes > limits.maxEntryPathBytes) throw new RangeError(`ZIP entry path exceeds the ${limits.maxEntryPathBytes} byte path limit`);
    aggregatePathBytes += portablePathBytes;
    if (aggregatePathBytes > limits.maxAggregatePathBytes) throw new RangeError(`ZIP paths exceed the ${limits.maxAggregatePathBytes} byte aggregate limit`);
    if (/(?:^|\/)\.realitycheck\/(?:repair-proof\.json|after-report\.html)$/i.test(portable)) {
      throw new Error("This is a generated RealityCheck output ZIP. For the next check, choose the new original export ZIP and import the prior RealityCheck JSON as comparison evidence.");
    }
    if (isSensitiveNoteArchivePath(portable)) throw new Error(`Potentially sensitive ZIP path is blocked before extraction: ${portable}`);
    const host = madeBy >>> 8;
    const unixMode = (externalAttributes >>> 16) & 0xffff;
    const unixType = unixMode & 0xf000;
    if ([3, 19].includes(host) && unixType && ![0x4000, 0x8000].includes(unixType)) throw new Error(`Non-regular Unix ZIP entries are not supported: ${portable}`);
    const directory = slashDirectory || ([3, 19].includes(host) && unixType === 0x4000) || Boolean(externalAttributes & 0x10);
    if (directory && (compressedSize !== 0 || uncompressedSize !== 0)) throw new Error(`ZIP directory entry contains data: ${portable}`);
    registerPortablePath(portable, seen, seenNfc, seenCaseFolded);
    if (!directory) {
      fileCount += 1;
      if (fileCount > limits.maxFiles) throw new RangeError(`ZIP contains more than ${limits.maxFiles} files`);
      if (uncompressedSize > limits.maxFileBytes) throw new RangeError(`ZIP entry exceeds the ${limits.maxFileBytes} byte file limit: ${portable}`);
      totalUncompressedBytes += uncompressedSize;
      if (totalUncompressedBytes > limits.maxTotalBytes) throw new RangeError(`ZIP expands beyond the ${limits.maxTotalBytes} byte total limit`);
    }
    entries.push({
      originalPath: portable,
      rawName,
      flags,
      method,
      checksum,
      compressedSize,
      uncompressedSize,
      localOffset,
      directory,
    });
    cursor = end;
  }
  if (cursor !== eocd) throw new Error("ZIP central directory record coverage is incomplete");
  const filesByPortableKey = new Map(entries.filter((entry) => !entry.directory).map((entry) => [entry.originalPath.normalize("NFC").toUpperCase().toLowerCase(), entry.originalPath]));
  for (const entry of entries) {
    const key = entry.originalPath.normalize("NFC").toUpperCase().toLowerCase();
    const segments = key.split("/");
    for (let length = 1; length < segments.length; length += 1) {
      const ancestor = segments.slice(0, length).join("/");
      if (filesByPortableKey.has(ancestor)) throw new Error(`ZIP file path is also used as a cross-platform directory prefix: ${filesByPortableKey.get(ancestor)} (ancestor of ${entry.originalPath})`);
    }
  }
  return { entries, centralOffset, totalUncompressedBytes };
}

function dataDescriptorEnd(bytes, dataEnd, entry, centralOffset) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const matches = (offset) => offset + 12 <= centralOffset
    && view.getUint32(offset, true) === entry.checksum
    && view.getUint32(offset + 4, true) === entry.compressedSize
    && view.getUint32(offset + 8, true) === entry.uncompressedSize;
  if (dataEnd + 16 <= centralOffset && view.getUint32(dataEnd, true) === 0x08074b50 && matches(dataEnd + 4)) return dataEnd + 16;
  if (matches(dataEnd)) return dataEnd + 12;
  throw new Error(`ZIP data descriptor is missing or differs from the central directory: ${entry.originalPath}`);
}

function bindLocalRecords(bytes, parsed) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const records = [];
  for (const entry of parsed.entries) {
    const offset = entry.localOffset;
    if (offset + LOCAL_HEADER_BYTES > parsed.centralOffset || view.getUint32(offset, true) !== 0x04034b50) throw new Error(`ZIP local header is invalid: ${entry.originalPath}`);
    const needed = view.getUint16(offset + 4, true);
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const checksum = view.getUint32(offset + 14, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const dataStart = offset + LOCAL_HEADER_BYTES + nameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (needed > 20 || flags !== entry.flags || method !== entry.method || dataEnd > parsed.centralOffset) throw new Error(`ZIP local header differs from the central directory: ${entry.originalPath}`);
    const localName = bytes.subarray(offset + LOCAL_HEADER_BYTES, offset + LOCAL_HEADER_BYTES + nameLength);
    if (localName.byteLength !== entry.rawName.byteLength || localName.some((value, index) => value !== entry.rawName[index])) throw new Error(`ZIP local and central paths differ: ${entry.originalPath}`);
    const localFields = extraFields(bytes.slice(offset + LOCAL_HEADER_BYTES + nameLength, dataStart), "Local ZIP entry");
    if (localFields.has(0x0001)) throw new Error("ZIP64 local extra fields are not supported");
    const localDecoded = decodeEntryPath(localName, flags, localFields);
    const localDirectory = localDecoded.endsWith("/");
    const localPortable = validatePortableZipEntryPath(localDirectory ? localDecoded.slice(0, -1) : localDecoded);
    if (localPortable !== entry.originalPath || localDirectory !== entry.directory) throw new Error(`ZIP local and central Unicode paths disagree: ${entry.originalPath}`);
    const descriptor = Boolean(flags & DATA_DESCRIPTOR_FLAG);
    if ((!descriptor && (checksum !== entry.checksum || compressedSize !== entry.compressedSize || uncompressedSize !== entry.uncompressedSize))
      || (descriptor && ![0, entry.checksum].includes(checksum))
      || (descriptor && ![0, entry.compressedSize].includes(compressedSize))
      || (descriptor && ![0, entry.uncompressedSize].includes(uncompressedSize))) {
      throw new Error(`ZIP local size or checksum differs from the central directory: ${entry.originalPath}`);
    }
    entry.dataStart = dataStart;
    entry.dataEnd = dataEnd;
    const recordEnd = descriptor ? dataDescriptorEnd(bytes, dataEnd, entry, parsed.centralOffset) : dataEnd;
    records.push({ start: offset, end: recordEnd, path: entry.originalPath });
  }
  records.sort((left, right) => left.start - right.start || left.end - right.end);
  if (records.length && records[0].start !== 0) throw new Error("ZIP local records have an unsupported executable prefix or hidden leading data");
  for (let index = 1; index < records.length; index += 1) {
    if (records[index].start < records[index - 1].end) throw new Error(`ZIP local records overlap: ${records[index - 1].path} and ${records[index].path}`);
    if (records[index].start !== records[index - 1].end) throw new Error(`ZIP local record coverage has hidden or unsupported data before: ${records[index].path}`);
  }
  if (records.length && records.at(-1).end !== parsed.centralOffset) throw new Error("ZIP local record coverage has hidden or unsupported trailing data");
}

async function inflateRawBounded(compressed, expectedSize, signal) {
  if (typeof DecompressionStream !== "function") throw new Error("This browser cannot decompress DEFLATE ZIP entries; extract the folder first or use a current browser");
  throwIfAborted(signal);
  let stream;
  try {
    stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  } catch (error) {
    throw new Error(`This runtime cannot open DEFLATE ZIP entries: ${error.message || error}`);
  }
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > expectedSize) throw new Error("DEFLATE output exceeds the size declared by the ZIP central directory");
      chunks.push(chunk);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  }
  if (total !== expectedSize) throw new Error("DEFLATE output size differs from the ZIP central directory");
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function mimeFor(path) {
  const extension = path.toLowerCase().split(".").at(-1);
  return ({
    html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript", mjs: "text/javascript",
    json: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", webp: "image/webp", pdf: "application/pdf", txt: "text/plain", md: "text/markdown",
  })[extension] || "application/octet-stream";
}

function finalPaths(fileEntries) {
  const paths = fileEntries.map((entry) => entry.originalPath);
  const candidateRoot = paths[0]?.split("/")[0] || null;
  const retainsRoot = Boolean(candidateRoot) && paths.every((path) => path.startsWith(`${candidateRoot}/`));
  const rootName = retainsRoot ? candidateRoot : "imported-notes";
  return {
    rootName,
    rootWrapped: !retainsRoot,
    entries: fileEntries.map((entry) => ({ ...entry, path: retainsRoot ? entry.originalPath : `${rootName}/${entry.originalPath}` })),
  };
}

/** Import one bounded ZIP locally and return immutable File objects plus source evidence. */
export async function importHtmlNoteZip(source, { signal, limits: configured } = {}) {
  if (!source || typeof source !== "object" || !Number.isSafeInteger(source.size) || source.size < 0 || typeof source.arrayBuffer !== "function") throw new TypeError("ZIP import requires one File or Blob");
  const name = typeof source.name === "string" && source.name ? source.name : "imported-notes.zip";
  if (!/\.zip$/i.test(name)) throw new TypeError("ZIP import requires a .zip file");
  const limits = configuredLimits(configured);
  if (source.size > limits.maxArchiveBytes) throw new RangeError(`ZIP archive exceeds the ${limits.maxArchiveBytes} byte input limit`);
  throwIfAborted(signal);
  const bytes = new Uint8Array(await source.arrayBuffer());
  throwIfAborted(signal);
  if (bytes.byteLength !== source.size) throw new Error("ZIP archive size changed while it was being read");
  const parsed = parseCentralDirectory(bytes, limits);
  bindLocalRecords(bytes, parsed);
  const filesOnly = parsed.entries.filter((entry) => !entry.directory);
  if (!filesOnly.length) throw new Error("ZIP archive contains no files");
  const pathPlan = finalPaths(filesOnly);
  const imported = [];
  for (const entry of pathPlan.entries.sort((left, right) => compareText(left.path, right.path))) {
    throwIfAborted(signal);
    const compressed = bytes.subarray(entry.dataStart, entry.dataEnd);
    let content;
    if (entry.method === STORE_METHOD) {
      if (entry.compressedSize !== entry.uncompressedSize) throw new Error(`Stored ZIP entry has different compressed and uncompressed sizes: ${entry.originalPath}`);
      content = compressed.slice();
    } else content = await inflateRawBounded(compressed, entry.uncompressedSize, signal);
    const digest = await digestZipSource({ bytes: content }, { signal });
    if (digest.crc32 !== entry.checksum) throw new Error(`ZIP entry failed CRC32 verification: ${entry.originalPath}`);
    const filename = entry.path.split("/").at(-1);
    const file = new File([content], filename, { type: mimeFor(entry.path), lastModified: 0 });
    imported.push({
      path: entry.path,
      originalPath: entry.originalPath,
      file,
      method: entry.method === STORE_METHOD ? "store" : "deflate",
      compressedBytes: entry.compressedSize,
      bytes: entry.uncompressedSize,
      crc32Hex: digest.crc32Hex,
      sha256: digest.sha256,
    });
  }
  if (!imported.some((entry) => /\.html?$/i.test(entry.path))) throw new Error("ZIP archive contains no .html or .htm note");
  const archiveDigest = await digestZipSource({ bytes }, { signal });
  const methods = [...new Set(imported.map((entry) => entry.method))].sort(compareText);
  const importContract = {
    contract: "realitycheck-import-content-v1",
    entries: imported.map((entry) => ({ path: entry.path, bytes: entry.bytes, crc32Hex: entry.crc32Hex, sha256: entry.sha256 })),
  };
  const importDigest = await digestZipSource({ bytes: new TextEncoder().encode(JSON.stringify(importContract)) }, { signal });
  return {
    kind: "html-note-zip-import",
    schemaVersion: "1",
    source,
    files: imported.map((entry) => entry.file),
    fileEntries: imported.map((entry) => ({ path: entry.path, file: entry.file })),
    manifest: {
      archiveName: name,
      archiveBytes: bytes.byteLength,
      archiveSha256: archiveDigest.sha256,
      importContentId: `sha256:${importDigest.sha256}`,
      centralDirectoryEntriesOnly: true,
      importedFiles: imported.length,
      ignoredDirectories: parsed.entries.length - filesOnly.length,
      totalUncompressedBytes: parsed.totalUncompressedBytes,
      rootName: pathPlan.rootName,
      rootWrapped: pathPlan.rootWrapped,
      methods,
      entries: imported.map(({ file: _file, ...entry }) => entry),
      limits,
    },
  };
}

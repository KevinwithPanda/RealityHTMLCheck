const ZIP32_MAX = 0xffffffff;
const ZIP32_MAX_FILES = 0xffff;
const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;
const VERSION_20 = 20;
const FIXED_DOS_TIME = 0;
const FIXED_DOS_DATE = 0x0021; // 1980-01-01
const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const EOCD_BYTES = 22;
// Authoritative ZIP32 STORE implementation shared by the published CLI and
// the browser checker. Keep browser-facing compatibility in site/note-zip.mjs.
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export const DEFAULT_ZIP_LIMITS = Object.freeze({
  maxFiles: 5000,
  maxFileBytes: 32 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxArchiveBytes: 64 * 1024 * 1024,
});

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    table[value] = crc >>> 0;
  }
  return table;
})();

function abortError() {
  if (typeof DOMException === "function") return new DOMException("ZIP operation was aborted", "AbortError");
  const error = new Error("ZIP operation was aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

async function crc32(bytes, signal) {
  let crc = 0xffffffff;
  const chunkBytes = 1024 * 1024;
  for (let start = 0; start < bytes.byteLength; start += chunkBytes) {
    throwIfAborted(signal);
    const end = Math.min(bytes.byteLength, start + chunkBytes);
    for (let index = start; index < end; index += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[index]) & 0xff];
    if (end < bytes.byteLength) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throwIfAborted(signal);
  return (crc ^ 0xffffffff) >>> 0;
}

async function sha256Hex(bytes, signal) {
  throwIfAborted(signal);
  if (!globalThis.crypto?.subtle) throw new Error("SHA-256 is unavailable in this runtime");
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  throwIfAborted(signal);
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function checkedLimit(value, fallback, name, maximum) {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > maximum) {
    throw new RangeError(`${name} must be an integer from 0 to ${maximum}`);
  }
  return limit;
}

function normalizeArchivePath(value) {
  if (typeof value !== "string" || !value) throw new TypeError("ZIP entry path must be a non-empty string");
  if (value.includes("\\")) throw new Error(`ZIP entry path must use forward slashes: ${value}`);
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) throw new Error(`Absolute ZIP entry path is not allowed: ${value}`);
  if (value.endsWith("/")) throw new Error(`Directory ZIP entries are not allowed: ${value}`);
  if (/[\p{Cc}\p{Cf}]/u.test(value)) throw new Error("ZIP entry paths must not contain control, format, bidi, or zero-width characters");

  const segments = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") throw new Error(`Empty and dot path segments are not allowed in ZIP entries: ${value}`);
    if (segment === "..") throw new Error(`Parent traversal is not allowed in ZIP entry paths: ${value}`);
    if (/[<>:"|?*]/.test(segment)) throw new Error(`Windows-invalid ZIP entry path character is not allowed: ${segment}`);
    if (/[. ]$/.test(segment)) throw new Error(`ZIP entry path segments must not end in a dot or space: ${value}`);
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)) {
      throw new Error(`Windows-reserved ZIP entry path segment is not allowed: ${segment}`);
    }
    segments.push(segment);
  }
  if (!segments.length) throw new Error("ZIP entry path must identify a file");
  return segments.join("/");
}

/** Validate one portable file path using the same contract as generated ZIP entries. */
export function validatePortableZipEntryPath(value) {
  return normalizeArchivePath(value);
}

function sourceValue(entry) {
  const fields = ["bytes", "blob", "file"].filter((name) => Object.hasOwn(entry, name) && entry[name] !== undefined);
  if (fields.length !== 1) throw new TypeError("Each ZIP entry must provide exactly one of bytes, blob, or file");
  return entry[fields[0]];
}

function byteSource(value) {
  if (value instanceof ArrayBuffer) return { kind: "bytes", size: value.byteLength, value: new Uint8Array(value) };
  if (ArrayBuffer.isView(value)) return { kind: "bytes", size: value.byteLength, value: new Uint8Array(value.buffer, value.byteOffset, value.byteLength) };
  if (value && typeof value === "object" && Number.isSafeInteger(value.size) && value.size >= 0 && typeof value.arrayBuffer === "function") {
    return { kind: "blob", size: value.size, value };
  }
  throw new TypeError("ZIP entry content must be bytes, Blob, or File");
}

function preflight(entries, options) {
  if (!Array.isArray(entries)) throw new TypeError("ZIP entries must be an array");
  if (!entries.length) throw new Error("ZIP archive must contain at least one file");
  if (options?.encryption !== undefined || options?.encrypted === true) throw new Error("Encrypted ZIP entries are not supported");
  if (options?.compression !== undefined && options.compression !== "store" && options.compression !== STORE_METHOD) {
    throw new Error("Only ZIP STORE mode is supported");
  }
  const configured = options?.limits || {};
  const limits = {
    maxFiles: checkedLimit(configured.maxFiles, DEFAULT_ZIP_LIMITS.maxFiles, "maxFiles", ZIP32_MAX_FILES),
    maxFileBytes: checkedLimit(configured.maxFileBytes, DEFAULT_ZIP_LIMITS.maxFileBytes, "maxFileBytes", ZIP32_MAX),
    maxTotalBytes: checkedLimit(configured.maxTotalBytes, DEFAULT_ZIP_LIMITS.maxTotalBytes, "maxTotalBytes", ZIP32_MAX),
    maxArchiveBytes: checkedLimit(configured.maxArchiveBytes, DEFAULT_ZIP_LIMITS.maxArchiveBytes, "maxArchiveBytes", ZIP32_MAX),
  };
  if (entries.length > ZIP32_MAX_FILES) throw new RangeError("ZIP32 supports at most 65535 files");
  if (entries.length > limits.maxFiles) throw new RangeError(`ZIP file count exceeds the ${limits.maxFiles} file limit`);

  const seen = new Set();
  const seenNfc = new Map();
  const seenCaseFolded = new Map();
  const prepared = [];
  let totalBytes = 0;
  let localBytes = 0;
  let centralBytes = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") throw new TypeError("Each ZIP entry must be an object");
    if (entry.directory === true) throw new Error("Directory ZIP entries are not allowed");
    if (entry.encryption !== undefined || entry.encrypted === true) throw new Error("Encrypted ZIP entries are not supported");
    if (entry.compression !== undefined && entry.compression !== "store" && entry.compression !== STORE_METHOD) {
      throw new Error("Only ZIP STORE mode is supported");
    }
    const path = normalizeArchivePath(entry.path);
    if (seen.has(path)) throw new Error(`Duplicate normalized ZIP entry path: ${path}`);
    seen.add(path);
    const nfc = path.normalize("NFC");
    if (seenNfc.has(nfc)) throw new Error(`Unicode-normalized ZIP entry path collision: ${seenNfc.get(nfc)} and ${path}`);
    seenNfc.set(nfc, path);
    const caseFolded = nfc.toUpperCase().toLowerCase();
    if (seenCaseFolded.has(caseFolded)) {
      throw new Error(`Case-folded ZIP entry path collision: ${seenCaseFolded.get(caseFolded)} and ${path}`);
    }
    seenCaseFolded.set(caseFolded, path);
    if (path.length > ZIP32_MAX_FILES) throw new RangeError(`UTF-8 ZIP entry path is too long: ${path.slice(0, 80)}`);
    const nameBytes = encoder.encode(path);
    if (nameBytes.byteLength > ZIP32_MAX_FILES) throw new RangeError(`UTF-8 ZIP entry path is too long: ${path}`);
    const source = byteSource(sourceValue(entry));
    if (source.size > ZIP32_MAX) throw new RangeError(`ZIP32 file size limit exceeded: ${path}`);
    if (source.size > limits.maxFileBytes) throw new RangeError(`ZIP entry exceeds the ${limits.maxFileBytes} byte per-file limit: ${path}`);
    totalBytes += source.size;
    if (totalBytes > ZIP32_MAX) throw new RangeError("ZIP32 total uncompressed size limit exceeded");
    if (totalBytes > limits.maxTotalBytes) throw new RangeError(`ZIP content exceeds the ${limits.maxTotalBytes} byte total limit`);
    localBytes += LOCAL_HEADER_BYTES + nameBytes.byteLength + source.size;
    centralBytes += CENTRAL_HEADER_BYTES + nameBytes.byteLength;
    if (localBytes > ZIP32_MAX || centralBytes > ZIP32_MAX || localBytes + centralBytes + EOCD_BYTES > ZIP32_MAX) {
      throw new RangeError("ZIP32 archive layout limit exceeded");
    }
    prepared.push({ path, nameBytes, source, size: source.size, localOffset: 0 });
  }
  const filesByPortableKey = new Map(prepared.map((entry) => [entry.path.normalize("NFC").toUpperCase().toLowerCase(), entry.path]));
  for (const [key, path] of filesByPortableKey) {
    const segments = key.split("/");
    for (let length = 1; length < segments.length; length += 1) {
      const ancestor = segments.slice(0, length).join("/");
      if (filesByPortableKey.has(ancestor)) throw new Error(`ZIP file path is also used as a cross-platform directory prefix: ${filesByPortableKey.get(ancestor)} (ancestor of ${path})`);
    }
  }
  const archiveBytes = localBytes + centralBytes + EOCD_BYTES;
  if (archiveBytes > limits.maxArchiveBytes) throw new RangeError(`ZIP archive exceeds the ${limits.maxArchiveBytes} byte archive limit`);
  return { prepared, archiveBytes, centralOffset: localBytes, centralBytes };
}

async function readPreparedSource(source, expectedSize) {
  if (source.kind === "bytes") return new Uint8Array(source.value);
  const buffer = await source.value.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength !== expectedSize) throw new Error("Blob/File size changed while the ZIP was being created");
  return bytes;
}

function u16(view, offset, value) { view.setUint16(offset, value, true); }
function u32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

function writeLocalHeader(view, offset, entry, checksum) {
  u32(view, offset, 0x04034b50);
  u16(view, offset + 4, VERSION_20);
  u16(view, offset + 6, UTF8_FLAG);
  u16(view, offset + 8, STORE_METHOD);
  u16(view, offset + 10, FIXED_DOS_TIME);
  u16(view, offset + 12, FIXED_DOS_DATE);
  u32(view, offset + 14, checksum);
  u32(view, offset + 18, entry.size);
  u32(view, offset + 22, entry.size);
  u16(view, offset + 26, entry.nameBytes.byteLength);
  u16(view, offset + 28, 0);
}

function writeCentralHeader(view, offset, entry) {
  u32(view, offset, 0x02014b50);
  u16(view, offset + 4, VERSION_20);
  u16(view, offset + 6, VERSION_20);
  u16(view, offset + 8, UTF8_FLAG);
  u16(view, offset + 10, STORE_METHOD);
  u16(view, offset + 12, FIXED_DOS_TIME);
  u16(view, offset + 14, FIXED_DOS_DATE);
  u32(view, offset + 16, entry.crc32);
  u32(view, offset + 20, entry.size);
  u32(view, offset + 24, entry.size);
  u16(view, offset + 28, entry.nameBytes.byteLength);
  u16(view, offset + 30, 0);
  u16(view, offset + 32, 0);
  u16(view, offset + 34, 0);
  u16(view, offset + 36, 0);
  u32(view, offset + 38, 0);
  u32(view, offset + 42, entry.localOffset);
}

async function buildStoredZip(entries, options = {}) {
  const output = options.output ?? "blob";
  if (output !== "blob" && output !== "uint8array") throw new TypeError('output must be "blob" or "uint8array"');
  if (output === "blob" && typeof Blob !== "function") throw new Error("Blob output is unavailable in this runtime; request uint8array output");
  throwIfAborted(options.signal);
  const layout = preflight(entries, options);
  const archive = new Uint8Array(layout.archiveBytes);
  const view = new DataView(archive.buffer);
  let offset = 0;
  for (const entry of layout.prepared) {
    throwIfAborted(options.signal);
    const bytes = await readPreparedSource(entry.source, entry.size);
    throwIfAborted(options.signal);
    entry.localOffset = offset;
    entry.crc32 = await crc32(bytes, options.signal);
    entry.sha256 = await sha256Hex(bytes, options.signal);
    writeLocalHeader(view, offset, entry, entry.crc32);
    offset += LOCAL_HEADER_BYTES;
    archive.set(entry.nameBytes, offset);
    offset += entry.nameBytes.byteLength;
    archive.set(bytes, offset);
    offset += bytes.byteLength;
  }
  if (offset !== layout.centralOffset) throw new Error("ZIP local record layout mismatch");
  for (const entry of layout.prepared) {
    writeCentralHeader(view, offset, entry);
    offset += CENTRAL_HEADER_BYTES;
    archive.set(entry.nameBytes, offset);
    offset += entry.nameBytes.byteLength;
  }
  if (offset !== layout.centralOffset + layout.centralBytes) throw new Error("ZIP central directory layout mismatch");
  u32(view, offset, 0x06054b50);
  u16(view, offset + 4, 0);
  u16(view, offset + 6, 0);
  u16(view, offset + 8, layout.prepared.length);
  u16(view, offset + 10, layout.prepared.length);
  u32(view, offset + 12, layout.centralBytes);
  u32(view, offset + 16, layout.centralOffset);
  u16(view, offset + 20, 0);
  offset += EOCD_BYTES;
  if (offset !== archive.byteLength) throw new Error("ZIP end record layout mismatch");
  const manifest = {
    format: "zip32-store",
    modifiedAt: "1980-01-01T00:00:00.000Z",
    entries: layout.prepared.map((entry) => ({
      path: entry.path,
      size: entry.size,
      crc32: entry.crc32,
      crc32Hex: entry.crc32.toString(16).padStart(8, "0"),
      sha256: entry.sha256,
    })),
    files: layout.prepared.length,
    totalUncompressedBytes: layout.prepared.reduce((sum, entry) => sum + entry.size, 0),
    archiveBytes: archive.byteLength,
  };
  return {
    archive: output === "uint8array" ? archive : new Blob([archive], { type: "application/zip" }),
    manifest,
  };
}

/** Validate paths, source sizes, limits, and ZIP32 layout without reading Blob/File bytes. */
export function preflightStoredZip(entries, options = {}) {
  const layout = preflight(entries, options);
  return {
    files: layout.prepared.length,
    totalUncompressedBytes: layout.prepared.reduce((sum, entry) => sum + entry.size, 0),
    archiveBytes: layout.archiveBytes,
    entries: layout.prepared.map((entry) => ({ path: entry.path, size: entry.size })),
  };
}

/** Create a deterministic, dependency-free ZIP32 archive using STORE mode. */
export async function writeStoredZip(entries, options = {}) {
  return (await buildStoredZip(entries, options)).archive;
}

/** Create the archive plus an ordered CRC32/size manifest for review evidence. */
export async function writeStoredZipWithManifest(entries, options = {}) {
  return buildStoredZip(entries, options);
}

async function archiveBytes(value, signal) {
  throwIfAborted(signal);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value && typeof value.arrayBuffer === "function") {
    const bytes = new Uint8Array(await value.arrayBuffer());
    throwIfAborted(signal);
    return bytes;
  }
  throw new TypeError("ZIP verification requires bytes or a Blob");
}

/** Re-read the narrow ZIP32/STORE artifact and bind every central entry to its local bytes and expected manifest. */
export async function verifyStoredZip(value, expectedManifest = null, { signal } = {}) {
  const bytes = await archiveBytes(value, signal);
  if (bytes.byteLength < EOCD_BYTES) throw new Error("ZIP archive is too small");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const read16 = (offset) => view.getUint16(offset, true);
  const read32 = (offset) => view.getUint32(offset, true);
  const eocd = bytes.byteLength - EOCD_BYTES;
  if (read32(eocd) !== 0x06054b50 || read16(eocd + 4) !== 0 || read16(eocd + 6) !== 0 || read16(eocd + 20) !== 0) {
    throw new Error("ZIP end record is invalid or unsupported");
  }
  const files = read16(eocd + 10);
  if (read16(eocd + 8) !== files) throw new Error("Multi-disk ZIP archives are unsupported");
  const centralBytes = read32(eocd + 12);
  const centralOffset = read32(eocd + 16);
  if (centralOffset + centralBytes !== eocd) throw new Error("ZIP central directory boundary is invalid");
  let cursor = centralOffset;
  let previousLocalEnd = 0;
  const entries = [];
  const seenNfc = new Map();
  const seenCaseFolded = new Map();
  for (let index = 0; index < files; index += 1) {
    if (cursor + CENTRAL_HEADER_BYTES > eocd || read32(cursor) !== 0x02014b50) throw new Error("ZIP central entry is invalid");
    if (read16(cursor + 4) !== VERSION_20 || read16(cursor + 6) !== VERSION_20 || read16(cursor + 8) !== UTF8_FLAG || read16(cursor + 10) !== STORE_METHOD || read16(cursor + 12) !== FIXED_DOS_TIME || read16(cursor + 14) !== FIXED_DOS_DATE) {
      throw new Error("ZIP central version, flags, method, or timestamp differs from the fixed archive contract");
    }
    const checksum = read32(cursor + 16);
    const compressed = read32(cursor + 20);
    const size = read32(cursor + 24);
    const nameLength = read16(cursor + 28);
    const extraLength = read16(cursor + 30);
    const commentLength = read16(cursor + 32);
    const disk = read16(cursor + 34);
    const localOffset = read32(cursor + 42);
    if (compressed !== size || extraLength !== 0 || commentLength !== 0 || disk !== 0 || read16(cursor + 36) !== 0 || read32(cursor + 38) !== 0) throw new Error("ZIP central entry uses an unsupported feature or file attribute");
    if (cursor + CENTRAL_HEADER_BYTES + nameLength > eocd) throw new Error("ZIP central entry name is truncated");
    const path = decoder.decode(bytes.subarray(cursor + CENTRAL_HEADER_BYTES, cursor + CENTRAL_HEADER_BYTES + nameLength));
    if (normalizeArchivePath(path) !== path) throw new Error("ZIP entry path changed during verification");
    const nfc = path.normalize("NFC");
    if (seenNfc.has(nfc)) throw new Error(`Unicode-normalized ZIP entry collision during verification: ${seenNfc.get(nfc)} and ${path}`);
    seenNfc.set(nfc, path);
    const caseFolded = nfc.toUpperCase().toLowerCase();
    if (seenCaseFolded.has(caseFolded)) throw new Error(`Case-folded ZIP entry collision during verification: ${seenCaseFolded.get(caseFolded)} and ${path}`);
    seenCaseFolded.set(caseFolded, path);
    if (localOffset < previousLocalEnd || localOffset + LOCAL_HEADER_BYTES > centralOffset || read32(localOffset) !== 0x04034b50) {
      throw new Error("ZIP local entry boundary is invalid");
    }
    if (read16(localOffset + 4) !== VERSION_20 || read16(localOffset + 6) !== UTF8_FLAG || read16(localOffset + 8) !== STORE_METHOD || read16(localOffset + 10) !== FIXED_DOS_TIME || read16(localOffset + 12) !== FIXED_DOS_DATE || read32(localOffset + 14) !== checksum || read32(localOffset + 18) !== size || read32(localOffset + 22) !== size) {
      throw new Error("ZIP local entry does not match its central record");
    }
    const localNameLength = read16(localOffset + 26);
    const localExtraLength = read16(localOffset + 28);
    if (localNameLength !== nameLength || localExtraLength !== 0) throw new Error("ZIP local entry name or extra field is invalid");
    const localNameStart = localOffset + LOCAL_HEADER_BYTES;
    if (decoder.decode(bytes.subarray(localNameStart, localNameStart + localNameLength)) !== path) throw new Error("ZIP local and central paths differ");
    const dataStart = localNameStart + localNameLength;
    const dataEnd = dataStart + size;
    const data = bytes.subarray(dataStart, dataEnd);
    if (dataEnd > centralOffset || await crc32(data, signal) !== checksum) throw new Error(`ZIP entry bytes failed CRC verification: ${path}`);
    const sha256 = await sha256Hex(data, signal);
    previousLocalEnd = dataEnd;
    entries.push({ path, size, crc32: checksum, crc32Hex: checksum.toString(16).padStart(8, "0"), sha256 });
    cursor += CENTRAL_HEADER_BYTES + nameLength;
  }
  if (cursor !== eocd || previousLocalEnd !== centralOffset) throw new Error("ZIP record coverage is incomplete");
  const filesByPortableKey = new Map(entries.map((entry) => [entry.path.normalize("NFC").toUpperCase().toLowerCase(), entry.path]));
  for (const [key, path] of filesByPortableKey) {
    const segments = key.split("/");
    for (let length = 1; length < segments.length; length += 1) {
      const ancestor = segments.slice(0, length).join("/");
      if (filesByPortableKey.has(ancestor)) throw new Error(`ZIP file path is also used as a cross-platform directory prefix: ${filesByPortableKey.get(ancestor)} (ancestor of ${path})`);
    }
  }
  const manifest = {
    format: "zip32-store",
    modifiedAt: "1980-01-01T00:00:00.000Z",
    entries,
    files,
    totalUncompressedBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
    archiveBytes: bytes.byteLength,
  };
  if (expectedManifest && JSON.stringify(manifest) !== JSON.stringify(expectedManifest)) throw new Error("ZIP archive does not match the expected manifest");
  return manifest;
}

/** Re-read a verified RealityCheck STORE archive and return immutable entry bytes. */
export async function readStoredZipEntries(value, expectedManifest = null, { signal } = {}) {
  const bytes = await archiveBytes(value, signal);
  const manifest = await verifyStoredZip(bytes, expectedManifest, { signal });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.byteLength - EOCD_BYTES;
  const centralOffset = view.getUint32(eocd + 16, true);
  const entries = new Map();
  let offset = 0;
  while (offset < centralOffset) {
    throwIfAborted(signal);
    if (view.getUint32(offset, true) !== 0x04034b50) throw new Error("ZIP local record is invalid during entry read-back");
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + LOCAL_HEADER_BYTES;
    const dataStart = nameStart + nameLength + extraLength;
    const path = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    entries.set(path, bytes.slice(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  if (offset !== centralOffset || entries.size !== manifest.files) throw new Error("ZIP read-back entry coverage differs from the verified manifest");
  return { manifest, entries };
}

/** Read one bounded source and return byte-level evidence without retaining its content. */
export async function digestZipSource(entry, { signal } = {}) {
  if (!entry || typeof entry !== "object") throw new TypeError("ZIP source entry must be an object");
  const source = byteSource(sourceValue(entry));
  throwIfAborted(signal);
  const bytes = await readPreparedSource(source, source.size);
  throwIfAborted(signal);
  const checksum = await crc32(bytes, signal);
  return {
    size: source.size,
    crc32: checksum,
    crc32Hex: checksum.toString(16).padStart(8, "0"),
    sha256: await sha256Hex(bytes, signal),
  };
}

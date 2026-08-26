import { lstat, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";

import { extractHtmlNoteZip } from "./note-zip-import.mjs";

function abortError() {
  if (typeof DOMException === "function") return new DOMException("ZIP import was aborted", "AbortError");
  const error = new Error("ZIP import was aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

/** Node's bounded raw-DEFLATE adapter for the shared ZIP parser. */
export function inflateRawZipEntry(compressed, { expectedSize, signal } = {}) {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) throw new TypeError("expectedSize must be a non-negative safe integer");
  throwIfAborted(signal);
  let output;
  try {
    output = inflateRawSync(compressed, { maxOutputLength: Math.max(1, expectedSize + 1) });
  } catch (error) {
    if (error?.code === "ERR_BUFFER_TOO_LARGE" || /larger than|output length|buffer too large/i.test(String(error?.message || ""))) {
      throw new Error("DEFLATE output exceeds the size declared by the ZIP central directory");
    }
    throw new Error(`DEFLATE stream could not be decompressed: ${error?.message || error}`);
  }
  throwIfAborted(signal);
  return new Uint8Array(output.buffer, output.byteOffset, output.byteLength).slice();
}

function inputBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError("ZIP archive must be an ArrayBuffer or byte view");
}

/**
 * Node-facing byte API used by `note publish` input loading. Paths and content
 * are returned only after the shared central/local/CRC/SHA safety checks pass.
 */
export async function readPortableZipArchive(value, { signal, limits, name = "portable-input.zip" } = {}) {
  const bytes = inputBytes(value).slice();
  const extracted = await extractHtmlNoteZip({
    name,
    size: bytes.byteLength,
    async arrayBuffer() {
      throwIfAborted(signal);
      return bytes.buffer;
    },
  }, { signal, limits, inflateRaw: inflateRawZipEntry });
  return {
    entries: new Map(extracted.entries.map((entry) => [entry.path, entry.data.slice()])),
    manifest: extracted.manifest,
  };
}

/**
 * Read and strictly extract one regular STORE/DEFLATE ZIP from disk without
 * relying on browser File or DecompressionStream globals.
 */
export async function extractHtmlNoteZipFile(input, { signal, limits } = {}) {
  if (typeof input !== "string" || !input) throw new TypeError("ZIP input path must be a non-empty string");
  const path = resolve(input);
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("ZIP input must be a regular file, not a symbolic link or special file");
  const source = {
    name: basename(path),
    size: stat.size,
    async arrayBuffer() {
      throwIfAborted(signal);
      const bytes = await readFile(path);
      throwIfAborted(signal);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
  return extractHtmlNoteZip(source, { signal, limits, inflateRaw: inflateRawZipEntry });
}

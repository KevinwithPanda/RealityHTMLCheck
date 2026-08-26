import { deflateRawSync } from "node:zlib";

const encoder = new TextEncoder();
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

function concat(parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

/** Build one deterministic UTF-8 ZIP32 fixture using raw DEFLATE method 8. */
export function buildBrowserDeflateZipFixture(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new TypeError("fixture entries are required");
  const locals = [];
  const central = [];
  let localOffset = 0;
  for (const entry of entries) {
    const path = encoder.encode(entry.path);
    const content = entry.bytes instanceof Uint8Array ? entry.bytes : encoder.encode(String(entry.text ?? ""));
    const compressed = new Uint8Array(deflateRawSync(content));
    const checksum = crc32(content);
    const local = new Uint8Array(30 + path.byteLength + compressed.byteLength);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 8, true);
    localView.setUint16(12, 0x0021, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, compressed.byteLength, true);
    localView.setUint32(22, content.byteLength, true);
    localView.setUint16(26, path.byteLength, true);
    local.set(path, 30);
    local.set(compressed, 30 + path.byteLength);

    const record = new Uint8Array(46 + path.byteLength);
    const centralView = new DataView(record.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 8, true);
    centralView.setUint16(14, 0x0021, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, compressed.byteLength, true);
    centralView.setUint32(24, content.byteLength, true);
    centralView.setUint16(28, path.byteLength, true);
    centralView.setUint32(42, localOffset, true);
    record.set(path, 46);
    locals.push(local);
    central.push(record);
    localOffset += local.byteLength;
  }
  const centralBytes = concat(central);
  const eocd = new Uint8Array(22);
  const view = new DataView(eocd.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entries.length, true);
  view.setUint16(10, entries.length, true);
  view.setUint32(12, centralBytes.byteLength, true);
  view.setUint32(16, localOffset, true);
  return concat([...locals, centralBytes, eocd]);
}

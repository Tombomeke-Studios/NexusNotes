/**
 * Minimal store-only (uncompressed) ZIP writer (#152). Dependency-free so
 * vault exports work fully client-side — essential for e2ee vaults, whose
 * plaintext only ever exists in this process. Store-only is fine: markdown
 * is small, and every unzip tool accepts method 0.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Forward-slash relative path inside the archive. */
  path: string;
  /** Text is stored as UTF-8; bytes (an attachment, #550) as they are. */
  content: string | Uint8Array;
}

/**
 * Without ZIP64 the entry count is a 16-bit field and sizes and offsets are
 * 32-bit, so a larger archive would come out corrupt; buildZip refuses it.
 */
export const ZIP_MAX_ENTRIES = 0xffff;
export const ZIP_MAX_BYTES = 0xffffffff;

/** The entries don't fit one zip without ZIP64; the message says so in plain words. */
export class ZipTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipTooLargeError";
  }
}

const formatGB = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/** Throws ZipTooLargeError when an archive of this many entries and bytes can't be written. */
export function checkZipLimits(entries: number, bytes: number): void {
  if (entries <= ZIP_MAX_ENTRIES && bytes <= ZIP_MAX_BYTES) return;
  throw new ZipTooLargeError(
    `The export is too large for one zip file: a zip holds at most 65,535 files and 4 GB, ` +
      `and this one has ${entries.toLocaleString("en-US")} files and ${formatGB(bytes)}.`,
  );
}

/** DOS date/time fields for the given moment (zip's timestamp format). */
function dosDateTime(d: Date): { date: number; time: number } {
  return {
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  };
}

/**
 * Builds a complete ZIP archive from text (stored as UTF-8) and byte entries.
 * Throws ZipTooLargeError, before writing anything, when they don't fit.
 */
export function buildZip(entries: ZipEntry[], now: Date = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const { date, time } = dosDateTime(now);
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const encoded = entries.map((entry) => ({
    name: encoder.encode(entry.path),
    data: typeof entry.content === "string" ? encoder.encode(entry.content) : entry.content,
  }));
  // Local header (30) + name + data, central header (46) + name, end record (22).
  const archiveBytes = encoded.reduce((n, e) => n + 76 + 2 * e.name.length + e.data.length, 22);
  checkZipLimits(entries.length, archiveBytes);

  const u16 = (v: number) => [v & 0xff, (v >>> 8) & 0xff];
  const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

  for (const { name, data } of encoded) {
    const crc = crc32(data);

    // Local file header: signature, version, flags (bit 11 = UTF-8 names),
    // method 0 (store), timestamp, crc, sizes, name length, extra length.
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(time), ...u16(date), ...u32(crc),
      ...u32(data.length), ...u32(data.length),
      ...u16(name.length), ...u16(0),
    ]);
    chunks.push(local, name, data);

    const centralHeader = new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(time), ...u16(date), ...u32(crc),
      ...u32(data.length), ...u32(data.length),
      ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offset),
    ]);
    central.push(centralHeader, name);
    offset += local.length + name.length + data.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(centralSize), ...u32(offset), ...u16(0),
  ]);

  const total = offset + centralSize + end.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const chunk of [...chunks, ...central, end]) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}

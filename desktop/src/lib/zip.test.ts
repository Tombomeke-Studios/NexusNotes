import { describe, it, expect } from "vitest";
import { buildZip, crc32 } from "./zip";

describe("crc32", () => {
  it("matches well-known reference vectors", () => {
    const cases: Array<[string, number]> = [
      ["", 0x00000000],
      ["a", 0xe8b7be43],
      ["abc", 0x352441c2],
      ["hello world", 0x0d4a1185],
      ["123456789", 0xcbf43926],
    ];
    for (const [input, want] of cases) {
      expect(crc32(new TextEncoder().encode(input))).toBe(want);
    }
  });
});

describe("buildZip", () => {
  const entries = [
    { path: "Welcome.md", content: "# Welcome\n" },
    { path: "Folder/Nested note.md", content: "nested unicode ünïcode" },
  ];

  it("produces the zip signatures and central directory", () => {
    const zip = buildZip(entries);
    const u32 = (o: number) => zip[o] | (zip[o + 1] << 8) | (zip[o + 2] << 16) | ((zip[o + 3] << 24) >>> 0);
    expect(u32(0)).toBe(0x04034b50); // local file header
    // End-of-central-directory record sits at the tail (no comment).
    expect(u32(zip.length - 22)).toBe(0x06054b50);
    expect(zip[zip.length - 22 + 10]).toBe(entries.length); // total entries
  });

  it("stores contents verbatim with correct CRCs (store method)", () => {
    const zip = buildZip(entries);
    const text = new TextDecoder().decode(zip);
    // Store-only: file bytes appear literally in the archive.
    expect(text).toContain("# Welcome");
    expect(text).toContain("Folder/Nested note.md");
    // CRC of the first entry sits at offset 14 of its local header.
    const crc = zip[14] | (zip[15] << 8) | (zip[16] << 16) | ((zip[17] << 24) >>> 0);
    expect(crc).toBe(crc32(new TextEncoder().encode("# Welcome\n")));
  });

  it("records UTF-8 byte sizes, not string lengths", () => {
    const zip = buildZip([{ path: "u.md", content: "héé" }]); // 5 UTF-8 bytes
    const size = zip[18] | (zip[19] << 8);
    expect(size).toBe(5);
  });
});

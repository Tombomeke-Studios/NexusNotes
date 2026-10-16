import { describe, it, expect } from "vitest";
import {
  stripFrontmatter,
  safeFilename,
  noteBodyToHtml,
  noteToHtmlDocument,
  vaultToZipEntries,
  vaultToZip,
  collectAttachments,
  describeExport,
  describeExportError,
} from "./export";
import { ZipTooLargeError } from "./zip";
import type { Note } from "./types";

const note = (id: string, title: string, path: string, content = ""): Note => ({
  id,
  vault_id: "v1",
  path,
  title,
  content,
  checksum: "",
  created_at: "",
  updated_at: "",
});

describe("stripFrontmatter", () => {
  it("removes a leading YAML block", () => {
    expect(stripFrontmatter("---\ntitle: X\ntags: [a]\n---\n# Body")).toBe("# Body");
  });

  it("leaves content without front-matter untouched (including --- rules later)", () => {
    const md = "# Body\n\n---\n\nafter a rule";
    expect(stripFrontmatter(md)).toBe(md);
  });
});

describe("safeFilename", () => {
  it("replaces path and reserved characters", () => {
    expect(safeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe("a_b_c_d_e_f_g_h_i_j");
  });

  it("falls back for empty titles", () => {
    expect(safeFilename("  ")).toBe("Untitled");
  });

  it("preserves spaces and hyphens in ordinary titles", () => {
    expect(safeFilename("Meeting Notes - Q3")).toBe("Meeting Notes - Q3");
  });
});

describe("noteBodyToHtml / noteToHtmlDocument", () => {
  it("renders markdown (incl. GFM tables) to HTML", () => {
    const html = noteBodyToHtml("# Hi\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<h1>Hi</h1>");
    expect(html).toContain("<table>");
  });

  it("strips front-matter before rendering", () => {
    expect(noteBodyToHtml("---\ntags: [x]\n---\n**bold**")).toContain("<strong>bold</strong>");
  });

  it("produces a standalone document with the escaped title", () => {
    const doc = noteToHtmlDocument({ title: "<Script> & co", content: "hello" });
    expect(doc).toContain("<!doctype html>");
    expect(doc).toContain("<title>&lt;Script&gt; &amp; co</title>");
    expect(doc).toContain("hello");
  });
});

describe("vaultToZipEntries", () => {
  it("nests notes by folder path and appends .md", () => {
    const entries = vaultToZipEntries([
      note("1", "Welcome", ""),
      note("2", "Meeting", "Work/2026"),
    ]);
    expect(entries.map((e) => e.path)).toEqual(["Welcome.md", "Work/2026/Meeting.md"]);
  });

  it("suffixes case-insensitive title collisions within a folder", () => {
    const entries = vaultToZipEntries([
      note("1", "Plan", "A"),
      note("2", "plan", "A"),
      note("3", "Plan", "B"),
    ]);
    expect(entries.map((e) => e.path)).toEqual(["A/Plan.md", "A/plan 2.md", "B/Plan.md"]);
  });
});

describe("vault zip attachments (#550)", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);
  const text = (c: string | Uint8Array) => (typeof c === "string" ? c : new TextDecoder().decode(c));

  it("puts each attachment next to its note, where ![[name]] resolves", () => {
    const entries = vaultToZipEntries(
      [note("1", "Trip", "Travel", "![[beach.png]]"), note("2", "Home", "", "[[scan.pdf]]")],
      [
        { noteId: "1", name: "beach.png", bytes: bytes("png") },
        { noteId: "2", name: "scan.pdf", bytes: bytes("pdf") },
      ],
    );
    expect(entries.map((e) => [e.path, text(e.content)])).toEqual([
      ["Travel/Trip.md", "![[beach.png]]"],
      ["Home.md", "[[scan.pdf]]"],
      ["Travel/beach.png", "png"],
      ["scan.pdf", "pdf"],
    ]);
  });

  it("stores the same file once and moves a different one of the same name, relinking only its note", () => {
    const entries = vaultToZipEntries(
      [
        note("1", "A", "", "![[pic.png]]"),
        note("2", "B", "", "![[pic.png]]"),
        note("3", "C", "", "![[pic.png|300]] and [[pic.png#x]] but not [[pic.png.md]]"),
      ],
      [
        { noteId: "1", name: "pic.png", bytes: bytes("one") },
        { noteId: "2", name: "pic.png", bytes: bytes("one") },
        { noteId: "3", name: "pic.png", bytes: bytes("two") },
      ],
    );
    expect(entries.map((e) => [e.path, text(e.content)])).toEqual([
      ["A.md", "![[pic.png]]"],
      ["B.md", "![[pic.png]]"],
      ["C.md", "![[C files/pic.png|300]] and [[C files/pic.png#x]] but not [[pic.png.md]]"],
      ["pic.png", "one"],
      ["C files/pic.png", "two"],
    ]);
  });

  it("numbers clashes inside a note's own folder and makes names safe", () => {
    const entries = vaultToZipEntries(
      [note("1", "N", "", "![[a:b.png]] ![[x.png]]")],
      [
        { noteId: "1", name: "x.png", bytes: bytes("1") },
        { noteId: "1", name: "x.png", bytes: bytes("2") },
        { noteId: "1", name: "a:b.png", bytes: bytes("3") },
      ],
    );
    expect(entries.map((e) => e.path)).toEqual(["N.md", "x.png", "N files/x.png", "a_b.png"]);
    expect(text(entries[0].content)).toBe("![[a_b.png]] ![[N files/x.png]]");
  });

  it("writes the bytes into the zip as they are", () => {
    const zip = vaultToZip([note("1", "N", "")], new Date(2026, 0, 1), [
      { noteId: "1", name: "b.bin", bytes: new Uint8Array([0, 255, 1, 254]) },
    ]);
    const tail = Array.from(zip.subarray(0, 120));
    expect(tail.join(",")).toContain("0,255,1,254");
  });
});

describe("describeExport (#550)", () => {
  it("counts the files and names the ones that failed", () => {
    expect(describeExport("Work", 0, [])).toEqual({ message: "Exported “Work” as a zip.", kind: "success" });
    expect(describeExport("Work", 1, []).message).toBe("Exported “Work” as a zip with 1 attached file.");
    expect(describeExport("Work", 3, ["a.png", "b.pdf"])).toEqual({
      message: "Exported “Work” as a zip with 3 attached files. Not included (download failed): a.png, b.pdf.",
      kind: "error",
    });
    expect(describeExport("W", 0, ["1", "2", "3", "4", "5", "6"]).message).toContain("1, 2, 3, 4, 5 and 1 more.");
  });
});

describe("describeExportError", () => {
  it("passes the zip limit message on as it is", () => {
    const err = new ZipTooLargeError("The export is too large for one zip file.");
    expect(describeExportError("Work", err)).toBe("The export is too large for one zip file.");
  });

  it("says when the vault is too large to build in memory", () => {
    expect(describeExportError("Work", new RangeError("Array buffer allocation failed"))).toBe(
      "Couldn't export “Work”: it is too large to build in memory.",
    );
  });

  it("names any other failure", () => {
    expect(describeExportError("Work", new Error("Network down"))).toBe("Couldn't export “Work”: Network down.");
    expect(describeExportError("Work", "?")).toBe("Couldn't export “Work”: something went wrong.");
  });
});

describe("collectAttachments (#550)", () => {
  const notes = [note("1", "One", ""), note("2", "Two", ""), note("3", "Three", "")];

  it("downloads every note's attachments in note order and reports progress", async () => {
    const progress: number[] = [];
    const { attachments, failed } = await collectAttachments(notes, {
      list: async (id) => (id === "2" ? [] : [{ filename: `${id}.png` }, { filename: `${id}.pdf` }]),
      read: async (att) => new TextEncoder().encode(att.filename),
      onProgress: (done) => progress.push(done),
    });
    expect(attachments.map((a) => [a.noteId, a.name])).toEqual([
      ["1", "1.png"],
      ["1", "1.pdf"],
      ["3", "3.png"],
      ["3", "3.pdf"],
    ]);
    expect(failed).toEqual([]);
    expect(progress.sort()).toEqual([1, 2, 3]);
  });

  it("names what it could not download instead of skipping it", async () => {
    const { attachments, failed } = await collectAttachments(notes, {
      list: async (id) => {
        if (id === "3") throw new Error("offline");
        return [{ filename: `ok-${id}.png` }, { filename: `broken-${id}.png` }];
      },
      read: async (att) => {
        if (att.filename.startsWith("broken")) throw new Error("404");
        return new Uint8Array([1]);
      },
    });
    expect(attachments.map((a) => a.name)).toEqual(["ok-1.png", "ok-2.png"]);
    expect(failed).toEqual(["broken-1.png", "broken-2.png", "the files of “Three”"]);
  });
});

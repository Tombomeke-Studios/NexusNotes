import { describe, it, expect } from "vitest";
import {
  stripFrontmatter,
  safeFilename,
  noteBodyToHtml,
  noteToHtmlDocument,
  vaultToZipEntries,
} from "./export";
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

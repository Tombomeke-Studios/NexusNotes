import { describe, it, expect } from "vitest";
import { searchDecryptedNotes } from "./clientSearch";
import type { Note } from "./types";

const note = (id: string, title: string, content: string): Note => ({
  id,
  vault_id: "v1",
  path: "",
  title,
  content,
  checksum: "x",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
});

const notes = [
  note("n1", "Groceries", "Buy milk and #errand bread"),
  note("n2", "Milk research", "A note about cows"),
  note("n3", "Diary", "Today I drank milk twice #daily"),
];

describe("searchDecryptedNotes", () => {
  it("matches content and title, ranking title matches first", () => {
    const hits = searchDecryptedNotes(notes, "milk", "");
    expect(hits.map((h) => h.id)).toEqual(["n2", "n1", "n3"]);
  });

  it("builds an HTML-escaped snippet with the match emphasised", () => {
    const dangerous = [note("n1", "XSS", 'before <img src=x onerror=alert(1)> milk after')];
    const [hit] = searchDecryptedNotes(dangerous, "milk", "");
    expect(hit.snippet).toContain("<em>milk</em>");
    expect(hit.snippet).not.toContain("<img");
    expect(hit.snippet).toContain("&lt;img");
  });

  it("filters by tag, with or without the # prefix", () => {
    expect(searchDecryptedNotes(notes, "", "#errand").map((h) => h.id)).toEqual(["n1"]);
    expect(searchDecryptedNotes(notes, "milk", "daily").map((h) => h.id)).toEqual(["n3"]);
  });

  it("returns nothing for an empty query and tag, and respects the limit", () => {
    expect(searchDecryptedNotes(notes, "", "")).toEqual([]);
    expect(searchDecryptedNotes(notes, "milk", "", 2)).toHaveLength(2);
  });

  it("exposes the note's tags on each hit like the server search does", () => {
    const [hit] = searchDecryptedNotes(notes, "", "errand");
    expect(hit.tags).toContain("errand");
  });
});

import { describe, it, expect } from "vitest";
import { extractLinks, buildGraphData } from "./wikilinks";
import type { Note } from "./types";

function makeNote(overrides: Partial<Note>): Note {
  return {
    id: "1",
    vault_id: "v1",
    path: "",
    title: "Test",
    content: "",
    checksum: "",
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("extractLinks", () => {
  it("extracts wiki links from content", () => {
    expect(extractLinks("See [[My Note]] for details")).toEqual(["My Note"]);
  });

  it("handles multiple links", () => {
    expect(extractLinks("[[A]] and [[B]] and [[C]]")).toEqual(["A", "B", "C"]);
  });

  it("ignores section links but extracts note name", () => {
    expect(extractLinks("[[Note#Section]]")).toEqual(["Note"]);
  });

  it("handles alias syntax", () => {
    expect(extractLinks("[[Note|display text]]")).toEqual(["Note"]);
  });

  it("returns empty for no links", () => {
    expect(extractLinks("Just plain text")).toEqual([]);
  });

  it("deduplicates", () => {
    expect(extractLinks("[[A]] then [[A]] again")).toEqual(["A"]);
  });
});

describe("buildGraphData", () => {
  it("builds nodes and links from notes", () => {
    const notes = [
      makeNote({ id: "1", title: "Note A", content: "Links to [[Note B]]" }),
      makeNote({ id: "2", title: "Note B", content: "Links to [[Note A]]" }),
      makeNote({ id: "3", title: "Orphan", content: "No links" }),
    ];
    const graph = buildGraphData(notes);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.links).toHaveLength(1);
    expect(graph.nodes.find((n) => n.id === "3")?.connections).toBe(0);
    expect(graph.nodes.find((n) => n.id === "1")?.connections).toBe(1);
  });

  it("returns empty for no notes", () => {
    const graph = buildGraphData([]);
    expect(graph.nodes).toEqual([]);
    expect(graph.links).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { extractLinks, buildGraphData, findGraphNode, localGraph, isAttachmentName } from "./wikilinks";
import type { GraphNode } from "./wikilinks";
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

  it("carries tags and the last update for the hover tooltip (#407)", () => {
    const notes = [makeNote({ id: "1", title: "A", content: "#work note #ideas", updated_at: "2026-10-01T10:00:00Z" })];
    const [node] = buildGraphData(notes).nodes;
    expect(node.tags).toEqual(["work", "ideas"]);
    expect(node.updatedAt).toBe("2026-10-01T10:00:00Z");
  });

  it("lists the vault's top-level folders, sorted, without root (#593)", () => {
    const notes = [
      makeNote({ id: "1", title: "A", path: "Examples" }),
      makeNote({ id: "2", title: "B", path: "Daily/2026" }),
      makeNote({ id: "3", title: "C", path: "" }),
      makeNote({ id: "4", title: "D", path: "Examples/Deep" }),
      makeNote({ id: "5", title: "E", path: "archive" }),
    ];
    expect(buildGraphData(notes).folders).toEqual(["archive", "Daily", "Examples"]);
  });

  it("returns empty for no notes", () => {
    const graph = buildGraphData([]);
    expect(graph.nodes).toEqual([]);
    expect(graph.links).toEqual([]);
  });

  it("emits a dashed ghost node for an unresolved link (#147)", () => {
    const notes = [makeNote({ id: "1", title: "A", content: "See [[Missing Note]]" })];
    const graph = buildGraphData(notes);

    const ghost = graph.nodes.find((n) => n.ghost);
    expect(ghost).toBeDefined();
    expect(ghost!.title).toBe("Missing Note"); // original casing kept for create-on-click
    expect(graph.links).toEqual([{ source: "1", target: ghost!.id, ghost: true }]);
    // The unresolved link still counts as a connection on both ends.
    expect(graph.nodes.find((n) => n.id === "1")?.connections).toBe(1);
    expect(ghost!.connections).toBe(1);
  });

  it("notes referencing the same missing title share one ghost", () => {
    const notes = [
      makeNote({ id: "1", title: "A", content: "[[missing note]]" }),
      makeNote({ id: "2", title: "B", content: "[[Missing Note]]" }),
    ];
    const graph = buildGraphData(notes);
    const ghosts = graph.nodes.filter((n) => n.ghost);
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0].connections).toBe(2);
    expect(graph.links.filter((l) => l.ghost)).toHaveLength(2);
  });

  it("resolved links never create ghosts", () => {
    const notes = [
      makeNote({ id: "1", title: "A", content: "[[B]]" }),
      makeNote({ id: "2", title: "B", content: "" }),
    ];
    const graph = buildGraphData(notes);
    expect(graph.nodes.some((n) => n.ghost)).toBe(false);
    expect(graph.links).toEqual([{ source: "1", target: "2" }]);
  });

  it("tags each node with its top-level folder", () => {
    const notes = [
      makeNote({ id: "1", title: "A", path: "" }),
      makeNote({ id: "2", title: "B", path: "Work/Sub" }),
    ];
    const graph = buildGraphData(notes);
    expect(graph.nodes.find((n) => n.id === "1")?.folder).toBe("");
    expect(graph.nodes.find((n) => n.id === "2")?.folder).toBe("Work");
  });
});

describe("findGraphNode (#146)", () => {
  const node = (id: string, title: string, connections = 0, ghost = false): GraphNode => ({
    id,
    title,
    connections,
    folder: "",
    ...(ghost ? { ghost } : {}),
  });

  it("prefers a prefix match over a substring match", () => {
    const nodes = [node("1", "My Projects"), node("2", "Project Ideas")];
    expect(findGraphNode(nodes, "proj")?.id).toBe("2");
  });

  it("falls back to substring matches, breaking ties by connections", () => {
    const nodes = [node("1", "Side quests", 1), node("2", "Conquest log", 5)];
    expect(findGraphNode(nodes, "quest")?.id).toBe("2");
  });

  it("prefers a real note over a ghost with the same title shape", () => {
    const nodes = [node("ghost:x", "Roadmap", 3, true), node("1", "Roadmap 2026", 0)];
    expect(findGraphNode(nodes, "roadmap")?.id).toBe("1");
  });

  it("is case-insensitive and returns null for no match or empty query", () => {
    const nodes = [node("1", "Reading List")];
    expect(findGraphNode(nodes, "READING")?.id).toBe("1");
    expect(findGraphNode(nodes, "zzz")).toBeNull();
    expect(findGraphNode(nodes, "  ")).toBeNull();
  });
});

describe("localGraph (#144)", () => {
  // A - B - C - D chain plus E orphan and a ghost off B.
  const data = buildGraphData([
    { id: "a", vault_id: "v", path: "", title: "A", content: "[[B]]", checksum: "", created_at: "", updated_at: "" },
    { id: "b", vault_id: "v", path: "", title: "B", content: "[[C]] [[Ghosty]]", checksum: "", created_at: "", updated_at: "" },
    { id: "c", vault_id: "v", path: "", title: "C", content: "[[D]]", checksum: "", created_at: "", updated_at: "" },
    { id: "d", vault_id: "v", path: "", title: "D", content: "", checksum: "", created_at: "", updated_at: "" },
    { id: "e", vault_id: "v", path: "", title: "E", content: "", checksum: "", created_at: "", updated_at: "" },
  ]);

  it("depth 1 keeps the note and its direct neighbours (ghosts included)", () => {
    const local = localGraph(data, "b", 1);
    expect(local.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c", "ghost:ghosty"]);
    expect(local.links).toHaveLength(3);
  });

  it("depth expands hop by hop and links stay within the subset", () => {
    const d1 = localGraph(data, "a", 1);
    expect(d1.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    const d2 = localGraph(data, "a", 2);
    expect(d2.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c", "ghost:ghosty"]);
    // The C-D link is outside depth 2 from A.
    expect(d2.links.every((l) => l.target !== "d" && l.source !== "d")).toBe(true);
  });

  it("keeps the whole vault's folders so the local graph colours them like the full graph (#593)", () => {
    const vault = buildGraphData([
      { id: "a", vault_id: "v", path: "Work", title: "A", content: "[[B]]", checksum: "", created_at: "", updated_at: "" },
      { id: "b", vault_id: "v", path: "Daily/2026", title: "B", content: "", checksum: "", created_at: "", updated_at: "" },
      { id: "c", vault_id: "v", path: "Archive", title: "C", content: "", checksum: "", created_at: "", updated_at: "" },
    ]);
    expect(localGraph(vault, "a", 1).folders).toEqual(["Archive", "Daily", "Work"]);
  });

  it("an unlinked note yields just itself; an unknown id yields nothing", () => {
    expect(localGraph(data, "e", 3).nodes.map((n) => n.id)).toEqual(["e"]);
    expect(localGraph(data, "nope", 3).nodes).toEqual([]);
  });
});

// Links written as code are shown as code, not followed (#454).
describe("extractLinks and attachments (#565)", () => {
  it("does not read embeds or links to attached files as note links", () => {
    const content =
      "![[beach.png]] ![[photo.JPG|300]] ![[Diagram]] [[report.pdf]] [[assets/song.mp3|listen]] [[Real note]] [[v2.0 plan]]";
    expect(extractLinks(content)).toEqual(["Real note", "v2.0 plan"]);
  });

  it("leaves no ghost nodes for attachments in the graph", () => {
    const notes = [
      { id: "1", title: "Trip", content: "![[beach.png]] and [[itinerary.pdf]] and [[Packing]]" },
      { id: "2", title: "Packing", content: "" },
    ].map(makeNote);
    const graph = buildGraphData(notes);
    expect(graph.nodes.map((n) => n.title).sort()).toEqual(["Packing", "Trip"]);
    expect(graph.nodes.some((n) => n.ghost)).toBe(false);
  });

  it("recognises attachment names by extension", () => {
    expect(isAttachmentName("a/b/Scan.PDF")).toBe(true);
    expect(isAttachmentName("Meeting 2026.10.15")).toBe(false);
    expect(isAttachmentName(".png")).toBe(false);
    expect(isAttachmentName("Notes")).toBe(false);
  });
});

describe("extractLinks and code", () => {
  it("ignores links inside code spans and fenced blocks", () => {
    const content =
      "Type `[[Inline]]` to link, or ``[[Double]]``.\n\n```md\n[[Fenced]]\n```\n\n~~~\n[[Tilde]]\n~~~\n\nA real [[Target]] and `unclosed [[Also real]]";
    expect(extractLinks(content)).toEqual(["Target", "Also real"]);
  });

  it("keeps a fence that is never closed as text", () => {
    expect(extractLinks("```\n[[Still a link]]")).toEqual(["Still a link"]);
  });
});

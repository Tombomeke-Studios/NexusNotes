import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPrefs, savePrefs } from "../../lib/prefs";
import type { GraphData } from "../../lib/wikilinks";
import { GraphView } from "./GraphView";

const empty: GraphData = { nodes: [], links: [] };
const twoNotes: GraphData = {
  nodes: [
    { id: "a", title: "Alpha", connections: 1, folder: "" },
    { id: "b", title: "Beta", connections: 1, folder: "Work" },
  ],
  links: [{ source: "a", target: "b" }],
} as GraphData;

function renderGraph(data: GraphData) {
  return render(<GraphView data={data} activeNoteId={null} onSelectNote={vi.fn()} />);
}

describe("GraphView", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("hides the zoom bar when there is nothing to graph", () => {
    renderGraph(empty);
    expect(screen.queryByRole("group", { name: "Zoom" })).toBeNull();
  });

  it("shows the zoom bar once there are notes", () => {
    renderGraph(twoNotes);
    expect(screen.getByRole("group", { name: "Zoom" })).toBeInTheDocument();
  });

  it("keeps the legend and zoom bar in one wrapping row so they never overlap", () => {
    const { container } = renderGraph(twoNotes);
    const row = container.querySelector(".graph-bottom");
    expect(row).not.toBeNull();
    expect(row!.querySelector(".graph-legend")).not.toBeNull();
    expect(row!.querySelector(".graph-zoom")).not.toBeNull();
  });

  it("remembers the Curved and Arrows choices", () => {
    renderGraph(twoNotes);
    fireEvent.click(screen.getByRole("button", { name: "Curved" }));
    fireEvent.click(screen.getByRole("button", { name: "Arrows" }));
    expect(loadPrefs().graphCurved).toBe(true);
    expect(loadPrefs().graphArrows).toBe(true);
  });

  it("starts with the saved link style", () => {
    savePrefs({ graphCurved: true, graphArrows: false });
    renderGraph(twoNotes);
    expect(screen.getByRole("button", { name: "Curved" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Arrows" })).toHaveAttribute("aria-pressed", "false");
  });
});

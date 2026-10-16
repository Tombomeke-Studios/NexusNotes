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

  it("puts the search box, then the toolbar, then the tip in one top row that wraps (#580)", () => {
    const { container } = renderGraph(twoNotes);
    const top = container.querySelector(".graph-top");
    expect(top).not.toBeNull();
    const row = top!.querySelector(".graph-top-row");
    expect(row).not.toBeNull();
    // Search first, so on a narrow pane the toolbar wraps below it.
    expect([...row!.children].map((el) => el.className.split(" ")[0])).toEqual(["graph-search", "graph-controls"]);
    // The tip follows the row instead of sitting at a fixed offset under it.
    expect(top!.lastElementChild).toHaveClass("graph-tip");
  });

  it("colours each folder of the vault differently, legend included (#593)", () => {
    const { container } = renderGraph({
      nodes: [
        { id: "a", title: "Alpha", connections: 0, folder: "Examples" },
        { id: "b", title: "Beta", connections: 0, folder: "Daily" },
        { id: "c", title: "Gamma", connections: 0, folder: "Templates" },
      ],
      links: [],
    });
    const legend = [...container.querySelectorAll(".graph-legend-item")].map((item) => [
      item.textContent,
      (item.querySelector(".graph-legend-dot") as HTMLElement).style.background,
    ]);
    expect(legend).toEqual(
      expect.arrayContaining([
        ["Daily", "var(--graph-folder-1)"],
        ["Examples", "var(--graph-folder-2)"],
        ["Templates", "var(--graph-folder-3)"],
      ]),
    );
  });

  it("keeps the one-time tip compact so it covers little of the map (#594)", () => {
    const { container } = renderGraph(twoNotes);
    const tip = container.querySelector(".graph-tip");
    expect(tip).not.toBeNull();
    expect(tip).toHaveClass("tip--compact");
    // Fits on one or two lines at the tip's width, with the dismiss button.
    expect(tip!.querySelector(".tip-text")!.textContent!.length).toBeLessThanOrEqual(100);
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

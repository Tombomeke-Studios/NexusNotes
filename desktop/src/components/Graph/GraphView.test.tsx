import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPrefs, savePrefs } from "../../lib/prefs";
import type { GraphData } from "../../lib/wikilinks";
import { GraphView } from "./GraphView";

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

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";
import type { Note } from "../lib/types";

function note(id: string, title: string, updated: string): Note {
  return { id, vault_id: "v", path: "", title, content: "", checksum: "", created_at: updated, updated_at: updated };
}

const selectedTitle = () => document.querySelector(".palette-item--selected .palette-item-title")?.textContent;

// The highlighted item must stay the same item when the list reorders
// underneath it (a save landing re-sorts notes by recency); Enter must open
// what is highlighted.
describe("CommandPalette selection", () => {
  it("follows the item, not the position, when the list reorders", () => {
    const a = note("a", "Alpha", "2026-01-02T00:00:00Z");
    const b = note("b", "Beta", "2026-01-01T00:00:00Z");
    const onSelectNote = vi.fn();
    const { rerender } = render(
      <CommandPalette notes={[a, b]} commands={[]} onSelectNote={onSelectNote} onClose={() => {}} />,
    );
    const input = screen.getByPlaceholderText(/search notes/i);
    const first = selectedTitle();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const second = selectedTitle();
    expect(second).not.toBe(first);

    // The highlighted note gets saved meanwhile and moves to the top (newest first).
    const saved = (n: Note) => ({ ...n, updated_at: "2026-02-01T00:00:00Z" });
    const notes = second === "Alpha" ? [saved(a), b] : [a, saved(b)];
    rerender(<CommandPalette notes={notes} commands={[]} onSelectNote={onSelectNote} onClose={() => {}} />);
    expect(selectedTitle()).toBe(second);

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelectNote).toHaveBeenCalledWith(second === "Alpha" ? "a" : "b");
  });
});

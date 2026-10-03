import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { SHORTCUTS, isTypingTarget } from "../../lib/shortcuts";

describe("ShortcutsDialog (#452)", () => {
  it("lists every shortcut by group", () => {
    render(<ShortcutsDialog onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy();
    for (const [label] of SHORTCUTS) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Notes" })).toBeTruthy();
  });

  it("closes on Escape and on the close button", () => {
    const onClose = vi.fn();
    render(<ShortcutsDialog onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("isTypingTarget", () => {
  it("is true for text fields only", () => {
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

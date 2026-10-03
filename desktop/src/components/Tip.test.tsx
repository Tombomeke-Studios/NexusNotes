import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tip } from "./Tip";
import { tipSeen } from "../lib/tips";

beforeEach(() => localStorage.clear());

describe("Tip (#448)", () => {
  it("shows once and stays away after Got it", () => {
    const { unmount } = render(<Tip id="graph">Drag notes to arrange them.</Tip>);
    expect(screen.getByRole("note").textContent).toContain("Drag notes to arrange them.");
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("note")).toBeNull();
    expect(tipSeen("graph")).toBe(true);
    unmount();
    render(<Tip id="graph">Drag notes to arrange them.</Tip>);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("tracks each tip separately", () => {
    render(
      <>
        <Tip id="graph">A</Tip>
        <Tip id="palette">B</Tip>
      </>,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Got it" })[0]);
    expect(screen.getAllByRole("note")).toHaveLength(1);
    expect(screen.getByRole("note").textContent).toContain("B");
  });
});

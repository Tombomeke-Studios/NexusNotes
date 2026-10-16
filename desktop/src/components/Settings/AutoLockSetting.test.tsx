import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AutoLockSetting } from "./AutoLockSetting";

describe("AutoLockSetting (#545)", () => {
  it("offers Off, 5, 15 and 60 minutes and marks the current choice", () => {
    render(<AutoLockSetting value={0} onChange={() => {}} />);
    const group = screen.getByRole("radiogroup", { name: "Auto-lock" });
    expect([...group.querySelectorAll("[role=radio]")].map((b) => b.textContent)).toEqual([
      "Off",
      "5 min",
      "15 min",
      "60 min",
    ]);
    expect(screen.getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/stay unlocked until you lock them/i)).toBeInTheDocument();
  });

  it("stores the picked idle time as minutes", () => {
    const onChange = vi.fn();
    render(<AutoLockSetting value={0} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "15 min" }));
    expect(onChange).toHaveBeenCalledWith(15);
  });

  it("says when vaults lock", () => {
    render(<AutoLockSetting value={5} onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "5 min" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/after 5 minutes without keyboard or mouse activity/i)).toBeInTheDocument();
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConflictNotice } from "./ConflictNotice";

describe("ConflictNotice", () => {
  it("says the note changed elsewhere and opens the comparison", () => {
    const onResolve = vi.fn();
    render(<ConflictNotice onResolve={onResolve} />);
    expect(screen.getByRole("status").textContent).toContain("changed on another device");
    fireEvent.click(screen.getByRole("button", { name: "Compare and resolve" }));
    expect(onResolve).toHaveBeenCalledOnce();
  });

  it("offers no comparison while the other version isn't available", () => {
    render(<ConflictNotice />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

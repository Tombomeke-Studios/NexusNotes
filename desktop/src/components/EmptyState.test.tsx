import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmptyState } from "./EmptyState";

describe("EmptyState (#450)", () => {
  it("shows an illustration, a title, guidance and an optional action", () => {
    const onAction = vi.fn();
    const { container } = render(
      <EmptyState art="notes" title="No notes yet" action={{ label: "New note", onClick: onAction }}>
        Create your first note.
      </EmptyState>,
    );
    expect(container.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(screen.getByText("No notes yet")).toBeTruthy();
    expect(screen.getByText("Create your first note.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    expect(onAction).toHaveBeenCalled();
  });

  it("works without an action", () => {
    render(<EmptyState art="search" title="Nothing found" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

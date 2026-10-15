import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";

function renderDialog(props: Partial<Parameters<typeof DeleteConfirmDialog>[0]> = {}) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  render(
    <DeleteConfirmDialog
      noteTitles={["Plans"]}
      busy={false}
      error={null}
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...props}
    />,
  );
  return { onCancel, onConfirm };
}

describe("DeleteConfirmDialog", () => {
  afterEach(cleanup);

  it("names a single note and says it is permanent", () => {
    renderDialog();
    const dialog = screen.getByRole("alertdialog", { name: 'Delete "Plans"?' });
    expect(dialog).toHaveTextContent(/can.t be undone/i);
    expect(screen.getByRole("button", { name: "Delete note" })).toBeInTheDocument();
  });

  it("gives the count for several notes", () => {
    renderDialog({ noteTitles: ["A", "B", "C"] });
    expect(screen.getByRole("alertdialog", { name: "Delete 3 notes?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete 3 notes" })).toBeInTheDocument();
  });

  it("says 'this note' for a note without a title (#586)", () => {
    renderDialog({ noteTitles: [""] });
    expect(screen.getByRole("alertdialog", { name: "Delete this note?" })).toBeInTheDocument();
  });

  it("lists the titles of a multi-delete, up to five, then the rest as a count (#586)", () => {
    renderDialog({ noteTitles: ["A", "B", "", "D", "E", "F", "G"] });
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["A", "B", "Untitled", "D", "E", "and 2 more"]);
  });

  it("does not list a single note", () => {
    renderDialog();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows the delete button in the danger colour (#586)", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Delete note" })).toHaveClass("confirm-btn--danger-solid");
  });

  it("focuses Cancel by default", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("cancels on Escape and on the Cancel button, deletes only on the delete button", () => {
    const { onCancel, onConfirm } = renderDialog();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete note" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not delete when Enter is pressed on the focused Cancel button", () => {
    const { onConfirm } = renderDialog();
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Enter" });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("locks both buttons while deleting and shows a failure", () => {
    renderDialog({ busy: true, error: "Couldn't delete the note. Try again or cancel." });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /deleting/i })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't delete/i);
  });
});

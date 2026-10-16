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

  it("names a single note and says it can be restored for 30 days (#569)", () => {
    renderDialog();
    const dialog = screen.getByRole("alertdialog", { name: 'Move "Plans" to the Trash?' });
    expect(dialog).toHaveTextContent(/You can restore it for 30 days/);
    expect(dialog).not.toHaveTextContent(/can.t be undone/i);
    expect(screen.getByRole("button", { name: "Move to Trash" })).toBeInTheDocument();
  });

  it("gives the count for several notes", () => {
    renderDialog({ noteTitles: ["A", "B", "C"] });
    const dialog = screen.getByRole("alertdialog", { name: "Move 3 notes to the Trash?" });
    expect(dialog).toHaveTextContent(/You can restore them for 30 days/);
  });

  it("names a folder and how many notes go with it", () => {
    renderDialog({ noteTitles: ["A", "B"], folder: "Projects/2026" });
    const dialog = screen.getByRole("alertdialog", { name: 'Move the folder "2026" to the Trash?' });
    expect(dialog).toHaveTextContent(/Its 2 notes go to the Trash/);
  });

  it("says 'this note' for a note without a title (#586)", () => {
    renderDialog({ noteTitles: [""] });
    expect(screen.getByRole("alertdialog", { name: "Move this note to the Trash?" })).toBeInTheDocument();
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

  it("shows the move button in the normal primary style, not danger red (#569)", () => {
    renderDialog();
    const button = screen.getByRole("button", { name: "Move to Trash" });
    expect(button).toHaveClass("confirm-btn--primary");
    expect(button).not.toHaveClass("confirm-btn--danger-solid");
  });

  it("focuses Cancel by default", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("cancels on Escape and on the Cancel button, moves only on the move button", () => {
    const { onCancel, onConfirm } = renderDialog();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not move anything when Enter is pressed on the focused Cancel button", () => {
    const { onConfirm } = renderDialog();
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Enter" });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("locks both buttons while moving and shows a failure", () => {
    renderDialog({ busy: true, error: "Couldn't move this note to the Trash. Try again or cancel." });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /moving/i })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't move/i);
  });
});

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrashEntry } from "../../lib/useTrash";
import { TrashDialog } from "./TrashDialog";

const now = new Date("2026-10-16T12:00:00Z");
const entries: TrashEntry[] = [
  { id: "n1", title: "Plan", folder: "Work/2026", deletedAt: "2026-10-14T12:00:00Z", purgeAt: "2026-11-13T12:00:00Z" },
  { id: "n2", title: null, folder: null, deletedAt: "2026-10-16T11:55:00Z", purgeAt: "2026-11-15T11:55:00Z" },
  { id: "n3", title: "Loose", folder: "", deletedAt: "2026-10-15T12:00:00Z", purgeAt: "2026-11-14T12:00:00Z" },
];

function renderDialog(props: Partial<Parameters<typeof TrashDialog>[0]> = {}) {
  const handlers = {
    onRestore: vi.fn(),
    onPurge: vi.fn(),
    onEmpty: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <TrashDialog
      vaultName="Home"
      entries={entries}
      loading={false}
      error={null}
      busyIds={new Set()}
      emptying={false}
      canRestore
      canPurge
      now={now}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

const row = (name: string) => screen.getByRole("listitem", { name });

describe("TrashDialog (#569)", () => {
  afterEach(cleanup);

  it("lists each trashed note with its folder and age", () => {
    renderDialog();
    const plan = row("Plan");
    expect(plan).toHaveTextContent("Work/2026");
    expect(plan).toHaveTextContent("deleted 2 days ago · removed in 28 days");
    expect(row("Loose")).toHaveTextContent("Vault root");
  });

  it("shows a title that could not be decrypted as an encrypted note", () => {
    renderDialog();
    expect(row("Encrypted note")).toHaveTextContent("deleted 5 min ago · removed in 30 days");
  });

  it("restores a note", () => {
    const { onRestore } = renderDialog();
    fireEvent.click(within(row("Plan")).getByRole("button", { name: "Restore" }));
    expect(onRestore).toHaveBeenCalledWith("n1");
  });

  it("asks before deleting a note for good, in the danger style", () => {
    const { onPurge } = renderDialog();
    fireEvent.click(within(row("Plan")).getByRole("button", { name: "Delete permanently" }));
    const confirm = screen.getByRole("alertdialog", { name: 'Delete "Plan" permanently?' });
    expect(confirm).toHaveTextContent(/can.t be undone/i);
    expect(within(confirm).getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(onPurge).not.toHaveBeenCalled();
    const button = within(confirm).getByRole("button", { name: "Delete permanently" });
    expect(button).toHaveClass("confirm-btn--danger-solid");
    fireEvent.click(button);
    expect(onPurge).toHaveBeenCalledWith("n1");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("cancels the confirm on Escape without closing the Trash", () => {
    const { onPurge, onClose } = renderDialog();
    fireEvent.click(within(row("Plan")).getByRole("button", { name: "Delete permanently" }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onPurge).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("empties the trash after a confirm that gives the count", () => {
    const { onEmpty } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Empty Trash" }));
    const confirm = screen.getByRole("alertdialog", { name: "Empty the Trash?" });
    expect(confirm).toHaveTextContent("All 3 notes in the Trash are deleted for good");
    fireEvent.click(within(confirm).getByRole("button", { name: "Empty Trash" }));
    expect(onEmpty).toHaveBeenCalledOnce();
  });

  it("hides delete and empty from an editor", () => {
    renderDialog({ canPurge: false });
    expect(within(row("Plan")).getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete permanently" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Empty Trash" })).toBeNull();
  });

  it("hides every action from a viewer", () => {
    renderDialog({ canRestore: false, canPurge: false });
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete permanently" })).toBeNull();
  });

  it("locks a note's buttons while it is busy", () => {
    renderDialog({ busyIds: new Set(["n1"]) });
    expect(within(row("Plan")).getByRole("button", { name: /restor/i })).toBeDisabled();
  });

  it("shows the empty state when nothing is in the trash", () => {
    renderDialog({ entries: [] });
    expect(screen.getByText("The Trash is empty")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Empty Trash" })).toBeNull();
  });

  it("shows an error", () => {
    renderDialog({ error: "Couldn't restore \"Plan\". Try again." });
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't restore");
  });

  it("closes on Escape and on the close button", () => {
    const { onClose } = renderDialog();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Trash" }), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close Trash" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

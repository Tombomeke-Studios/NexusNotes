import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeletedElsewhereDialog } from "./DeletedElsewhereDialog";

function renderDialog(props: Partial<Parameters<typeof DeletedElsewhereDialog>[0]> = {}) {
  const onKeep = vi.fn();
  const onDiscard = vi.fn();
  render(
    <DeletedElsewhereDialog noteTitle="Plans" busy={false} error={null} onKeep={onKeep} onDiscard={onDiscard} {...props} />,
  );
  return { onKeep, onDiscard };
}

describe("DeletedElsewhereDialog", () => {
  afterEach(cleanup);

  it("names the note and says the text is still here", () => {
    renderDialog();
    const dialog = screen.getByRole("alertdialog", { name: /deleted elsewhere/i });
    expect(dialog).toHaveTextContent(/"Plans" was deleted on another device/);
    expect(dialog).toHaveTextContent(/your unsaved text is still here/i);
  });

  it("offers keep as new note (focused) and discard", () => {
    const { onKeep, onDiscard } = renderDialog();
    const keep = screen.getByRole("button", { name: "Keep as new note" });
    expect(keep).toHaveFocus();
    fireEvent.click(keep);
    expect(onKeep).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onDiscard).toHaveBeenCalled();
  });

  it("does not close on Escape or a backdrop click: the text needs an answer", () => {
    const { onKeep, onDiscard } = renderDialog();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onKeep).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("locks both choices while the new note is being created", () => {
    renderDialog({ busy: true });
    expect(screen.getByRole("button", { name: /creating/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
  });

  it("shows why keeping failed", () => {
    renderDialog({ error: "Couldn't create the new note. Your text is still here; try again." });
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't create the new note/i);
  });
});

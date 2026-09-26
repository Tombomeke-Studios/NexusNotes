import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CloseConfirmDialog } from "./CloseConfirmDialog";
import type { SaveError } from "../../lib/useNoteSave";

function renderDialog(props: Partial<Parameters<typeof CloseConfirmDialog>[0]> = {}) {
  const handlers = { onCancel: vi.fn(), onDiscard: vi.fn(), onSave: vi.fn() };
  render(
    <CloseConfirmDialog noteTitle="Plans" kind="window" saving={false} error={null} {...handlers} {...props} />,
  );
  return handlers;
}

const error = (kind: SaveError["kind"], message = "boom"): SaveError => ({ noteId: "n1", kind, message });

describe("CloseConfirmDialog", () => {
  it("asks what to do with unsaved changes", () => {
    const h = renderDialog();

    expect(screen.getByRole("alertdialog")).toHaveTextContent("Unsaved changes");
    expect(screen.getByText(/"Plans" has changes that haven.t been saved/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save & close" }));
    fireEvent.click(screen.getByRole("button", { name: "Close without saving" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(h.onSave).toHaveBeenCalledTimes(1);
    expect(h.onDiscard).toHaveBeenCalledTimes(1);
    expect(h.onCancel).toHaveBeenCalledTimes(1);
  });

  it("locks the choices while saving", () => {
    const h = renderDialog({ saving: true });

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close without saving" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.click(screen.getByRole("alertdialog").parentElement!);
    expect(h.onCancel).not.toHaveBeenCalled();
  });

  it("explains an offline failure and offers retry, keep editing or close without saving", () => {
    const h = renderDialog({ error: error("network") });

    expect(screen.getByRole("alertdialog")).toHaveTextContent("Couldn't save your changes");
    expect(screen.getByText(/server can.t be reached/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    fireEvent.click(screen.getByRole("button", { name: "Close without saving" }));
    expect(h.onSave).toHaveBeenCalledTimes(1);
    expect(h.onCancel).toHaveBeenCalledTimes(1);
    expect(h.onDiscard).toHaveBeenCalledTimes(1);
  });

  it("explains a conflict", () => {
    renderDialog({ error: error("conflict") });
    expect(screen.getByText(/changed elsewhere/)).toBeInTheDocument();
  });

  it("shows the reason of any other failure", () => {
    renderDialog({ error: error("failed", "Couldn't save this note: vault is locked") });
    expect(screen.getByText("Couldn't save this note: vault is locked")).toBeInTheDocument();
  });

  it("asks before signing out with unsaved changes", () => {
    const h = renderDialog({ kind: "signout" });

    expect(screen.getByText(/before signing out/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save & sign out" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out without saving" }));
    expect(h.onSave).toHaveBeenCalledTimes(1);
    expect(h.onDiscard).toHaveBeenCalledTimes(1);
  });

  it("warns that closing without saving discards the text", () => {
    renderDialog({ error: error("network") });
    expect(screen.getByRole("alertdialog")).toHaveTextContent(/closing without saving discards/i);
  });
});

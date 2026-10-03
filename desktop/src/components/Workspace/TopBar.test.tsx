import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TopBar } from "./TopBar";
import type { SaveStatus } from "../../lib/useNoteSave";

function bar(syncStatus: SaveStatus) {
  return (
    <TopBar
      vaultName="Vault"
      noteTitle="Note"
      notePath=""
      syncStatus={syncStatus}
      leftOpen
      rightOpen
      onOpenPalette={() => {}}
      onToggleLeft={() => {}}
      onToggleRight={() => {}}
    />
  );
}

// Sync indicator (#431): a spinner while saving, a checkmark once synced.
describe("TopBar sync indicator", () => {
  it("spins while syncing and pops a checkmark when done", () => {
    const view = render(bar("saving"));
    expect(view.container.querySelector(".topbar-sync-spinner")).not.toBeNull();
    expect(view.getByText("Syncing…")).toBeTruthy();

    view.rerender(bar("saved"));
    expect(view.container.querySelector(".topbar-sync-spinner")).toBeNull();
    expect(view.container.querySelector(".topbar-sync-check")).not.toBeNull();
    expect(view.getByText("Synced")).toBeTruthy();
  });

  it("shows a coloured dot for pending changes and conflicts", () => {
    const view = render(bar("conflict"));
    expect(view.container.querySelector(".topbar-sync-dot")).not.toBeNull();
    expect(view.container.querySelector(".topbar-sync-check")).toBeNull();
  });
});

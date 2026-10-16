import { describe, expect, it, vi } from "vitest";
import { clearLockedVault, type VaultWorkspace } from "./lockedVaultCleanup";

/** A workspace whose every setter records what it was given. */
function workspace(activeVaultId: string | null) {
  let linksVaultId: string | null = "v1";
  const ws = {
    activeVaultId: () => activeVaultId,
    cancelPending: vi.fn(),
    setLinksVaultId: vi.fn((next: string | null | ((prev: string | null) => string | null)) => {
      linksVaultId = typeof next === "function" ? next(linksVaultId) : next;
    }),
  } as unknown as VaultWorkspace & Record<string, ReturnType<typeof vi.fn>>;
  const setters = [
    "setTabs", "setActiveTabKey", "setActiveNote", "setEditorContent", "setSaveStatus", "setNoteList",
    "setEmptyFolders", "setSelectedIds", "setFilterTags", "setFilterFolder", "setSearchQuery",
    "setReplaceRequest", "setInsertRequest", "setConflictPrompt", "setHistoryOpen", "setShowGlobalSearch",
    "setPaletteQuery", "setShowTemplatePicker", "setRenameTag", "setCtxMenu", "setShowCalendar",
  ] as const;
  for (const name of setters) (ws as Record<string, unknown>)[name] = vi.fn();
  return { ws, setters, linksVaultId: () => linksVaultId };
}

describe("clearLockedVault (#545)", () => {
  it("empties every place the open vault's plaintext lives", () => {
    const { ws, setters } = workspace("v1");
    clearLockedVault("v1", ws);

    expect(ws.cancelPending).toHaveBeenCalled();
    for (const name of setters) expect(ws[name], name).toHaveBeenCalledTimes(1);
    expect(ws.setNoteList).toHaveBeenCalledWith([]);
    expect(ws.setTabs).toHaveBeenCalledWith([]);
    expect(ws.setActiveNote).toHaveBeenCalledWith(null);
    expect(ws.setEditorContent).toHaveBeenCalledWith("");
    expect(ws.setSearchQuery).toHaveBeenCalledWith("");
    expect(ws.setFilterTags).toHaveBeenCalledWith([]);
    expect(ws.setFilterFolder).toHaveBeenCalledWith(null);
    expect(ws.setHistoryOpen).toHaveBeenCalledWith(false);
    expect(ws.setConflictPrompt).toHaveBeenCalledWith(null);
  });

  it("hides the vault's empty-folder names too", () => {
    const { ws } = workspace("v1");
    clearLockedVault("v1", ws);
    expect(ws.setEmptyFolders).toHaveBeenCalledWith([]);
  });

  it("closes the vault's linked-files panel", () => {
    const { ws, linksVaultId } = workspace("v1");
    clearLockedVault("v1", ws);
    expect(linksVaultId()).toBeNull();
  });

  it("leaves the workspace alone when another vault locks, apart from that vault's linked files", () => {
    const { ws, setters, linksVaultId } = workspace("v2");
    clearLockedVault("v3", ws);
    expect(linksVaultId()).toBe("v1");
    clearLockedVault("v1", ws);
    expect(linksVaultId()).toBeNull();
    expect(ws.cancelPending).not.toHaveBeenCalled();
    for (const name of setters) expect(ws[name], name).not.toHaveBeenCalled();
  });
});

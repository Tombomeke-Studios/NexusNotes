import type { Dispatch, SetStateAction } from "react";

/** A state setter that is only ever given this value. */
type Put<T> = (value: T) => void;

/**
 * The parts of the workspace that can hold a vault's decrypted text, titles,
 * folder or tag names. App owns them; a vault lock (#545) empties them.
 */
export interface VaultWorkspace {
  /** The vault open in the workspace. */
  activeVaultId: () => string | null;
  /**
   * Stops whatever is still on its way for the open vault: note loads and
   * selections, a version waiting for the editor, the "deleted elsewhere"
   * question, the delete confirmation.
   */
  cancelPending: () => void;
  setLinksVaultId: Dispatch<SetStateAction<string | null>>;
  setTabs: Put<[]>;
  setActiveTabKey: Put<null>;
  setActiveNote: Put<null>;
  setEditorContent: Put<string>;
  setSaveStatus: Put<"idle">;
  setNoteList: Put<[]>;
  setEmptyFolders: Put<string[]>;
  setSelectedIds: Put<Set<string>>;
  setFilterTags: Put<string[]>;
  setFilterFolder: Put<null>;
  setSearchQuery: Put<string>;
  setReplaceRequest: Put<null>;
  setInsertRequest: Put<null>;
  setConflictPrompt: Put<null>;
  setHistoryOpen: Put<boolean>;
  setShowGlobalSearch: Put<boolean>;
  setPaletteQuery: Put<null>;
  setShowTemplatePicker: Put<boolean>;
  setRenameTag: Put<null>;
  setCtxMenu: Put<null>;
  setShowCalendar: Put<boolean>;
}

/**
 * Drops every decrypted copy of `vaultId` from the workspace once its key is
 * gone (#545). Only the open vault's text is in state; for any other vault
 * just its linked-files panel closes. Everything derived from the note list
 * (tree, tags, backlinks, link previews, the graph, client-side search)
 * empties with it.
 */
export function clearLockedVault(vaultId: string, ws: VaultWorkspace): void {
  ws.setLinksVaultId((id) => (id === vaultId ? null : id));
  if (ws.activeVaultId() !== vaultId) return;
  ws.cancelPending();
  ws.setTabs([]);
  ws.setActiveTabKey(null);
  ws.setActiveNote(null);
  ws.setEditorContent("");
  ws.setSaveStatus("idle");
  ws.setNoteList([]);
  ws.setEmptyFolders([]);
  ws.setSelectedIds(new Set<string>());
  ws.setFilterTags([]);
  ws.setFilterFolder(null);
  ws.setSearchQuery("");
  ws.setReplaceRequest(null);
  ws.setInsertRequest(null);
  ws.setConflictPrompt(null);
  ws.setHistoryOpen(false);
  ws.setShowGlobalSearch(false);
  ws.setPaletteQuery(null);
  ws.setShowTemplatePicker(false);
  ws.setRenameTag(null);
  ws.setCtxMenu(null);
  ws.setShowCalendar(false);
}

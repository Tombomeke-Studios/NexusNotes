/**
 * Decisions for the sync events App.tsx receives over the WebSocket. The
 * server pushes a note event to every device of every member of the note's
 * vault, whichever vault that device has open, so each event is checked
 * against what is on screen before it touches state.
 */

/**
 * Whether a pushed note belongs to the vault that is open (#562). Notes of
 * other vaults (a shared vault, another window) must not join its list.
 */
export function isForVault(note: { vault_id?: string } | null | undefined, openVaultId: string | null): boolean {
  return !!openVaultId && !!note && note.vault_id === openVaultId;
}

/**
 * What to do when the server reports a note deleted (#561). The open note
 * stays on screen and the user is asked ("ask") when it holds text the server
 * never confirmed and the delete came from elsewhere; closing it then would
 * silently drop that text. Everything else simply closes ("close").
 */
export function deletedNoteAction(input: {
  deletedId: string;
  openNoteId: string | null;
  /** This device sent the delete (its own echo). */
  ownDelete: boolean;
  /** Unsaved, in-flight, failed or conflicting text in the open note. */
  unsavedText: boolean;
}): "ask" | "close" {
  const { deletedId, openNoteId, ownDelete, unsavedText } = input;
  return deletedId === openNoteId && !ownDelete && unsavedText ? "ask" : "close";
}

/**
 * Orders a vault's note-list loads (#563): only the latest may write the list
 * or replay drafts. Selecting a locked vault starts no load but must still
 * stop the running one, so it invalidates the sequence.
 */
export interface LoadSequence {
  /** Starts a load; pass the token to isCurrent once the data is in. */
  begin(): number;
  isCurrent(token: number): boolean;
  /** Makes every running load stale without starting a new one. */
  invalidate(): void;
}

export function createLoadSequence(): LoadSequence {
  let latest = 0;
  return {
    begin: () => ++latest,
    isCurrent: (token) => token === latest,
    invalidate: () => {
      latest += 1;
    },
  };
}

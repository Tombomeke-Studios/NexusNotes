import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { uniqueTitle } from "./noteFilter";
import { deletedNoteAction } from "./syncEvents";
import type { Note } from "./types";

export interface DeletedElsewhereDeps {
  activeNoteRef: MutableRefObject<Note | null>;
  editorContentRef: MutableRefObject<string>;
  noteListRef: MutableRefObject<Note[]>;
  /** The vault's encryption at the edge, as for any other save (ciphertext for e2ee vaults). */
  encryptOutgoing: (vaultId: string, text: string) => Promise<{ content: string; checksum?: string }>;
  sealMeta: (vaultId: string, title: string, path: string) => Promise<{ title: string; path: string }>;
  createNote: (vaultId: string, title: string, path: string, content: string, checksum?: string) => Promise<Note>;
  /** Drops the open note's pending saves, draft and errors (useNoteSave's discard). */
  discardUnsaved: () => void;
  /** Puts the new note in the deleted one's place: same tab, open in the editor. */
  openReplacement: (deletedId: string, note: Note) => void;
  /** Closes the deleted note's tab. */
  closeNote: (noteId: string) => void;
}

/**
 * The open note was deleted on another device while it held text the server
 * never confirmed (#561). Instead of closing the tab and dropping that text,
 * the note stays on screen and the user picks: keep the text as a new note,
 * or discard it. Nothing is lost until "Discard" is chosen; a failed "Keep"
 * leaves everything as it was and says why.
 */
export function useDeletedElsewhere(deps: DeletedElsewhereDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const [deleted, setDeleted] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Deletes this device sent: the server pushes note:deleted to us too.
  const ownDeletes = useRef(new Set<string>());
  // Closing waits for the render after discard: closing the tab may open the
  // next one, which first flushes the open note's save state.
  const [closing, setClosing] = useState<string | null>(null);

  useEffect(() => {
    if (!closing) return;
    depsRef.current.closeNote(closing);
    setClosing(null);
  }, [closing]);

  const markOwnDelete = useCallback((noteId: string) => {
    ownDeletes.current.add(noteId);
  }, []);
  /** The delete failed: a later delete from elsewhere must be asked about again. */
  const forgetOwnDelete = useCallback((noteId: string) => {
    ownDeletes.current.delete(noteId);
  }, []);

  /**
   * Handles a pushed note:deleted. Returns true when the note stays open for
   * the question; false when the caller should close it as usual.
   */
  const onRemoteDelete = useCallback((noteId: string, unsavedText: boolean): boolean => {
    const ownDelete = ownDeletes.current.delete(noteId);
    const open = depsRef.current.activeNoteRef.current;
    const action = deletedNoteAction({ deletedId: noteId, openNoteId: open?.id ?? null, ownDelete, unsavedText });
    if (action !== "ask" || !open) return false;
    setDeleted(open);
    setError(null);
    return true;
  }, []);

  const keepAsNew = useCallback(async () => {
    const d = depsRef.current;
    const gone = deleted;
    if (!gone || busy) return;
    setBusy(true);
    setError(null);
    try {
      const open = d.activeNoteRef.current;
      // The title may have been renamed locally since the note was loaded.
      const title = open?.id === gone.id ? open.title : gone.title;
      const text = d.editorContentRef.current;
      const name = uniqueTitle(new Set(d.noteListRef.current.map((n) => n.title)), title || "Untitled");
      const { content, checksum } = await d.encryptOutgoing(gone.vault_id, text);
      const sealed = await d.sealMeta(gone.vault_id, name, gone.path);
      const created = await d.createNote(gone.vault_id, sealed.title, sealed.path, content, checksum);
      // Only now that the text is safe on the server: drop the old note's
      // pending saves (they would fail against a note that no longer exists).
      if (d.activeNoteRef.current?.id === gone.id) d.discardUnsaved();
      d.openReplacement(gone.id, { ...created, title: name, path: gone.path, content: text });
      setDeleted(null);
    } catch (err) {
      const reason = err instanceof Error && err.message ? ` (${err.message})` : "";
      setError(`Couldn't create the new note${reason}. Your text is still here; try again.`);
    } finally {
      setBusy(false);
    }
  }, [deleted, busy]);

  const discard = useCallback(() => {
    const gone = deleted;
    if (!gone || busy) return;
    const d = depsRef.current;
    if (d.activeNoteRef.current?.id === gone.id) d.discardUnsaved();
    setDeleted(null);
    setError(null);
    setClosing(gone.id);
  }, [deleted, busy]);

  /** Forgets the question (vault switch, sign-out). */
  const reset = useCallback(() => {
    setDeleted(null);
    setError(null);
    setBusy(false);
  }, []);

  return { deleted, busy, error, markOwnDelete, forgetOwnDelete, onRemoteDelete, keepAsNew, discard, reset };
}

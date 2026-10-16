import { useCallback, useRef, useState } from "react";
import { ApiError } from "./api";

/** Most note ids the server takes in one batch trash call. */
export const TRASH_BATCH_LIMIT = 1000;

interface DeleteConfirmDeps {
  /** Moves one note to the Trash and drops it from the workspace. */
  trashOne: (noteId: string) => Promise<void>;
  /**
   * Moves several notes of the vault to the Trash in one call (one
   * transaction); ids that are already gone are skipped by the server.
   */
  trashMany: (noteIds: string[]) => Promise<void>;
  /** The notes that were moved (e.g. to clear the multi-selection); the folder once all of its notes are. */
  onDeleted: (noteIds: string[], folder: string | null) => void;
}

/**
 * Deleting moves notes to the vault's Trash (#569), and every delete is
 * still asked first (#568). request() opens the question; nothing moves until
 * confirm(). One note goes with the single-note call; several notes, or a
 * folder's, go in one batch call. If a move fails, the notes not yet moved
 * stay in the question with the reason, so the user can retry or cancel.
 */
export function useDeleteConfirm(deps: DeleteConfirmDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const [pending, setPending] = useState<string[] | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Asks about `noteIds`; `folderPath` when they are a folder's notes (the folder goes too). */
  const request = useCallback((noteIds: string[], folderPath?: string) => {
    if (noteIds.length === 0) return;
    setPending([...new Set(noteIds)]);
    setFolder(folderPath ?? null);
    setError(null);
  }, []);

  const cancel = useCallback(() => {
    if (busy) return;
    setPending(null);
    setFolder(null);
    setError(null);
  }, [busy]);

  const confirm = useCallback(async () => {
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    const done: string[] = [];
    let failed = false;
    try {
      if (pending.length === 1 && folder === null) {
        try {
          await depsRef.current.trashOne(pending[0]);
        } catch (err) {
          // Deleted elsewhere while the dialog was open: that is the goal (#586).
          if (!(err instanceof ApiError && err.status === 404)) throw err;
        }
        done.push(pending[0]);
      } else {
        for (let i = 0; i < pending.length; i += TRASH_BATCH_LIMIT) {
          const batch = pending.slice(i, i + TRASH_BATCH_LIMIT);
          await depsRef.current.trashMany(batch);
          done.push(...batch);
        }
      }
      setPending(null);
      setFolder(null);
    } catch (err) {
      failed = true;
      const reason = err instanceof Error && err.message ? ` (${err.message})` : "";
      const left = pending.length - done.length;
      setPending(pending.filter((id) => !done.includes(id)));
      setError(
        `Couldn't move ${left === 1 ? "this note" : `${left} notes`} to the Trash${reason}. Try again or cancel.`,
      );
    } finally {
      if (done.length > 0) depsRef.current.onDeleted(done, failed ? null : folder);
      setBusy(false);
    }
  }, [pending, folder, busy]);

  return { pending, folder, busy, error, request, cancel, confirm };
}

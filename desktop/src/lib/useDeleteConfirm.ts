import { useCallback, useRef, useState } from "react";
import { ApiError } from "./api";

interface DeleteConfirmDeps {
  /** Deletes one note on the server and drops it from the workspace. */
  deleteOne: (noteId: string) => Promise<void>;
  /** The notes that were deleted (e.g. to clear the multi-selection). */
  onDeleted: (noteIds: string[]) => void;
}

/**
 * Deleting is permanent (until there is a Trash, #569), so every delete is
 * asked first (#568). request() opens the question; nothing is deleted until
 * confirm(). If a delete fails, the notes not yet deleted stay in the
 * question with the reason, so the user can retry or cancel.
 */
export function useDeleteConfirm(deps: DeleteConfirmDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const [pending, setPending] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback((noteIds: string[]) => {
    if (noteIds.length === 0) return;
    setPending([...new Set(noteIds)]);
    setError(null);
  }, []);

  const cancel = useCallback(() => {
    if (busy) return;
    setPending(null);
    setError(null);
  }, [busy]);

  const confirm = useCallback(async () => {
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    const done: string[] = [];
    try {
      for (const id of pending) {
        try {
          await depsRef.current.deleteOne(id);
        } catch (err) {
          // Deleted elsewhere while the dialog was open: that is the goal (#586).
          if (!(err instanceof ApiError && err.status === 404)) throw err;
        }
        done.push(id);
      }
      setPending(null);
    } catch (err) {
      const reason = err instanceof Error && err.message ? ` (${err.message})` : "";
      const left = pending.length - done.length;
      setPending(pending.filter((id) => !done.includes(id)));
      setError(`Couldn't delete ${left === 1 ? "this note" : `${left} notes`}${reason}. Try again or cancel.`);
    } finally {
      if (done.length > 0) depsRef.current.onDeleted(done);
      setBusy(false);
    }
  }, [pending, busy]);

  return { pending, busy, error, request, cancel, confirm };
}

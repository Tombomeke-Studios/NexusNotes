import { useCallback, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { SaveError, SaveOutcome } from "./useNoteSave";

/** What the user is leaving: the whole window, one note tab, or the session. */
export type ClosePrompt = { kind: "window" } | { kind: "tab"; key: string } | { kind: "signout" };

export interface CloseGuardDeps {
  /** The open close-confirmation dialog, if any; owned by the caller. */
  prompt: ClosePrompt | null;
  setPrompt: Dispatch<SetStateAction<ClosePrompt | null>>;
  /** Saves the open note's latest text and reports whether it reached the server. */
  save: () => Promise<SaveOutcome>;
  /** Drops the open note's unsaved changes (draft, pending retries). */
  discard: () => void;
  /** Actually closes the tab or window. */
  finishClose: (prompt: ClosePrompt) => Promise<void> | void;
}

/**
 * Closing with unsaved changes (#283): nothing closes until the save is
 * confirmed by the server. A failed save keeps the app open and puts the
 * reason in the close dialog, which then offers retry, keep editing, or an
 * explicit close without saving. That matters most for e2ee vaults, which
 * keep no local draft to fall back on.
 */
export function useCloseGuard(deps: CloseGuardDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<SaveError | null>(null);

  /**
   * Saves, then closes on success; otherwise the dialog stays with the reason.
   * The dialog shows its saving state meanwhile, so an OS-level close waiting
   * on a slow save isn't silent.
   */
  const saveThenClose = useCallback(async (prompt: ClosePrompt) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    depsRef.current.setPrompt(prompt);
    let outcome: SaveOutcome;
    try {
      outcome = await depsRef.current.save();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    const d = depsRef.current;
    if (outcome.ok) {
      d.setPrompt(null);
      await d.finishClose(prompt);
    } else {
      setError(outcome.error);
      d.setPrompt(prompt);
    }
  }, []);

  /** The dialog's "Save & close" / "Retry". */
  const saveAndClose = useCallback(async () => {
    const prompt = depsRef.current.prompt;
    if (prompt) await saveThenClose(prompt);
  }, [saveThenClose]);

  /** The dialog's explicit "Close without saving". */
  const discardAndClose = useCallback(async () => {
    const d = depsRef.current;
    const prompt = d.prompt;
    if (!prompt || savingRef.current) return;
    d.discard();
    setError(null);
    d.setPrompt(null);
    await d.finishClose(prompt);
  }, []);

  /** "Cancel" / "Keep editing": back to the note, nothing closes. */
  const cancel = useCallback(() => {
    if (savingRef.current) return;
    setError(null);
    depsRef.current.setPrompt(null);
  }, []);

  return { saving, error, saveAndClose, saveThenClose, discardAndClose, cancel };
}

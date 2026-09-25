import { useCallback, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { notes as notesApi } from "./api";
import { saveDraft, clearDraft } from "./drafts";
import type { Note } from "./types";

export type SaveStatus = "saved" | "saving" | "unsaved" | "idle";

export interface NoteSaveDeps {
  /** The note open in the editor; the caller refreshes it on every render. */
  activeNoteRef: MutableRefObject<Note | null>;
  setActiveNote: Dispatch<SetStateAction<Note | null>>;
  setNoteList: Dispatch<SetStateAction<Note[]>>;
  setEditorContent: (content: string) => void;
  /** The save status shown in the chrome; owned by the caller. */
  setSaveStatus: Dispatch<SetStateAction<SaveStatus>>;
  /** Called after every successful save (drives the "Synced …" label). */
  onSynced: () => void;
  /** Prepares plaintext for upload (ciphertext + plaintext checksum for e2ee vaults). */
  encryptOutgoing: (vaultId: string, plaintext: string) => Promise<{ content: string; checksum?: string }>;
  /** False when plaintext must never touch disk (e2ee vaults), so no local draft is kept. */
  keepsDrafts: (vaultId: string) => boolean;
}

/**
 * Saving the note open in the editor: the PUT to the sync service, the save
 * status it drives and the local draft mirror of unsaved edits. Both returned
 * callbacks are stable; they always read the latest deps.
 */
export function useNoteSave(deps: NoteSaveDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const saveNote = useCallback(async (content: string) => {
    const { activeNoteRef, setActiveNote, setNoteList, setEditorContent, setSaveStatus, onSynced, encryptOutgoing } =
      depsRef.current;
    const current = activeNoteRef.current;
    if (!current) return;
    setEditorContent(content);
    setSaveStatus("saving");
    try {
      // For e2ee vaults only ciphertext + the plaintext checksum go out; the
      // server echoes the ciphertext back, so state keeps the local plaintext.
      const { content: payload, checksum } = await encryptOutgoing(current.vault_id, content);
      const updated = await notesApi.update(
        current.id,
        current.title,
        current.path,
        payload,
        current.checksum,
        checksum,
      );
      if ("checksum" in updated) {
        const note = { ...(updated as Note), content };
        clearDraft(note.id);
        setNoteList((prev) => prev.map((n) => (n.id === note.id ? note : n)));
        // Only refresh the open note / status if we haven't since navigated away
        // (e.g. a save flushed on blur while clicking a preview link).
        setActiveNote((prev) => (prev && prev.id === note.id ? note : prev));
        if (activeNoteRef.current?.id === note.id) {
          setSaveStatus("saved");
        }
        onSynced();
      }
    } catch {
      setSaveStatus("unsaved");
    }
  }, []);

  // Live editor edits mark the note dirty immediately (so the tab dot / status
  // show unsaved before the debounced autosave runs).
  const liveChange = useCallback((content: string) => {
    const { activeNoteRef, setEditorContent, setSaveStatus, keepsDrafts } = depsRef.current;
    setEditorContent(content);
    setSaveStatus((s) => (s === "unsaved" ? s : "unsaved"));
    // Mirror to a local draft so nothing is lost if the app closes before the
    // debounced server save runs — except for e2ee vaults, where plaintext
    // must never touch disk (localStorage included).
    const current = activeNoteRef.current;
    if (current && keepsDrafts(current.vault_id)) {
      saveDraft(current.id, content);
    }
  }, []);

  return { saveNote, liveChange };
}

const KEY_PREFIX = "nexus_draft_";

/**
 * Unsaved editor content is mirrored to localStorage on every keystroke so work
 * is never lost if the app closes or crashes before the debounced server save.
 * The draft is cleared once a save succeeds, and restored when the note reopens.
 */
export function saveDraft(noteId: string, content: string): void {
  try {
    localStorage.setItem(KEY_PREFIX + noteId, content);
  } catch {
    /* storage full / unavailable — best effort */
  }
}

export function loadDraft(noteId: string): string | null {
  try {
    return localStorage.getItem(KEY_PREFIX + noteId);
  } catch {
    return null;
  }
}

export function clearDraft(noteId: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + noteId);
  } catch {
    /* ignore */
  }
}

const KEY_PREFIX = "nexus_draft_";
const BASE_PREFIX = "nexus_draft_base_";

/**
 * Unsaved editor content is mirrored to localStorage on every keystroke so work
 * is never lost if the app closes or crashes before the debounced server save.
 * The draft is cleared once a save succeeds, and restored when the note reopens.
 * Alongside it the checksum of the server version the draft was written
 * against is kept, so a restored draft is saved against that version and a
 * server copy changed in between surfaces as a conflict.
 */
export function saveDraft(noteId: string, content: string, baseChecksum?: string): void {
  try {
    localStorage.setItem(KEY_PREFIX + noteId, content);
    if (baseChecksum) localStorage.setItem(BASE_PREFIX + noteId, baseChecksum);
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

/** The checksum the draft was written against, or null (none, or a legacy draft). */
export function loadDraftBase(noteId: string): string | null {
  try {
    return localStorage.getItem(BASE_PREFIX + noteId);
  } catch {
    return null;
  }
}

/** Moves the draft's base to `to` if it is still on `from` (our own save landed). */
export function rebaseDraft(noteId: string, from: string, to: string): void {
  try {
    if (localStorage.getItem(BASE_PREFIX + noteId) === from) {
      localStorage.setItem(BASE_PREFIX + noteId, to);
    }
  } catch {
    /* ignore */
  }
}

export function clearDraft(noteId: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + noteId);
    localStorage.removeItem(BASE_PREFIX + noteId);
  } catch {
    /* ignore */
  }
}

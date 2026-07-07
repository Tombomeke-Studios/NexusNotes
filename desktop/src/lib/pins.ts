import type { Note } from "./types";

const KEY_PREFIX = "nexus_pins_";

export function loadPins(vaultId: string): string[] {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + vaultId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function togglePin(vaultId: string, noteId: string): string[] {
  const pins = loadPins(vaultId);
  const next = pins.includes(noteId) ? pins.filter((id) => id !== noteId) : [...pins, noteId];
  localStorage.setItem(KEY_PREFIX + vaultId, JSON.stringify(next));
  return next;
}

/** Stable partition: pinned notes first, both halves keep their order. */
export function pinnedFirst(notes: Note[], pinned: Set<string>): Note[] {
  return [...notes.filter((n) => pinned.has(n.id)), ...notes.filter((n) => !pinned.has(n.id))];
}

const KEY_PREFIX = "nexus_recent_";
const MAX_RECENT = 10;

/** Recently-opened note ids for a vault, most recent first (localStorage). */
export function loadRecent(vaultId: string): string[] {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + vaultId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Moves a note to the front of the recent list, capped at MAX_RECENT. */
export function pushRecent(vaultId: string, noteId: string): string[] {
  const next = [noteId, ...loadRecent(vaultId).filter((id) => id !== noteId)].slice(0, MAX_RECENT);
  localStorage.setItem(KEY_PREFIX + vaultId, JSON.stringify(next));
  return next;
}

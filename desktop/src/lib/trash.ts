/**
 * Small helpers for the Trash (#569): the wording of a trashed note's age and
 * folder, and which actions the user's vault role allows.
 */
import type { VaultRole } from "./types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function ago(from: Date, now: Date): string {
  const ms = Math.max(0, now.getTime() - from.getTime());
  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h ago`;
  const days = Math.floor(ms / DAY);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function removedIn(purgeAt: Date, now: Date): string {
  const ms = purgeAt.getTime() - now.getTime();
  if (ms <= 0) return "removed soon";
  const days = Math.ceil(ms / DAY);
  return `removed in ${days} ${days === 1 ? "day" : "days"}`;
}

/** "deleted 2 days ago · removed in 28 days". */
export function trashAgeLabel(deletedAt: string, purgeAt: string, now: Date = new Date()): string {
  return `deleted ${ago(new Date(deletedAt), now)} · ${removedIn(new Date(purgeAt), now)}`;
}

/** The note's original folder; null when it could not be decrypted (show nothing). */
export function trashFolderLabel(folder: string | null): string | null {
  if (folder === null) return null;
  return folder === "" ? "Vault root" : folder;
}

/**
 * What the user may do in the Trash. Trash and restore: owner or editor;
 * delete for good and empty: owner only. A vault without a role is the
 * user's own.
 */
export function trashActions(role: VaultRole | undefined): { canRestore: boolean; canPurge: boolean } {
  const r = role ?? "owner";
  return { canRestore: r !== "viewer", canPurge: r === "owner" };
}

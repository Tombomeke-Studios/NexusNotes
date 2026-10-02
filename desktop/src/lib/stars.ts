/**
 * Starred (favourite) notes are stored server-side per user (#151) so they
 * follow the account across devices; this module holds the one-time
 * migration away from the old per-vault localStorage pins.
 */
import { ApiError } from "./api";

const LEGACY_PIN_PREFIX = "nexus_pins_";

function readLegacyPins(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeLegacyPins(key: string, pins: string[]): void {
  try {
    if (pins.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(pins));
  } catch {
    /* storage unavailable: the pins are retried next start */
  }
}

/** A failure that retrying will not fix (the note is gone or not ours). */
function isPermanent(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status >= 400 &&
    err.status < 500 &&
    err.status !== 401 &&
    err.status !== 408 &&
    err.status !== 429
  );
}

/**
 * Pushes a vault's legacy local pins to the server-backed stars and returns
 * the ids the server now has starred. A pin leaves localStorage only once the
 * server stored it or rejected it for good (a deleted note); after a network
 * or server error it stays for the next start, so no pin is lost (#377).
 */
export async function migrateLegacyPins(
  vaultId: string,
  star: (noteId: string) => Promise<unknown>,
): Promise<string[]> {
  const key = LEGACY_PIN_PREFIX + vaultId;
  const pins = readLegacyPins(key);
  if (pins.length === 0) return [];

  const starred: string[] = [];
  const retry: string[] = [];
  await Promise.all(
    pins.map(async (id) => {
      try {
        await star(id);
        starred.push(id);
      } catch (err) {
        if (!isPermanent(err)) retry.push(id);
      }
    }),
  );
  // Keep the original order for both lists.
  const order = (ids: string[]) => pins.filter((id) => ids.includes(id));
  writeLegacyPins(key, order(retry));
  return order(starred);
}

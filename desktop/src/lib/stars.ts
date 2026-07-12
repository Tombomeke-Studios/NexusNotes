/**
 * Starred (favourite) notes are stored server-side per user (#151) so they
 * follow the account across devices; this module holds the one-time
 * migration away from the old per-vault localStorage pins.
 */

const LEGACY_PIN_PREFIX = "nexus_pins_";

/**
 * Returns the legacy local pins for a vault and deletes the stored key, so
 * each vault's pins are pushed to the server exactly once.
 */
export function drainLegacyPins(vaultId: string): string[] {
  try {
    const key = LEGACY_PIN_PREFIX + vaultId;
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    localStorage.removeItem(key);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}


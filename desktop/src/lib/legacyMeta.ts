import { encryptFieldForVault, isE2eeVault, isEncryptedField, isVaultLocked, type VaultLike } from "./vaultKeys";
import type { Note } from "./types";

/** Re-sends a note with a sealed title/path; content and checksum unchanged. */
export type SealPut = (
  noteId: string,
  title: string,
  path: string,
  content: string,
  prevChecksum: string,
  checksum: string,
) => Promise<unknown>;

/** A note of an e2ee vault whose title or path the server still holds in plaintext. */
export function needsMetaSeal(note: Note): boolean {
  return !isEncryptedField(note.title) || !isEncryptedField(note.path);
}

/**
 * Notes of an e2ee vault created before titles and paths were encrypted (#362)
 * still have them in plaintext on the server. Once the vault is unlocked this
 * sends each such note back with a sealed title and path. The stored
 * ciphertext and its plaintext checksum go along unchanged, so the checksum
 * stays the same and a save the user makes meanwhile cannot conflict with it.
 * `raw` are the notes as the server returned them (ciphertext content).
 * Failures (offline, viewer role) are skipped; the next load tries again.
 * Returns how many notes were sealed.
 */
export async function sealLegacyMeta(raw: Note[], vault: VaultLike, put: SealPut): Promise<number> {
  if (!isE2eeVault(vault) || isVaultLocked(vault)) return 0;
  let sealed = 0;
  for (const n of raw) {
    if (!needsMetaSeal(n)) continue;
    try {
      const title = isEncryptedField(n.title) ? n.title : await encryptFieldForVault(vault, n.title);
      const path = isEncryptedField(n.path) ? n.path : await encryptFieldForVault(vault, n.path);
      await put(n.id, title, path, n.content, n.checksum, n.checksum);
      sealed++;
    } catch {
      /* left for the next load */
    }
  }
  return sealed;
}

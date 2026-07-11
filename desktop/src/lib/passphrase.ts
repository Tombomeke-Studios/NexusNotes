/**
 * Vault passphrase validation for the E2EE setup and change flows.
 * Mirrors the account password minimum (8, enforced server-side for auth),
 * but the vault passphrase only ever exists client-side.
 */

export const MIN_PASSPHRASE_LENGTH = 8;

/** Returns a human-readable problem with the passphrase pair, or null when OK. */
export function passphraseError(passphrase: string, confirm: string): string | null {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    return `Use at least ${MIN_PASSPHRASE_LENGTH} characters — a longer phrase is stronger`;
  }
  if (passphrase !== confirm) {
    return "Passphrases do not match";
  }
  return null;
}

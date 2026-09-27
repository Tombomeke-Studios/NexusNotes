/**
 * Whether files may be attached in a vault. Attachment files are stored as
 * uploaded until client-side encryption lands (#238), so end-to-end encrypted
 * vaults refuse them (the server enforces the same rule). Fails closed while
 * the vault is unknown.
 */
export function attachmentBlockReason(
  vault: { encryption?: "none" | "e2ee" } | null | undefined,
): string | null {
  if (!vault) return "Attachments are unavailable until the vault has loaded.";
  if (vault.encryption === "e2ee") {
    return "Attachments aren't available in end-to-end encrypted vaults yet.";
  }
  return null;
}

/**
 * Whether files may be attached in a vault. In end-to-end encrypted vaults the
 * files are encrypted on this device before upload (#238), so every known
 * vault allows them. Fails closed while the vault is unknown.
 */
export function attachmentBlockReason(
  vault: { encryption?: "none" | "e2ee" } | null | undefined,
): string | null {
  if (!vault) return "Attachments are unavailable until the vault has loaded.";
  return null;
}

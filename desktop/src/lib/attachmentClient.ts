import { attachments as api, safeBlobType, type Attachment } from "./api";
import { encryptAttachment, decryptAttachmentMeta, decryptAttachmentBytes, readBytes } from "./attachmentCrypto";
import { vaultKeySession, VaultLockedError } from "./vaultKeys";

/** The part of a vault the attachment client needs. */
type VaultLike = { id: string; encryption?: "none" | "e2ee" };

/**
 * Attachments through the vault's encryption (#238): in an e2ee vault files
 * are encrypted on this device before upload and decrypted after download,
 * name and type included; standard vaults use the API as it is. The vault of
 * each listed or uploaded e2ee attachment is remembered so the preview can
 * open it by attachment alone.
 */
const e2eeVaultOf = new Map<string, string>();

function keyFor(vaultId: string): Uint8Array {
  const key = vaultKeySession.get(vaultId);
  if (!key) throw new VaultLockedError(vaultId);
  return key;
}

export async function listAttachments(noteId: string, vault: VaultLike): Promise<Attachment[]> {
  const list = await api.list(noteId);
  if (vault.encryption !== "e2ee") return list;
  const key = keyFor(vault.id);
  return Promise.all(
    list.map(async (att) => {
      e2eeVaultOf.set(att.id, vault.id);
      return decryptAttachmentMeta(att, key);
    }),
  );
}

export async function uploadAttachment(noteId: string, file: File, vault: VaultLike): Promise<Attachment> {
  if (vault.encryption !== "e2ee") {
    const att = await api.upload(noteId, file);
    notifyChanged(noteId);
    return att;
  }
  const key = keyFor(vault.id);
  const stored = await api.upload(noteId, await encryptAttachment(file, key));
  e2eeVaultOf.set(stored.id, vault.id);
  notifyChanged(noteId);
  return decryptAttachmentMeta(stored, key);
}

export async function removeAttachment(att: Attachment): Promise<void> {
  await api.remove(att.id);
  e2eeVaultOf.delete(att.id);
  notifyChanged(att.note_id);
}

// The editor and the attachment panel (#238) both change a note's files;
// each reloads its list when the other did.
const changeListeners = new Set<(noteId: string) => void>();

function notifyChanged(noteId: string) {
  for (const l of changeListeners) l(noteId);
}

export function onAttachmentsChanged(listener: (noteId: string) => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

/**
 * An object URL for the attachment (caller revokes it). The blob is typed with
 * safeBlobType, so it can never become an active document.
 */
export async function attachmentObjectUrl(att: Attachment): Promise<string> {
  const vaultId = e2eeVaultOf.get(att.id);
  if (!vaultId) return api.objectUrl(att.id);
  const plain = await decryptAttachmentBytes(await readBytes(await api.bytes(att.id)), keyFor(vaultId));
  return URL.createObjectURL(new Blob([plain as BlobPart], { type: safeBlobType(att.mime_type) }));
}

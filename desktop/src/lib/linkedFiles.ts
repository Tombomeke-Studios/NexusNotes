import { links as api, type LinkedContent, type LinkedFile } from "./api";
import { decryptFieldForVault, encryptFieldForVault, isE2eeVault, type VaultLike } from "./vaultKeys";

/**
 * Linked files through the vault's encryption (#364): in an e2ee vault the
 * display name, source and each annotation are sealed on this device (the
 * `e2ee:` format of note titles); standard vaults use the API as it is. Use
 * these, not `api.links`, in UI code.
 */

async function open(vault: VaultLike, link: LinkedFile): Promise<LinkedFile> {
  return {
    ...link,
    display_name: await decryptFieldForVault(vault, link.display_name),
    source_ref: await decryptFieldForVault(vault, link.source_ref),
  };
}

export async function listLinks(vault: VaultLike): Promise<LinkedFile[]> {
  const list = (await api.list(vault.id)) ?? [];
  return Promise.all(list.map((l) => open(vault, l)));
}

export async function createLink(
  vault: VaultLike,
  input: { display_name: string; source_type: LinkedFile["source_type"]; source_ref: string },
): Promise<LinkedFile> {
  const created = await api.create(vault.id, {
    ...input,
    display_name: await encryptFieldForVault(vault, input.display_name),
    source_ref: await encryptFieldForVault(vault, input.source_ref),
  });
  return { ...created, display_name: input.display_name, source_ref: input.source_ref };
}

/**
 * The current content of a URL link. The server cannot read an e2ee link's
 * stored source, so the decrypted URL goes along with this one request.
 */
export function linkContent(vault: VaultLike, link: LinkedFile): Promise<LinkedContent> {
  return isE2eeVault(vault) ? api.fetchContent(link.id, link.source_ref) : api.content(link.id);
}

export async function getAnnotation(vault: VaultLike, linkId: string): Promise<string> {
  const { content } = await api.getAnnotation(linkId);
  return decryptFieldForVault(vault, content);
}

export async function saveAnnotation(vault: VaultLike, linkId: string, content: string): Promise<void> {
  await api.saveAnnotation(linkId, await encryptFieldForVault(vault, content));
}

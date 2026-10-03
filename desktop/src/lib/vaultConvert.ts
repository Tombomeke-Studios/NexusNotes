import { ApiError } from "./api";
import { encryptNote, plaintextChecksum, DEFAULT_KDF, type KdfParams } from "./crypto";
import { setupVaultEncryption, sealField, type EncryptionMeta } from "./vaultKeys";
import type { LinkedFile } from "./api";
import type { Note, Vault } from "./types";

/** One note as sent to POST /api/vaults/{id}/encryption/convert. */
export interface ConvertNotePayload {
  id: string;
  /** Title and folder path, sealed under the new vault key (#362). */
  title: string;
  path: string;
  /** Ciphertext under the new vault key. */
  content: string;
  /** SHA-256 of the plaintext, kept by the server for conflict detection. */
  checksum: string;
  /** The server checksum the note was read at; a mismatch means it changed. */
  base_checksum: string;
}

/** One linked file with its name and source sealed under the new key (#410). */
export interface ConvertLinkPayload {
  id: string;
  display_name: string;
  source_ref: string;
}

export interface ConvertDeps {
  listNotes: (vaultId: string) => Promise<Note[]>;
  /** The vault's linked files as stored (the server refuses a conversion that leaves one out). */
  listLinks?: (vaultId: string) => Promise<LinkedFile[]>;
  convert: (vaultId: string, meta: EncryptionMeta, notes: ConvertNotePayload[], links: ConvertLinkPayload[]) => Promise<Vault>;
}

/** Attempts before a vault that keeps changing is reported as a conflict. */
const MAX_ATTEMPTS = 3;

/**
 * Turns a standard vault into an end-to-end encrypted one (#361): a new vault
 * key is wrapped under the passphrase, every note (content, title and folder
 * path) is encrypted on this device
 * and all of them go to the server in one request, which swaps them in
 * atomically. When a note changed in between (409) the notes are read and
 * encrypted again. The caller keeps the returned key in the session and shows
 * the recovery code exactly once.
 */
export async function convertVaultToE2ee(
  vaultId: string,
  passphrase: string,
  deps: ConvertDeps,
  cost: Pick<KdfParams, "m" | "t" | "p"> = DEFAULT_KDF,
): Promise<{ vault: Vault; vaultKey: Uint8Array; recoveryCode: string }> {
  const { meta, vaultKey, recoveryCode } = await setupVaultEncryption(passphrase, cost);
  for (let attempt = 1; ; attempt++) {
    const notes = await deps.listNotes(vaultId);
    const payload: ConvertNotePayload[] = [];
    for (const n of notes) {
      payload.push({
        id: n.id,
        title: await sealField(n.title, vaultKey),
        path: await sealField(n.path, vaultKey),
        content: await encryptNote(n.content, vaultKey),
        checksum: await plaintextChecksum(n.content),
        base_checksum: n.checksum,
      });
    }
    const links: ConvertLinkPayload[] = [];
    for (const l of (await deps.listLinks?.(vaultId)) ?? []) {
      links.push({
        id: l.id,
        display_name: await sealField(l.display_name, vaultKey),
        source_ref: await sealField(l.source_ref, vaultKey),
      });
    }
    try {
      const vault = await deps.convert(vaultId, meta, payload, links);
      return { vault, vaultKey, recoveryCode };
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 409) || attempt >= MAX_ATTEMPTS) throw err;
    }
  }
}

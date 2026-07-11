import {
  DEFAULT_KDF,
  generateSalt,
  deriveMasterKey,
  generateVaultKey,
  generateRecoveryKey,
  parseRecoveryCode,
  wrapKey,
  unwrapKey,
  encryptNote,
  decryptNote,
  plaintextChecksum,
  type KdfParams,
  type WrappedKey,
} from "./crypto";

/**
 * Vault-level key management on top of the crypto core (docs/encryption.md).
 * The server only ever sees the EncryptionMeta blob; passphrases, recovery
 * codes and unwrapped keys never leave this process.
 */

export interface EncryptionMeta {
  version: 1;
  kdf: KdfParams;
  wrapped_key: WrappedKey;
  recovery_wrapped_key: WrappedKey;
}

/** Optional KDF override; tests use tiny parameters to stay fast. */
type KdfCost = Pick<KdfParams, "m" | "t" | "p">;

async function buildMeta(
  vaultKey: Uint8Array,
  passphrase: string,
  cost: KdfCost,
): Promise<{ meta: EncryptionMeta; recoveryCode: string }> {
  const kdf: KdfParams = { algo: "argon2id", ...cost, salt: generateSalt() };
  const masterKey = await deriveMasterKey(passphrase, kdf);
  const recovery = generateRecoveryKey();

  return {
    meta: {
      version: 1,
      kdf,
      wrapped_key: await wrapKey(vaultKey, masterKey),
      recovery_wrapped_key: await wrapKey(vaultKey, recovery.key),
    },
    recoveryCode: recovery.code,
  };
}

/**
 * Enables encryption: generates the Vault Key and wraps it under both the
 * passphrase-derived Master Key and a fresh recovery key. The recovery code
 * must be shown to the user exactly once.
 */
export async function setupVaultEncryption(
  passphrase: string,
  cost: KdfCost = DEFAULT_KDF,
): Promise<{ meta: EncryptionMeta; vaultKey: Uint8Array; recoveryCode: string }> {
  const vaultKey = generateVaultKey();
  const { meta, recoveryCode } = await buildMeta(vaultKey, passphrase, cost);
  return { meta, vaultKey, recoveryCode };
}

/** Unlocks the Vault Key with the passphrase; throws when it is wrong. */
export async function unlockVaultKey(meta: EncryptionMeta, passphrase: string): Promise<Uint8Array> {
  if (!meta?.kdf?.salt || !meta.wrapped_key) {
    throw new Error("malformed encryption metadata");
  }
  const masterKey = await deriveMasterKey(passphrase, meta.kdf);
  return unwrapKey(meta.wrapped_key, masterKey);
}

/** Unlocks the Vault Key with the one-time recovery code. */
export async function recoverVaultKey(meta: EncryptionMeta, recoveryCode: string): Promise<Uint8Array> {
  if (!meta?.recovery_wrapped_key) {
    throw new Error("malformed encryption metadata");
  }
  return unwrapKey(meta.recovery_wrapped_key, parseRecoveryCode(recoveryCode));
}

/**
 * Re-wraps the (already unlocked) Vault Key under a new passphrase — used by
 * both the change-passphrase and the recovery flow. Notes are untouched; a
 * fresh recovery code replaces the old one.
 */
export async function rewrapVaultKey(
  vaultKey: Uint8Array,
  newPassphrase: string,
  cost: KdfCost = DEFAULT_KDF,
): Promise<{ meta: EncryptionMeta; recoveryCode: string }> {
  return buildMeta(vaultKey, newPassphrase, cost);
}

/**
 * In-memory store of unlocked Vault Keys for this app session. Nothing here
 * is ever persisted; locking a vault or closing the app drops the key.
 */
class VaultKeySession {
  private keys = new Map<string, Uint8Array>();

  set(vaultId: string, key: Uint8Array): void {
    this.keys.set(vaultId, key);
  }

  get(vaultId: string): Uint8Array | null {
    return this.keys.get(vaultId) ?? null;
  }

  lock(vaultId: string): void {
    this.keys.delete(vaultId);
  }

  clear(): void {
    this.keys.clear();
  }
}

export const vaultKeySession = new VaultKeySession();

// --- Note-level helpers: encrypt/decrypt against a vault's session key ---

/** The subset of the Vault model these helpers need. */
type VaultLike = { id: string; encryption?: "none" | "e2ee" };

/** Thrown when an e2ee operation is attempted while the vault key is not in memory. */
export class VaultLockedError extends Error {
  constructor(public vaultId: string) {
    super("vault is locked — unlock it with the passphrase first");
    this.name = "VaultLockedError";
  }
}

export function isE2eeVault(vault: VaultLike | null | undefined): boolean {
  return vault?.encryption === "e2ee";
}

export function isVaultLocked(vault: VaultLike | null | undefined): boolean {
  return isE2eeVault(vault) && vaultKeySession.get(vault!.id) === null;
}

function requireKey(vault: VaultLike): Uint8Array {
  const key = vaultKeySession.get(vault.id);
  if (!key) throw new VaultLockedError(vault.id);
  return key;
}

/**
 * Prepares note content for upload. Standard vaults pass through unchanged;
 * e2ee vaults get ciphertext plus the plaintext SHA-256 the server stores
 * verbatim for conflict detection (it can never recompute it).
 */
export async function encryptNoteForVault(
  vault: VaultLike,
  plaintext: string,
): Promise<{ content: string; checksum?: string }> {
  if (!isE2eeVault(vault)) return { content: plaintext };
  const key = requireKey(vault);
  return {
    content: await encryptNote(plaintext, key),
    checksum: await plaintextChecksum(plaintext),
  };
}

/** Turns stored note content back into plaintext for an e2ee vault. */
export async function decryptNoteForVault(vault: VaultLike, content: string): Promise<string> {
  if (!isE2eeVault(vault)) return content;
  return decryptNote(content, requireKey(vault));
}

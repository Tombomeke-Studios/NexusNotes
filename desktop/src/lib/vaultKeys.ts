import {
  DEFAULT_KDF,
  generateSalt,
  deriveMasterKey,
  generateVaultKey,
  generateRecoveryKey,
  parseRecoveryCode,
  wrapKey,
  unwrapKey,
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

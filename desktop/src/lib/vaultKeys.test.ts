import { describe, it, expect, beforeEach } from "vitest";
import {
  setupVaultEncryption,
  unlockVaultKey,
  rewrapVaultKey,
  recoverVaultKey,
  vaultKeySession,
  type EncryptionMeta,
} from "./vaultKeys";

// Tiny KDF parameters so tests stay fast; production uses the OWASP defaults.
const fastKdf = { m: 64, t: 1, p: 1 };

const hex = (b: Uint8Array) =>
  Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");

describe("vault encryption setup + unlock", () => {
  it("setup produces meta that unlocks with the right passphrase", async () => {
    const { meta, vaultKey, recoveryCode } = await setupVaultEncryption("hunter2-but-long", fastKdf);

    expect(meta.version).toBe(1);
    expect(meta.kdf.algo).toBe("argon2id");
    expect(recoveryCode).toMatch(/^([A-Z2-7]{4}-)+[A-Z2-7]{4}$/);

    const unlocked = await unlockVaultKey(meta, "hunter2-but-long");
    expect(hex(unlocked)).toBe(hex(vaultKey));
  });

  it("a wrong passphrase fails to unlock", async () => {
    const { meta } = await setupVaultEncryption("right-passphrase", fastKdf);
    await expect(unlockVaultKey(meta, "wrong-passphrase")).rejects.toThrow();
  });

  it("the recovery code unlocks the vault key", async () => {
    const { meta, vaultKey, recoveryCode } = await setupVaultEncryption("some-passphrase", fastKdf);
    const recovered = await recoverVaultKey(meta, recoveryCode);
    expect(hex(recovered)).toBe(hex(vaultKey));
  });

  it("rewrap changes the passphrase without changing the vault key", async () => {
    const { meta, vaultKey } = await setupVaultEncryption("old-passphrase", fastKdf);

    const { meta: newMeta, recoveryCode: newCode } = await rewrapVaultKey(vaultKey, "new-passphrase", fastKdf);

    const unlocked = await unlockVaultKey(newMeta, "new-passphrase");
    expect(hex(unlocked)).toBe(hex(vaultKey));
    await expect(unlockVaultKey(newMeta, "old-passphrase")).rejects.toThrow();
    // A fresh recovery code is issued and works against the new meta.
    expect(hex(await recoverVaultKey(newMeta, newCode))).toBe(hex(vaultKey));
    // The old wrap is fully replaced.
    expect(newMeta.wrapped_key.data).not.toBe(meta.wrapped_key.data);
  });
});

describe("in-memory key session", () => {
  beforeEach(() => vaultKeySession.clear());

  it("stores and retrieves unlocked keys per vault", async () => {
    const { vaultKey } = await setupVaultEncryption("p1-passphrase", fastKdf);
    vaultKeySession.set("v1", vaultKey);
    expect(vaultKeySession.get("v1")).toBe(vaultKey);
    expect(vaultKeySession.get("v2")).toBeNull();
  });

  it("lock drops a single vault; clear drops everything", async () => {
    const a = (await setupVaultEncryption("pa-passphrase", fastKdf)).vaultKey;
    const b = (await setupVaultEncryption("pb-passphrase", fastKdf)).vaultKey;
    vaultKeySession.set("v1", a);
    vaultKeySession.set("v2", b);

    vaultKeySession.lock("v1");
    expect(vaultKeySession.get("v1")).toBeNull();
    expect(vaultKeySession.get("v2")).toBe(b);

    vaultKeySession.clear();
    expect(vaultKeySession.get("v2")).toBeNull();
  });
});

describe("meta parsing safety", () => {
  it("unlock rejects malformed meta instead of crashing", async () => {
    const broken = { version: 1 } as unknown as EncryptionMeta;
    await expect(unlockVaultKey(broken, "whatever")).rejects.toThrow();
  });
});

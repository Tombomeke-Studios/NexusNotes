import { describe, it, expect } from "vitest";
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
} from "./crypto";

const hex = (b: Uint8Array) =>
  Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const bytesToB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

// Tiny Argon2id parameters so tests stay fast; production uses DEFAULT_KDF.
const testKdf = (salt: string): KdfParams => ({ algo: "argon2id", m: 64, t: 1, p: 1, salt });

describe("key derivation", () => {
  it("derives a 32-byte key, deterministic for the same passphrase and salt", async () => {
    const salt = generateSalt();
    const a = await deriveMasterKey("correct horse battery staple", testKdf(salt));
    const b = await deriveMasterKey("correct horse battery staple", testKdf(salt));
    expect(a).toHaveLength(32);
    expect(hex(a)).toBe(hex(b));
  });

  it("different salt or passphrase gives a different key", async () => {
    const salt = generateSalt();
    const base = await deriveMasterKey("pass-one", testKdf(salt));
    const otherPass = await deriveMasterKey("pass-two", testKdf(salt));
    const otherSalt = await deriveMasterKey("pass-one", testKdf(generateSalt()));
    expect(hex(base)).not.toBe(hex(otherPass));
    expect(hex(base)).not.toBe(hex(otherSalt));
  });

  it("production defaults follow OWASP (19 MiB, t=2, p=1)", () => {
    expect(DEFAULT_KDF).toMatchObject({ algo: "argon2id", m: 19456, t: 2, p: 1 });
  });
});

describe("vault key wrapping", () => {
  it("wraps and unwraps the vault key", async () => {
    const master = await deriveMasterKey("passphrase", testKdf(generateSalt()));
    const vaultKey = generateVaultKey();

    const wrapped = await wrapKey(vaultKey, master);
    const unwrapped = await unwrapKey(wrapped, master);
    expect(hex(unwrapped)).toBe(hex(vaultKey));
  });

  it("unwrapping with the wrong key fails", async () => {
    const master = await deriveMasterKey("right", testKdf(generateSalt()));
    const wrong = await deriveMasterKey("wrong", testKdf(generateSalt()));
    const wrapped = await wrapKey(generateVaultKey(), master);
    await expect(unwrapKey(wrapped, wrong)).rejects.toThrow();
  });
});

describe("note encryption", () => {
  it("round-trips content", async () => {
    const key = generateVaultKey();
    const payload = await encryptNote("# Secret note\n\nhello", key);
    expect(await decryptNote(payload, key)).toBe("# Secret note\n\nhello");
  });

  it("uses a fresh IV per encryption", async () => {
    const key = generateVaultKey();
    const a = await encryptNote("same content", key);
    const b = await encryptNote("same content", key);
    expect(a).not.toBe(b);
  });

  it("ciphertext does not contain the plaintext", async () => {
    const key = generateVaultKey();
    const payload = await encryptNote("very-secret-marker", key);
    expect(payload).not.toContain("very-secret-marker");
  });

  it("detects tampering", async () => {
    const key = generateVaultKey();
    const payload = await encryptNote("original", key);
    const [iv, data] = payload.split(":");
    const corrupted = b64ToBytes(data);
    corrupted[0] ^= 0xff;
    await expect(decryptNote(`${iv}:${bytesToB64(corrupted)}`, key)).rejects.toThrow();
  });

  it("decrypting with the wrong key fails", async () => {
    const payload = await encryptNote("original", generateVaultKey());
    await expect(decryptNote(payload, generateVaultKey())).rejects.toThrow();
  });
});

describe("plaintext checksum", () => {
  it("matches the known SHA-256 vector", async () => {
    expect(await plaintextChecksum("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
});

describe("recovery key", () => {
  it("generates a grouped base32 code that parses back to the same key", () => {
    const { key, code } = generateRecoveryKey();
    expect(key).toHaveLength(32);
    expect(code).toMatch(/^([A-Z2-7]{4}-)+[A-Z2-7]{4}$/);
    expect(hex(parseRecoveryCode(code))).toBe(hex(key));
  });

  it("parsing tolerates lowercase and stray whitespace", () => {
    const { key, code } = generateRecoveryKey();
    const sloppy = ` ${code.toLowerCase().split("-").join(" ")} `;
    expect(hex(parseRecoveryCode(sloppy))).toBe(hex(key));
  });

  it("rejects malformed codes", () => {
    expect(() => parseRecoveryCode("not-a-code")).toThrow();
    expect(() => parseRecoveryCode("ABCD-EF01")).toThrow(); // wrong length + invalid chars
  });

  it("the recovery key can wrap and unwrap the vault key", async () => {
    const { key } = generateRecoveryKey();
    const vaultKey = generateVaultKey();
    const wrapped = await wrapKey(vaultKey, key);
    expect(hex(await unwrapKey(wrapped, key))).toBe(hex(vaultKey));
  });
});

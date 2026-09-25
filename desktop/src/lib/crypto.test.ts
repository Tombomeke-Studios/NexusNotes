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
  bytesToBase64,
  base64ToBytes,
  type KdfParams,
} from "./crypto";

const hex = (b: Uint8Array) =>
  Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");

/** Boolean compare, so a failure never renders a multi-megabyte diff. */
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Deterministic pseudo-random bytes (xorshift32), so failures are reproducible. */
function pseudoRandomBytes(length: number, seed = 0x9e3779b9): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed >>> 0;
  for (let i = 0; i < length; i++) {
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    out[i] = x & 0xff;
  }
  return out;
}

/** Printable ASCII text of exactly `size` bytes (one byte per character). */
const asciiText = (size: number) =>
  new TextDecoder().decode(pseudoRandomBytes(size).map((b) => 0x20 + (b % 95)));

/** Byte-at-a-time reference encoder: slow but obviously correct and chunk-free. */
const referenceBase64 = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));

/** Shape of a stored note payload: base64(iv):base64(ciphertext+tag). */
const PAYLOAD_SHAPE = /^[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/;

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
    const corrupted = base64ToBytes(data);
    corrupted[0] ^= 0xff;
    await expect(decryptNote(`${iv}:${bytesToBase64(corrupted)}`, key)).rejects.toThrow();
  });

  it("decrypting with the wrong key fails", async () => {
    const payload = await encryptNote("original", generateVaultKey());
    await expect(decryptNote(payload, generateVaultKey())).rejects.toThrow();
  });
});

// #275: the encoder used to spread the whole buffer into one call, which
// threw RangeError from ~150 KB and made long encrypted notes unsaveable.
describe("note encryption at any size", () => {
  const SIZES: [string, number][] = [
    ["0 B", 0],
    ["1 B", 1],
    ["150 KB", 150 * 1024],
    ["1 MB", 1024 * 1024],
    ["5 MB", 5 * 1024 * 1024],
  ];

  it.each(SIZES)(
    "round-trips a %s note without changing the payload format",
    async (_label, size) => {
      const key = generateVaultKey();
      const plaintext = asciiText(size);

      const payload = await encryptNote(plaintext, key);
      expect(PAYLOAD_SHAPE.test(payload)).toBe(true);
      const [iv, data] = payload.split(":");
      expect(base64ToBytes(iv)).toHaveLength(12);
      expect(base64ToBytes(data)).toHaveLength(size + 16); // ciphertext + GCM tag

      const decrypted = await decryptNote(payload, key);
      expect(decrypted).toHaveLength(size);
      expect(decrypted === plaintext).toBe(true);
    },
    30_000,
  );
});

describe("base64 helpers", () => {
  it("encode and decode the RFC 4648 test vectors", () => {
    const vectors: [string, string][] = [
      ["", ""],
      ["f", "Zg=="],
      ["fo", "Zm8="],
      ["foo", "Zm9v"],
      ["foob", "Zm9vYg=="],
      ["fooba", "Zm9vYmE="],
      ["foobar", "Zm9vYmFy"],
    ];
    for (const [plain, encoded] of vectors) {
      const bytes = new TextEncoder().encode(plain);
      expect(bytesToBase64(bytes)).toBe(encoded);
      expect(sameBytes(base64ToBytes(encoded), bytes)).toBe(true);
    }
  });

  it("matches a reference encoding for every byte value", () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(bytesToBase64(all)).toBe(referenceBase64(all));
    expect(sameBytes(base64ToBytes(bytesToBase64(all)), all)).toBe(true);
  });

  // Lengths straddle 32 KiB multiples (a typical chunk size) and cover all
  // three base64 padding cases, so a chunk-boundary bug cannot hide.
  it.each([0x8000 - 1, 0x8000, 0x8000 + 1, 3 * 0x8000 + 2, 150 * 1024])(
    "matches a reference encoding for %i random bytes",
    (length) => {
      const bytes = pseudoRandomBytes(length, length);
      const encoded = bytesToBase64(bytes);
      expect(encoded === referenceBase64(bytes)).toBe(true);
      expect(sameBytes(base64ToBytes(encoded), bytes)).toBe(true);
    },
  );
});

// Produced by the original encoder (before #275) and committed verbatim:
// existing encrypted vaults hold exactly these shapes, so they must keep
// decrypting, and the new encoder must reproduce them byte for byte.
describe("ciphertext format compatibility", () => {
  const FIXTURE_KEY = Uint8Array.from({ length: 32 }, (_, i) => i);
  const FIXTURE_PLAINTEXT = "# Fixture note\n\nEncrypted before the chunked base64 fix (#275). Ünïcødé ✓";
  const FIXTURE_NOTE_PAYLOAD =
    "OdBQz0pbZTClZBXZ:tUgxEfYQIR1Viq3ImQCIe17JWtaRTlbtmMAtoP8qq4xRrASh9CeriX8W7+LgdKEag3DDpXtDNWQkE1zGfgMmInzKBXlcaZSQXEpKZfqQ0uqlZj1II0M8lutKCWp5O7M=";
  const FIXTURE_VAULT_KEY = Uint8Array.from({ length: 32 }, (_, i) => 0xa0 + i);
  const FIXTURE_WRAPPED = {
    iv: "kWQGpFVlcZiWeiWe",
    data: "0icT8+ztkTM6/BbiQBvKnsrlR9B4tqD1+KWMs8gVK+89Bi21g6mNI7MtsvERlGvG",
  };
  const FIXTURE_SALT = "AAECAwQFBgcICQoLDA0ODw==";
  const FIXTURE_MASTER_KEY = "d750eeabe3d60c1b9e69fba2de51831307e6fbd752f72333624f72d11085bea1";

  it("decrypts a note payload written by the original encoder", async () => {
    expect(await decryptNote(FIXTURE_NOTE_PAYLOAD, FIXTURE_KEY)).toBe(FIXTURE_PLAINTEXT);
  });

  it("re-encodes the stored payload parts byte for byte", () => {
    for (const part of FIXTURE_NOTE_PAYLOAD.split(":")) {
      expect(bytesToBase64(base64ToBytes(part))).toBe(part);
    }
    expect(bytesToBase64(base64ToBytes(FIXTURE_WRAPPED.data))).toBe(FIXTURE_WRAPPED.data);
  });

  it("unwraps a vault key written by the original encoder", async () => {
    expect(hex(await unwrapKey(FIXTURE_WRAPPED, FIXTURE_KEY))).toBe(hex(FIXTURE_VAULT_KEY));
  });

  it("derives the same master key from a stored base64 salt", async () => {
    const params: KdfParams = { algo: "argon2id", m: 64, t: 1, p: 1, salt: FIXTURE_SALT };
    expect(hex(await deriveMasterKey("fixture passphrase", params))).toBe(FIXTURE_MASTER_KEY);
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

import { argon2id } from "@noble/hashes/argon2.js";

/**
 * E2EE crypto core (see docs/encryption.md).
 *
 * Web Crypto (native) does AES-256-GCM, SHA-256 and randomness; Argon2id is
 * not part of Web Crypto and comes from the audited @noble/hashes. Keys are
 * raw 32-byte Uint8Arrays that must live in memory only — never persist them.
 */

export interface KdfParams {
  algo: "argon2id";
  /** Memory in KiB. */
  m: number;
  /** Iterations. */
  t: number;
  /** Parallelism. */
  p: number;
  /** Base64-encoded 16-byte salt. */
  salt: string;
}

/** OWASP Password Storage Cheat Sheet parameters. */
export const DEFAULT_KDF: Omit<KdfParams, "salt"> = { algo: "argon2id", m: 19456, t: 2, p: 1 };

/** A key encrypted under another key: base64 IV + base64 ciphertext(+tag). */
export interface WrappedKey {
  iv: string;
  data: string;
}

/**
 * Bytes per String.fromCharCode call. Spreading a whole buffer into one call
 * overflows the engine's argument limit from ~150 KB (#275), so the binary
 * string is built in slices; the base64 output is identical to a one-shot
 * encode, so the stored ciphertext format is unchanged.
 */
const B64_CHUNK = 0x8000;

/** Standard padded base64 (RFC 4648) of a byte array of any size. */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + B64_CHUNK)));
  }
  return btoa(parts.join(""));
}

/** Inverse of bytesToBase64; throws on malformed input. */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function generateSalt(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
}

export function generateVaultKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/** Derives the 256-bit Master Key from the vault passphrase. CPU-heavy by design. */
export async function deriveMasterKey(passphrase: string, params: KdfParams): Promise<Uint8Array> {
  return argon2id(new TextEncoder().encode(passphrase), base64ToBytes(params.salt), {
    m: params.m,
    t: params.t,
    p: params.p,
    dkLen: 32,
  });
}

async function importAesKey(raw: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, usages);
}

async function aesEncrypt(plaintext: Uint8Array, rawKey: Uint8Array): Promise<{ iv: Uint8Array; data: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importAesKey(rawKey, ["encrypt"]);
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plaintext as BufferSource);
  return { iv, data: new Uint8Array(data) };
}

async function aesDecrypt(iv: Uint8Array, data: Uint8Array, rawKey: Uint8Array): Promise<Uint8Array> {
  const key = await importAesKey(rawKey, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, data as BufferSource);
  return new Uint8Array(plain);
}

/** Wraps (encrypts) the Vault Key under the Master Key or recovery key. */
export async function wrapKey(vaultKey: Uint8Array, wrappingKey: Uint8Array): Promise<WrappedKey> {
  const { iv, data } = await aesEncrypt(vaultKey, wrappingKey);
  return { iv: bytesToBase64(iv), data: bytesToBase64(data) };
}

/** Unwraps the Vault Key; throws when the wrapping key is wrong (GCM tag mismatch). */
export async function unwrapKey(wrapped: WrappedKey, wrappingKey: Uint8Array): Promise<Uint8Array> {
  return aesDecrypt(base64ToBytes(wrapped.iv), base64ToBytes(wrapped.data), wrappingKey);
}

/** Encrypts note content; the payload is "base64(iv):base64(ciphertext+tag)". */
export async function encryptNote(plaintext: string, vaultKey: Uint8Array): Promise<string> {
  const { iv, data } = await aesEncrypt(new TextEncoder().encode(plaintext), vaultKey);
  return `${bytesToBase64(iv)}:${bytesToBase64(data)}`;
}

/** Decrypts a note payload; throws on tampering or a wrong key. */
export async function decryptNote(payload: string, vaultKey: Uint8Array): Promise<string> {
  const sep = payload.indexOf(":");
  if (sep < 0) throw new Error("malformed encrypted payload");
  const iv = base64ToBytes(payload.slice(0, sep));
  const data = base64ToBytes(payload.slice(sep + 1));
  return new TextDecoder().decode(await aesDecrypt(iv, data, vaultKey));
}

/** SHA-256 hex of the plaintext, computed before encryption (conflict detection). */
export async function plaintextChecksum(plaintext: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(plaintext));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// --- Recovery key (base32 backup code) ---

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Uint8Array {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of s) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx < 0) throw new Error("invalid recovery code character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/**
 * Generates a random 256-bit recovery key and its human-readable code
 * (grouped base32, e.g. "Q7MX-2APF-…"). The code is shown exactly once.
 */
export function generateRecoveryKey(): { key: Uint8Array; code: string } {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const raw = base32Encode(key);
  const code = raw.match(/.{1,4}/g)!.join("-");
  return { key, code };
}

/** Parses a recovery code back into the key; tolerant of case, spaces and dashes. */
export function parseRecoveryCode(code: string): Uint8Array {
  const cleaned = code.toUpperCase().replace(/[\s-]/g, "");
  const key = base32Decode(cleaned);
  if (key.length !== 32) throw new Error("recovery code has the wrong length");
  return key;
}

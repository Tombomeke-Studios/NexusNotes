import { encryptBytes, decryptBytes } from "./crypto";
import type { Attachment } from "./api";

/**
 * End-to-end encryption of attachment files (#238). The bytes are encrypted
 * with the vault key, and so are the file's name and type: they travel as the
 * upload's file name, "e2ee.<base64url(encrypted {name, type})>.bin", so the
 * server never sees either. Files from before (or in standard vaults) keep a
 * plain name and are passed through.
 */
const PREFIX = "e2ee.";
const SUFFIX = ".bin";

interface AttachmentMeta {
  name: string;
  type: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Reads a Blob's bytes (FileReader fallback for environments without Blob.arrayBuffer). */
export function readBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer().then((b) => new Uint8Array(b));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/** Whether a stored file name carries encrypted metadata. */
export function isEncryptedAttachmentName(name: string): boolean {
  return name.startsWith(PREFIX) && name.endsWith(SUFFIX);
}

/** Encrypts a file for upload: opaque bytes under an opaque name. */
export async function encryptAttachment(file: File, vaultKey: Uint8Array): Promise<File> {
  const meta: AttachmentMeta = { name: file.name, type: file.type };
  const sealedMeta = await encryptBytes(new TextEncoder().encode(JSON.stringify(meta)), vaultKey);
  const sealedBytes = await encryptBytes(await readBytes(file), vaultKey);
  return new File([sealedBytes as BlobPart], PREFIX + toBase64Url(sealedMeta) + SUFFIX, {
    type: "application/octet-stream",
  });
}

/** Restores the real name and type of an encrypted attachment (others pass through). */
export async function decryptAttachmentMeta(att: Attachment, vaultKey: Uint8Array): Promise<Attachment> {
  if (!isEncryptedAttachmentName(att.filename)) return att;
  const sealed = fromBase64Url(att.filename.slice(PREFIX.length, -SUFFIX.length));
  const meta = JSON.parse(new TextDecoder().decode(await decryptBytes(sealed, vaultKey))) as AttachmentMeta;
  return { ...att, filename: meta.name, mime_type: meta.type || "application/octet-stream" };
}

/** Decrypts downloaded attachment bytes. */
export function decryptAttachmentBytes(bytes: Uint8Array, vaultKey: Uint8Array): Promise<Uint8Array> {
  return decryptBytes(bytes, vaultKey);
}

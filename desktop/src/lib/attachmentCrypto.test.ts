import { describe, it, expect } from "vitest";
import { generateVaultKey } from "./crypto";
import {
  encryptAttachment,
  decryptAttachmentMeta,
  decryptAttachmentBytes,
  isEncryptedAttachmentName,
  readBytes,
} from "./attachmentCrypto";
import type { Attachment } from "./api";

function attachment(filename: string, mime = "application/octet-stream"): Attachment {
  return { id: "a1", note_id: "n1", vault_id: "v1", filename, mime_type: mime, size_bytes: 0, created_at: "" } as Attachment;
}

// Files in e2ee vaults are encrypted on the device, name and type included (#238).
describe("attachment encryption", () => {
  it("round-trips the bytes, name and type", async () => {
    const key = generateVaultKey();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 0, 255]);
    const file = new File([bytes], "holiday photo.png", { type: "image/png" });

    const sealed = await encryptAttachment(file, key);
    expect(isEncryptedAttachmentName(sealed.name)).toBe(true);
    expect(sealed.name).not.toContain("holiday");
    expect(sealed.name).not.toMatch(/[/\\:+=\s]/); // safe as a multipart file name
    expect(sealed.type).toBe("application/octet-stream");
    const uploaded = await readBytes(sealed);
    expect(uploaded.length).toBeGreaterThan(bytes.length); // IV + tag
    expect(Array.from(uploaded.slice(12, 12 + bytes.length))).not.toEqual(Array.from(bytes));

    const meta = await decryptAttachmentMeta(attachment(sealed.name), key);
    expect(meta.filename).toBe("holiday photo.png");
    expect(meta.mime_type).toBe("image/png");
    expect(Array.from(await decryptAttachmentBytes(uploaded, key))).toEqual(Array.from(bytes));
  });

  it("leaves a file stored without encryption as it is", async () => {
    const plain = attachment("old.pdf", "application/pdf");
    expect(isEncryptedAttachmentName("old.pdf")).toBe(false);
    expect(await decryptAttachmentMeta(plain, generateVaultKey())).toEqual(plain);
  });

  it("refuses bytes under another key", async () => {
    const sealed = await encryptAttachment(new File(["secret"], "a.txt", { type: "text/plain" }), generateVaultKey());
    await expect(decryptAttachmentBytes(await readBytes(sealed), generateVaultKey())).rejects.toThrow();
  });
});

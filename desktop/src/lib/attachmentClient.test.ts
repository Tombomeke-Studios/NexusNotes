import { describe, it, expect, vi, beforeEach } from "vitest";

const store = new Map<string, { filename: string; mime: string; bytes: Uint8Array }>();
let nextId = 0;

vi.mock("./api", async (orig) => {
  const actual = await orig<typeof import("./api")>();
  const { readBytes } = await import("./attachmentCrypto");
  const toAtt = (id: string) => ({
    id, note_id: "n1", vault_id: "v1", filename: store.get(id)!.filename,
    mime_type: store.get(id)!.mime, size_bytes: 0, created_at: "",
  });
  return {
    ...actual,
    attachments: {
      list: vi.fn(async () => [...store.keys()].map(toAtt)),
      upload: vi.fn(async (_note: string, file: File) => {
        const id = `a${++nextId}`;
        store.set(id, { filename: file.name, mime: file.type, bytes: await readBytes(file) });
        return toAtt(id);
      }),
      bytes: vi.fn(async (id: string) => new Blob([store.get(id)!.bytes as BlobPart])),
      objectUrl: vi.fn(async (id: string) => `plain:${id}`),
    },
  };
});

import { listAttachments, uploadAttachment, attachmentObjectUrl } from "./attachmentClient";
import { vaultKeySession } from "./vaultKeys";
import { generateVaultKey } from "./crypto";
import { readBytes } from "./attachmentCrypto";

describe("attachment client (#238)", () => {
  beforeEach(() => {
    store.clear();
    vaultKeySession.clear();
  });

  it("encrypts uploads in an e2ee vault and hands back the real name and type", async () => {
    vaultKeySession.set("v1", generateVaultKey());
    const vault = { id: "v1", encryption: "e2ee" as const };
    const att = await uploadAttachment("n1", new File(["top secret"], "plan.txt", { type: "text/plain" }), vault);

    expect(att.filename).toBe("plan.txt");
    expect(att.mime_type).toBe("text/plain");
    const stored = [...store.values()][0];
    expect(stored.filename).not.toContain("plan");
    expect(stored.mime).toBe("application/octet-stream");
    expect(new TextDecoder().decode(stored.bytes)).not.toContain("top secret");

    const [listed] = await listAttachments("n1", vault);
    expect(listed.filename).toBe("plan.txt");

    let captured: Blob | null = null;
    const create = vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
      captured = b as Blob;
      return "blob:x";
    });
    await attachmentObjectUrl(listed);
    expect(new TextDecoder().decode(await readBytes(captured!))).toBe("top secret");
    expect(captured!.type).toBe("application/octet-stream"); // text is never served as a document
    create.mockRestore();
  });

  it("uses the API as it is for a standard vault", async () => {
    const vault = { id: "v2", encryption: "none" as const };
    const att = await uploadAttachment("n1", new File(["hi"], "a.txt", { type: "text/plain" }), vault);
    expect(att.filename).toBe("a.txt");
    expect(await attachmentObjectUrl(att)).toBe(`plain:${att.id}`);
  });

  it("refuses while the e2ee vault is locked", async () => {
    await expect(
      uploadAttachment("n1", new File(["x"], "a.txt"), { id: "v1", encryption: "e2ee" }),
    ).rejects.toThrow(/locked/);
    expect(store.size).toBe(0);
  });
});

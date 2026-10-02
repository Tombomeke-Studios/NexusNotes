import { describe, it, expect, vi } from "vitest";
import { convertVaultToE2ee, type ConvertNotePayload } from "./vaultConvert";
import { ApiError } from "./api";
import { decryptNote, plaintextChecksum } from "./crypto";
import type { Note, Vault } from "./types";

const fastKdf = { m: 64, t: 1, p: 1 };

function note(id: string, content: string, checksum = `sum-${id}`): Note {
  return { id, vault_id: "v1", path: "", title: id, content, checksum, created_at: "", updated_at: "" };
}

const converted = { id: "v1", name: "V", encryption: "e2ee" } as unknown as Vault;

// Converting a standard vault encrypts every note on this device and sends
// them at once (#361).
describe("convertVaultToE2ee", () => {
  it("encrypts every note under a new vault key and returns the recovery code", async () => {
    const notes = [note("a", "alpha"), note("b", "beta")];
    let sent: ConvertNotePayload[] = [];
    const convert = vi.fn(async (_id: string, _meta: unknown, payload: ConvertNotePayload[]) => {
      sent = payload;
      return converted;
    });

    const out = await convertVaultToE2ee("v1", "a strong passphrase", { listNotes: async () => notes, convert }, fastKdf);

    expect(out.vault).toBe(converted);
    expect(out.recoveryCode).toMatch(/^([A-Z2-7]{4}-)+[A-Z2-7]{4}$/);
    expect(convert).toHaveBeenCalledOnce();
    expect(convert.mock.calls[0][1]).toHaveProperty("wrapped_key");
    expect(sent.map((n) => n.id)).toEqual(["a", "b"]);
    for (const [i, plain] of ["alpha", "beta"].entries()) {
      expect(sent[i].content).not.toContain(plain);
      expect(await decryptNote(sent[i].content, out.vaultKey)).toBe(plain);
      expect(sent[i].checksum).toBe(await plaintextChecksum(plain));
      expect(sent[i].base_checksum).toBe(notes[i].checksum);
    }
  });

  it("re-reads and retries when a note changed meanwhile (409)", async () => {
    const listNotes = vi
      .fn()
      .mockResolvedValueOnce([note("a", "old", "s1")])
      .mockResolvedValueOnce([note("a", "new", "s2")]);
    const convert = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, "changed"))
      .mockResolvedValueOnce(converted);

    const out = await convertVaultToE2ee("v1", "a strong passphrase", { listNotes, convert }, fastKdf);

    expect(convert).toHaveBeenCalledTimes(2);
    const second = convert.mock.calls[1][2] as ConvertNotePayload[];
    expect(second[0].base_checksum).toBe("s2");
    expect(await decryptNote(second[0].content, out.vaultKey)).toBe("new");
  });

  it("gives up after repeated conflicts and passes other errors through", async () => {
    const busy = vi.fn().mockRejectedValue(new ApiError(409, "changed"));
    await expect(
      convertVaultToE2ee("v1", "a strong passphrase", { listNotes: async () => [], convert: busy }, fastKdf),
    ).rejects.toMatchObject({ status: 409 });
    expect(busy).toHaveBeenCalledTimes(3);

    const refused = vi.fn().mockRejectedValue(new ApiError(422, "vaults with attachments cannot be end-to-end encrypted yet"));
    await expect(
      convertVaultToE2ee("v1", "a strong passphrase", { listNotes: async () => [], convert: refused }, fastKdf),
    ).rejects.toMatchObject({ status: 422 });
    expect(refused).toHaveBeenCalledOnce();
  });
});

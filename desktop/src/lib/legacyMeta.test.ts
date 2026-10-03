import { describe, it, expect, beforeEach, vi } from "vitest";
import { sealLegacyMeta, needsMetaSeal } from "./legacyMeta";
import { decryptFieldForVault, encryptFieldForVault, vaultKeySession } from "./vaultKeys";
import { generateVaultKey } from "./crypto";
import type { Note } from "./types";

const vault = { id: "v1", encryption: "e2ee" as const };

function note(id: string, title: string, path: string): Note {
  return { id, vault_id: "v1", title, path, content: `iv:cipher-${id}`, checksum: `sum-${id}`, created_at: "", updated_at: "" };
}

// Notes created before #362 have a plaintext title/path on the server.
describe("sealLegacyMeta", () => {
  beforeEach(() => vaultKeySession.clear());

  it("re-sends plaintext titles and paths sealed, with content and checksum unchanged", async () => {
    vaultKeySession.set(vault.id, generateVaultKey());
    const done = note("b", await encryptFieldForVault(vault, "Done"), await encryptFieldForVault(vault, ""));
    const put = vi.fn(async () => ({}));

    const count = await sealLegacyMeta([note("a", "Plans", "Projects/2026"), done], vault, put);

    expect(count).toBe(1);
    expect(put).toHaveBeenCalledOnce();
    const [id, title, path, content, prev, checksum] = put.mock.calls[0] as unknown as string[];
    expect([id, content, prev, checksum]).toEqual(["a", "iv:cipher-a", "sum-a", "sum-a"]);
    expect(needsMetaSeal({ ...note("a", title, path) })).toBe(false);
    expect(await decryptFieldForVault(vault, title)).toBe("Plans");
    expect(await decryptFieldForVault(vault, path)).toBe("Projects/2026");
  });

  it("does nothing while the vault is locked or for a standard vault", async () => {
    const put = vi.fn(async () => ({}));
    expect(await sealLegacyMeta([note("a", "Plans", "")], vault, put)).toBe(0);
    expect(await sealLegacyMeta([note("a", "Plans", "")], { id: "v2", encryption: "none" }, put)).toBe(0);
    expect(put).not.toHaveBeenCalled();
  });

  it("skips a note the server refuses and carries on", async () => {
    vaultKeySession.set(vault.id, generateVaultKey());
    const put = vi.fn().mockRejectedValueOnce(new Error("403")).mockResolvedValueOnce({});
    expect(await sealLegacyMeta([note("a", "A", ""), note("b", "B", "")], vault, put)).toBe(1);
    expect(put).toHaveBeenCalledTimes(2);
  });
});

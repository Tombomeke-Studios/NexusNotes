import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    links: {
      list: vi.fn(),
      create: vi.fn(),
      content: vi.fn(),
      fetchContent: vi.fn(),
      getAnnotation: vi.fn(),
      saveAnnotation: vi.fn(),
    },
  };
});

import { links as api, type LinkedFile } from "./api";
import { listLinks, createLink, linkContent, getAnnotation, saveAnnotation } from "./linkedFiles";
import { vaultKeySession, isEncryptedField, encryptFieldForVault, VaultLockedError } from "./vaultKeys";
import { generateVaultKey } from "./crypto";

const e2ee = { id: "v1", encryption: "e2ee" as const };
const plain = { id: "v2", encryption: "none" as const };

function link(over: Partial<LinkedFile> = {}): LinkedFile {
  return { id: "l1", vault_id: "v1", display_name: "Docs", source_type: "url", source_ref: "https://example.com", read_only: true, created_at: "", ...over };
}

beforeEach(() => {
  vi.resetAllMocks();
  vaultKeySession.clear();
});

// Linked files of an e2ee vault are sealed on the device (#364).
describe("linked files in an e2ee vault", () => {
  beforeEach(() => vaultKeySession.set(e2ee.id, generateVaultKey()));

  it("creates a link with a sealed name and source", async () => {
    vi.mocked(api.create).mockImplementation(async (_v, input) => link({ ...input }));
    const created = await createLink(e2ee, { display_name: "Docs", source_type: "url", source_ref: "https://example.com/a" });
    const sent = vi.mocked(api.create).mock.calls[0][1];
    expect(isEncryptedField(sent.display_name)).toBe(true);
    expect(isEncryptedField(sent.source_ref)).toBe(true);
    expect(sent.source_type).toBe("url");
    expect(created).toMatchObject({ display_name: "Docs", source_ref: "https://example.com/a" });
  });

  it("lists links decrypted, legacy plaintext included", async () => {
    vi.mocked(api.list).mockResolvedValue([
      link({ display_name: await encryptFieldForVault(e2ee, "Sealed"), source_ref: await encryptFieldForVault(e2ee, "https://s.example") }),
      link({ id: "l2", display_name: "Old", source_ref: "https://old.example" }),
    ]);
    const list = await listLinks(e2ee);
    expect(list.map((l) => [l.display_name, l.source_ref])).toEqual([
      ["Sealed", "https://s.example"],
      ["Old", "https://old.example"],
    ]);
  });

  it("fetches content by sending the decrypted URL", async () => {
    vi.mocked(api.fetchContent).mockResolvedValue({ content: "x", content_type: "text/plain", fetched_at: "" });
    await linkContent(e2ee, link({ source_ref: "https://example.com/a" }));
    expect(api.fetchContent).toHaveBeenCalledWith("l1", "https://example.com/a");
    expect(api.content).not.toHaveBeenCalled();
  });

  it("seals annotations and opens them again", async () => {
    vi.mocked(api.saveAnnotation).mockResolvedValue(undefined);
    await saveAnnotation(e2ee, "l1", "my private thoughts");
    const sent = vi.mocked(api.saveAnnotation).mock.calls[0][1];
    expect(sent).not.toContain("private");
    vi.mocked(api.getAnnotation).mockResolvedValue({ content: sent });
    expect(await getAnnotation(e2ee, "l1")).toBe("my private thoughts");
  });

  it("keeps an empty annotation empty", async () => {
    vi.mocked(api.getAnnotation).mockResolvedValue({ content: "" });
    expect(await getAnnotation(e2ee, "l1")).toBe("");
  });

  it("refuses to work on a locked vault", async () => {
    vaultKeySession.clear();
    await expect(createLink(e2ee, { display_name: "D", source_type: "url", source_ref: "https://x" })).rejects.toBeInstanceOf(VaultLockedError);
    expect(api.create).not.toHaveBeenCalled();
  });
});

describe("linked files in a standard vault", () => {
  it("uses the API as it is", async () => {
    vi.mocked(api.create).mockImplementation(async (_v, input) => link({ ...input }));
    vi.mocked(api.content).mockResolvedValue({ content: "x", content_type: "", fetched_at: "" });
    await createLink(plain, { display_name: "Docs", source_type: "url", source_ref: "https://example.com" });
    expect(vi.mocked(api.create).mock.calls[0][1].source_ref).toBe("https://example.com");
    await linkContent(plain, link());
    expect(api.content).toHaveBeenCalledWith("l1");
    await saveAnnotation(plain, "l1", "hi");
    expect(api.saveAnnotation).toHaveBeenCalledWith("l1", "hi");
  });
});

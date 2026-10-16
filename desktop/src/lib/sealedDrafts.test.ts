import { beforeEach, describe, expect, it } from "vitest";
import { generateVaultKey } from "./crypto";
import {
  UnreadableDraftError,
  clearSealedDraft,
  flushSealedDrafts,
  hasSealedDraft,
  openDraft,
  readSealedDraft,
  rebaseSealedDraft,
  sealDraft,
  sealedDraftNoteIds,
  writeSealedDraft,
} from "./sealedDrafts";

const NOTE = "7b0f8c1e-1d2a-4f00-9a51-3c1d2e4f5a6b";
const key = generateVaultKey();

function storedNames(): string[] {
  const names: string[] = [];
  for (let i = 0; i < localStorage.length; i++) names.push(localStorage.key(i)!);
  return names;
}

function everythingStored(): string {
  const parts: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const name = localStorage.key(i)!;
    parts.push(name, localStorage.getItem(name) ?? "");
  }
  return parts.join("\n");
}

beforeEach(() => localStorage.clear());

describe("sealed drafts — format", () => {
  it("round-trips the text and its base checksum", async () => {
    const stored = await sealDraft("v1", NOTE, { content: "secret plan", base: "c0" }, key);
    expect(await openDraft(stored, "v1", NOTE, key)).toEqual({ content: "secret plan", base: "c0" });
  });

  it("stores neither the text nor the checksum in clear", async () => {
    const stored = await sealDraft("v1", NOTE, { content: "secret plan", base: "checksum-abc" }, key);
    expect(stored).not.toContain("secret");
    expect(stored).not.toContain("checksum-abc");
  });

  it("uses a fresh IV for every write of the same text", async () => {
    const a = await sealDraft("v1", NOTE, { content: "same", base: null }, key);
    const b = await sealDraft("v1", NOTE, { content: "same", base: null }, key);
    expect(a).not.toBe(b);
  });

  it("only opens for the note and vault it was written for, and with the right key", async () => {
    const stored = await sealDraft("v1", NOTE, { content: "x", base: null }, key);
    await expect(openDraft(stored, "v1", "other-note", key)).rejects.toBeInstanceOf(UnreadableDraftError);
    await expect(openDraft(stored, "v2", NOTE, key)).rejects.toBeInstanceOf(UnreadableDraftError);
    await expect(openDraft(stored, "v1", NOTE, generateVaultKey())).rejects.toBeInstanceOf(UnreadableDraftError);
    await expect(openDraft("not json", "v1", NOTE, key)).rejects.toBeInstanceOf(UnreadableDraftError);
  });
});

describe("sealed drafts — storage", () => {
  it("writes under an opaque name and reads it back", async () => {
    expect(await writeSealedDraft("v1", NOTE, { content: "typed offline", base: "c0" }, key)).toBe("stored");
    expect(storedNames()).toEqual([`nexus_sealed_draft_${NOTE}`]);
    expect(everythingStored()).not.toContain("typed offline");
    expect(hasSealedDraft(NOTE)).toBe(true);
    expect(await readSealedDraft("v1", NOTE, key)).toEqual({ content: "typed offline", base: "c0" });
  });

  it("keeps only the newest of quick successive writes", async () => {
    const first = writeSealedDraft("v1", NOTE, { content: "a", base: "c0" }, key);
    const second = writeSealedDraft("v1", NOTE, { content: "ab", base: "c0" }, key);
    const third = writeSealedDraft("v1", NOTE, { content: "abc", base: "c0" }, key);
    expect(await third).toBe("stored");
    expect(["stored", "superseded"]).toContain(await first);
    expect(await second).toBe("superseded");
    expect((await readSealedDraft("v1", NOTE, key))?.content).toBe("abc");
  });

  it("does not let a write under way land after a clear", async () => {
    const pending = writeSealedDraft("v1", NOTE, { content: "late", base: null }, key);
    clearSealedDraft(NOTE);
    expect(await pending).toBe("superseded");
    expect(hasSealedDraft(NOTE)).toBe(false);
  });

  it("reports an unreadable draft and keeps it on disk", async () => {
    await writeSealedDraft("v1", NOTE, { content: "x", base: null }, key);
    await expect(readSealedDraft("v1", NOTE, generateVaultKey())).rejects.toBeInstanceOf(UnreadableDraftError);
    expect(hasSealedDraft(NOTE)).toBe(true);
  });

  it("returns null when the note has no draft", async () => {
    expect(await readSealedDraft("v1", NOTE, key)).toBeNull();
  });

  it("rebases the draft only while it is still on the old version", async () => {
    await writeSealedDraft("v1", NOTE, { content: "x", base: "c0" }, key);
    await rebaseSealedDraft("v1", NOTE, "c0", "c1", key);
    expect((await readSealedDraft("v1", NOTE, key))?.base).toBe("c1");
    await rebaseSealedDraft("v1", NOTE, "c0", "c9", key);
    expect((await readSealedDraft("v1", NOTE, key))?.base).toBe("c1");
  });

  it("lists the notes of a vault that have a draft", async () => {
    await writeSealedDraft("v1", "n-a", { content: "a", base: null }, key);
    await writeSealedDraft("v2", "n-b", { content: "b", base: null }, key);
    localStorage.setItem("nexus_draft_n-c", "plain draft of a standard vault");
    expect(sealedDraftNoteIds("v1")).toEqual(["n-a"]);
  });

  it("flushes every write under way", async () => {
    void writeSealedDraft("v1", NOTE, { content: "x", base: null }, key);
    await flushSealedDrafts();
    expect(hasSealedDraft(NOTE)).toBe(true);
  });
});

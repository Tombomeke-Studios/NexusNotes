import { describe, it, expect, vi, beforeEach } from "vitest";
import { deviceLabel, groupByDay, diffSummary, loadVersionText } from "./versionHistory";
import { diffLines } from "./diff";
import { vaultKeySession, encryptNoteForVault } from "./vaultKeys";
import { generateVaultKey } from "./crypto";
import type { NoteVersionInfo } from "./types";

function v(id: string, updated: string): NoteVersionInfo {
  return { id, note_id: "n1", checksum: id, device_id: "", created_at: updated, updated_at: updated };
}

describe("deviceLabel", () => {
  const names = new Map([["d2", "Work laptop"]]);
  it("names this device, a known device, or neither", () => {
    expect(deviceLabel("d1", "d1", names)).toBe("This device");
    expect(deviceLabel("d2", "d1", names)).toBe("Work laptop");
    expect(deviceLabel("d3", "d1", names)).toBe("Another device");
    expect(deviceLabel("", "d1", names)).toBe("Unknown device");
  });
});

describe("groupByDay", () => {
  it("groups newest first under Today, Yesterday and the date", () => {
    const now = new Date(2026, 9, 3, 15, 0);
    const iso = (d: number, h: number) => new Date(2026, 9, d, h, 0).toISOString();
    const groups = groupByDay([v("a", iso(3, 14)), v("b", iso(3, 9)), v("c", iso(2, 20)), v("d", iso(1, 8))], now);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ["Today", ["a", "b"]],
      ["Yesterday", ["c"]],
      [new Date(2026, 9, 1).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }), ["d"]],
    ]);
  });
});

describe("diffSummary", () => {
  it("counts the lines only in each text", () => {
    expect(diffSummary(diffLines("a\nb\nc", "a\nB\nc\nd"))).toEqual({ onlyLeft: 1, onlyRight: 2 });
  });
});

describe("loadVersionText", () => {
  beforeEach(() => vaultKeySession.clear());

  it("returns a standard vault's version as stored", async () => {
    const fetch = vi.fn(async () => ({ ...v("x", ""), content: "hello" }));
    expect(await loadVersionText({ id: "v", encryption: "none" }, "n1", "x", fetch)).toBe("hello");
    expect(fetch).toHaveBeenCalledWith("n1", "x");
  });

  it("decrypts an e2ee vault's version on this device", async () => {
    const vault = { id: "v", encryption: "e2ee" as const };
    vaultKeySession.set("v", generateVaultKey());
    const { content } = await encryptNoteForVault(vault, "secret text");
    const fetch = vi.fn(async () => ({ ...v("x", ""), content }));
    expect(await loadVersionText(vault, "n1", "x", fetch)).toBe("secret text");
  });

  it("reads a version without content as empty", async () => {
    const fetch = vi.fn(async () => ({ ...v("x", "") }) as never);
    expect(await loadVersionText({ id: "v", encryption: "none" }, "n1", "x", fetch)).toBe("");
  });
});

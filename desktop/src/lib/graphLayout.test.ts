import { describe, it, expect } from "vitest";
import {
  seedPositions,
  enterDelay,
  MAX_ENTER_DELAY,
  fitTransform,
  MAX_FIT_SCALE,
  MIN_FIT_SCALE,
  folderColorIndex,
  folderColorSlots,
  FOLDER_COLOR_COUNT,
} from "./graphLayout";

describe("seedPositions", () => {
  it("starts new nodes in a small cloud around the centre", () => {
    const out = seedPositions([{ id: "a" }, { id: "b" }, { id: "c" }], new Map(), 400, 300);
    for (const n of out.nodes) {
      expect(Math.hypot(n.x - 200, n.y - 150)).toBeLessThanOrEqual(40);
    }
    expect(new Set(out.nodes.map((n) => `${n.x},${n.y}`)).size).toBe(3);
    expect(out.reused).toBe(0);
  });

  it("keeps where known nodes were, so a re-render doesn't re-lay out the graph", () => {
    const prev = new Map([["a", { x: 12, y: 34 }]]);
    const out = seedPositions([{ id: "a" }, { id: "b" }], prev, 400, 300);
    expect(out.nodes[0]).toMatchObject({ id: "a", x: 12, y: 34 });
    expect(out.reused).toBe(1);
  });

  it("is deterministic for the same ids", () => {
    const a = seedPositions([{ id: "n1" }], new Map(), 400, 300).nodes[0];
    const b = seedPositions([{ id: "n1" }], new Map(), 400, 300).nodes[0];
    expect(a).toEqual(b);
  });
});

describe("enterDelay", () => {
  it("staggers nodes but caps the total wait", () => {
    expect(enterDelay(0, 10)).toBe(0);
    expect(enterDelay(1, 10)).toBeGreaterThan(0);
    expect(enterDelay(999, 1000)).toBeLessThanOrEqual(MAX_ENTER_DELAY);
    expect(enterDelay(9, 10)).toBeGreaterThan(enterDelay(4, 10));
  });
});

describe("fitTransform (#267)", () => {
  it("centres the nodes and scales them to fit with padding", () => {
    const t = fitTransform([{ x: 0, y: 0 }, { x: 200, y: 100 }], 400, 300, 50);
    // 200x100 into (400-100)x(300-100) → limited by height: 200/100 = 2, capped at MAX_FIT_SCALE.
    expect(t.k).toBe(MAX_FIT_SCALE);
    expect(t.x + t.k * 100).toBeCloseTo(200); // the middle maps to the centre
    expect(t.y + t.k * 50).toBeCloseTo(150);
  });

  it("zooms out for a wide graph, but not below the minimum", () => {
    const t = fitTransform([{ x: 0, y: 0 }, { x: 1000, y: 10 }], 400, 300, 20);
    expect(t.k).toBeCloseTo(360 / 1000);
    const tiny = fitTransform([{ x: 0, y: 0 }, { x: 100000, y: 0 }], 400, 300, 20);
    expect(tiny.k).toBe(MIN_FIT_SCALE);
  });

  it("leaves an empty graph alone", () => {
    expect(fitTransform([], 400, 300)).toEqual({ k: 1, x: 0, y: 0 });
  });
});

describe("folderColorIndex (#267)", () => {
  it("gives root notes no folder colour and folders a stable one", () => {
    expect(folderColorIndex("")).toBeNull();
    expect(folderColorIndex("Projects")).toBe(folderColorIndex("Projects"));
    const i = folderColorIndex("Projects")!;
    expect(i).toBeGreaterThanOrEqual(1);
    expect(i).toBeLessThanOrEqual(FOLDER_COLOR_COUNT);
  });
});

describe("folderColorSlots (#593)", () => {
  it("gives a vault's folders their own slot in sorted order", () => {
    const slots = folderColorSlots(["Templates", "Examples", "Daily", "Examples"]);
    expect([...slots.entries()]).toEqual([
      ["Daily", 1],
      ["Examples", 2],
      ["Templates", 3],
    ]);
  });

  it("sorts case-insensitively and leaves root notes out", () => {
    const slots = folderColorSlots(["beta", "", "Alpha", "Gamma"]);
    expect(slots.get("Alpha")).toBe(1);
    expect(slots.get("beta")).toBe(2);
    expect(slots.get("Gamma")).toBe(3);
    expect(slots.has("")).toBe(false);
  });

  it("never gives two folders the same colour while the palette lasts", () => {
    // "Examples" and "Daily" hashed onto the same slot before #593.
    expect(folderColorIndex("Examples")).toBe(folderColorIndex("Daily"));
    const folders = ["Examples", "Daily", ...Array.from({ length: FOLDER_COLOR_COUNT - 2 }, (_, i) => `Folder ${i}`)];
    const slots = folderColorSlots(folders);
    expect(new Set(slots.values()).size).toBe(FOLDER_COLOR_COUNT);
    expect(slots.get("Examples")).not.toBe(slots.get("Daily"));
  });

  it("falls back to the name hash for folders beyond the palette", () => {
    const folders = Array.from({ length: FOLDER_COLOR_COUNT + 3 }, (_, i) => `F${String(i).padStart(2, "0")}`);
    const slots = folderColorSlots(folders);
    for (let i = 0; i < FOLDER_COLOR_COUNT; i++) expect(slots.get(folders[i])).toBe(i + 1);
    for (const extra of folders.slice(FOLDER_COLOR_COUNT)) expect(slots.get(extra)).toBe(folderColorIndex(extra));
  });

  it("folderColorIndex reads the slot and hashes only folders it does not know", () => {
    const slots = folderColorSlots(["Daily", "Examples"]);
    expect(folderColorIndex("Daily", slots)).toBe(1);
    expect(folderColorIndex("Examples", slots)).toBe(2);
    expect(folderColorIndex("Elsewhere", slots)).toBe(folderColorIndex("Elsewhere"));
    expect(folderColorIndex("", slots)).toBeNull();
  });
});

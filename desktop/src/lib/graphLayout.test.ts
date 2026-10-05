import { describe, it, expect } from "vitest";
import {
  seedPositions,
  enterDelay,
  MAX_ENTER_DELAY,
  fitTransform,
  MAX_FIT_SCALE,
  MIN_FIT_SCALE,
  folderColorIndex,
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

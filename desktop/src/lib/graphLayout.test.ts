import { describe, it, expect } from "vitest";
import { seedPositions, enterDelay, MAX_ENTER_DELAY } from "./graphLayout";

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

import { describe, it, expect } from "vitest";
import { buildTagTree } from "./tagTree";

describe("buildTagTree", () => {
  it("nests slash-separated tags and rolls up totals", () => {
    const tree = buildTagTree([
      { tag: "work", count: 2 },
      { tag: "work/projects", count: 3 },
      { tag: "work/projects/alpha", count: 1 },
      { tag: "personal", count: 5 },
    ]);

    expect(tree.map((n) => n.path)).toEqual(["work", "personal"]); // work total 6 > personal 5
    const work = tree[0];
    expect(work.count).toBe(2);
    expect(work.total).toBe(6);
    const projects = work.children[0];
    expect(projects.path).toBe("work/projects");
    expect(projects.segment).toBe("projects");
    expect(projects.total).toBe(4);
    expect(projects.children[0].path).toBe("work/projects/alpha");
  });

  it("creates grouping-only parents with zero own count", () => {
    const tree = buildTagTree([{ tag: "a/b", count: 4 }]);
    expect(tree).toHaveLength(1);
    expect(tree[0].path).toBe("a");
    expect(tree[0].count).toBe(0); // "a" itself was never tagged
    expect(tree[0].total).toBe(4);
    expect(tree[0].children[0].path).toBe("a/b");
  });

  it("sorts siblings by total then name", () => {
    const tree = buildTagTree([
      { tag: "zeta", count: 1 },
      { tag: "alpha", count: 1 },
      { tag: "beta", count: 3 },
    ]);
    expect(tree.map((n) => n.segment)).toEqual(["beta", "alpha", "zeta"]);
  });

  it("returns an empty tree for no tags", () => {
    expect(buildTagTree([])).toEqual([]);
  });
});

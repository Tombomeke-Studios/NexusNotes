import { describe, it, expect } from "vitest";
import { diffLines, sideBySide, mergeDraft, foldUnchanged, MERGE_MARKERS } from "./diff";

const kinds = (a: string, b: string) => diffLines(a, b).map((l) => `${l.kind[0]}:${l.text}`);

describe("diffLines", () => {
  it("reports identical text as unchanged", () => {
    expect(kinds("a\nb", "a\nb")).toEqual(["s:a", "s:b"]);
  });

  it("finds a changed line between common ones", () => {
    expect(kinds("a\nmine\nc", "a\ntheirs\nc")).toEqual(["s:a", "m:mine", "t:theirs", "s:c"]);
  });

  it("finds additions and removals on either side", () => {
    expect(kinds("a\nb\nc", "a\nc")).toEqual(["s:a", "m:b", "s:c"]);
    expect(kinds("a\nc", "a\nb\nc")).toEqual(["s:a", "t:b", "s:c"]);
  });

  it("keeps the order of the original lines", () => {
    const d = diffLines("1\n2\n3\n4\n5", "1\n3\nx\n5");
    const mine = d.filter((l) => l.kind !== "theirs").map((l) => l.text);
    const theirs = d.filter((l) => l.kind !== "mine").map((l) => l.text);
    expect(mine).toEqual(["1", "2", "3", "4", "5"]);
    expect(theirs).toEqual(["1", "3", "x", "5"]);
  });

  it("treats Windows and Unix line endings alike", () => {
    expect(kinds("a\r\nb", "a\nb")).toEqual(["s:a", "s:b"]);
  });

  it("handles empty text on either side", () => {
    expect(kinds("", "a")).toEqual(["t:a"]);
    expect(kinds("a", "")).toEqual(["m:a"]);
    expect(kinds("", "")).toEqual([]);
  });

  it("always rebuilds both versions exactly (random inputs)", () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const randomText = () =>
      Array.from({ length: Math.floor(rand() * 12) }, () => "abcde"[Math.floor(rand() * 5)]).join("\n");
    for (let i = 0; i < 300; i++) {
      const mine = randomText();
      const theirs = randomText();
      const d = diffLines(mine, theirs);
      expect(d.filter((l) => l.kind !== "theirs").map((l) => l.text).join("\n")).toBe(mine);
      expect(d.filter((l) => l.kind !== "mine").map((l) => l.text).join("\n")).toBe(theirs);
    }
  });

  it("stays fast and correct for very large, completely different notes", () => {
    const mine = Array.from({ length: 6000 }, (_, i) => `mine ${i}`).join("\n");
    const theirs = Array.from({ length: 6000 }, (_, i) => `theirs ${i}`).join("\n");
    const start = performance.now();
    const d = diffLines(mine, theirs);
    expect(performance.now() - start).toBeLessThan(1500);
    expect(d.filter((l) => l.kind === "mine")).toHaveLength(6000);
    expect(d.filter((l) => l.kind === "theirs")).toHaveLength(6000);
  });
});

describe("sideBySide", () => {
  it("pairs changed blocks row by row and keeps common lines on both sides", () => {
    const rows = sideBySide(diffLines("a\nmine1\nmine2\nc", "a\ntheirs1\nc"));
    expect(rows).toEqual([
      { left: { text: "a", changed: false }, right: { text: "a", changed: false } },
      { left: { text: "mine1", changed: true }, right: { text: "theirs1", changed: true } },
      { left: { text: "mine2", changed: true }, right: null },
      { left: { text: "c", changed: false }, right: { text: "c", changed: false } },
    ]);
  });
});

describe("mergeDraft", () => {
  it("keeps common lines once and wraps each difference in conflict markers", () => {
    const draft = mergeDraft("a\nmine\nc", "a\ntheirs\nc");
    expect(draft).toBe(
      ["a", MERGE_MARKERS.mine, "mine", MERGE_MARKERS.split, "theirs", MERGE_MARKERS.theirs, "c"].join("\n"),
    );
  });

  it("returns the text unchanged when both versions agree", () => {
    expect(mergeDraft("same\ntext", "same\ntext")).toBe("same\ntext");
  });
});

describe("foldUnchanged", () => {
  const changed = (n: number) => n < 0;
  it("folds long unchanged runs but keeps context next to each change", () => {
    const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, -1, 11, 12];
    const segs = foldUnchanged(rows, changed, 3, 4);
    expect(segs).toEqual([
      { kind: "fold", id: 0, rows: [1, 2, 3, 4, 5, 6, 7] },
      { kind: "rows", rows: [8, 9, 10, -1, 11, 12] },
    ]);
  });

  it("shows short runs in full", () => {
    expect(foldUnchanged([1, -1, 2, 3, 4, -2], changed, 3, 4)).toEqual([{ kind: "rows", rows: [1, -1, 2, 3, 4, -2] }]);
  });
});

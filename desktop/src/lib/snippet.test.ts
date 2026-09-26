import { describe, it, expect } from "vitest";
import { snippetParts } from "./snippet";

describe("snippetParts", () => {
  it("splits highlight markers into highlighted and plain parts", () => {
    expect(snippetParts("buy <em>milk</em> today")).toEqual([
      { text: "buy ", highlight: false },
      { text: "milk", highlight: true },
      { text: " today", highlight: false },
    ]);
  });

  it("keeps every other tag as literal text", () => {
    const parts = snippetParts('<img src=x onerror="alert(1)"> and <em>hit</em>');
    expect(parts[0]).toEqual({ text: '<img src=x onerror="alert(1)"> and ', highlight: false });
    expect(parts[1]).toEqual({ text: "hit", highlight: true });
  });

  it("tolerates unbalanced markers and empty input", () => {
    expect(snippetParts("")).toEqual([]);
    expect(snippetParts("a</em>b")).toEqual([{ text: "a", highlight: false }, { text: "b", highlight: false }]);
    expect(snippetParts("<em>open")).toEqual([{ text: "open", highlight: true }]);
  });
});

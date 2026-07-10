import { describe, it, expect, beforeEach } from "vitest";
import { loadRecent, pushRecent } from "./recent";

describe("recent store", () => {
  beforeEach(() => localStorage.clear());

  it("starts empty", () => {
    expect(loadRecent("v1")).toEqual([]);
  });

  it("adds most-recent first and de-duplicates", () => {
    pushRecent("v1", "a");
    pushRecent("v1", "b");
    pushRecent("v1", "a"); // re-open a -> moves to front
    expect(loadRecent("v1")).toEqual(["a", "b"]);
  });

  it("caps at 10 entries", () => {
    for (let i = 0; i < 14; i++) pushRecent("v1", `n${i}`);
    const list = loadRecent("v1");
    expect(list).toHaveLength(10);
    expect(list[0]).toBe("n13");
  });

  it("scopes per vault", () => {
    pushRecent("v1", "a");
    pushRecent("v2", "b");
    expect(loadRecent("v1")).toEqual(["a"]);
    expect(loadRecent("v2")).toEqual(["b"]);
  });
});

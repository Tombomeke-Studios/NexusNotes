import { describe, it, expect, beforeEach } from "vitest";
import { loadFolders, addFolder, removeFolder, normalizeFolderPath } from "./folders";

describe("folders store", () => {
  beforeEach(() => localStorage.clear());

  it("starts empty", () => {
    expect(loadFolders("v1")).toEqual([]);
  });

  it("adds and persists folders, ignoring duplicates and blanks", () => {
    addFolder("v1", "Projects");
    addFolder("v1", "Projects"); // duplicate
    addFolder("v1", "  "); // blank
    expect(loadFolders("v1")).toEqual(["Projects"]);
  });

  it("scopes folders per vault", () => {
    addFolder("v1", "A");
    addFolder("v2", "B");
    expect(loadFolders("v1")).toEqual(["A"]);
    expect(loadFolders("v2")).toEqual(["B"]);
  });

  it("removes a folder and its subfolders", () => {
    addFolder("v1", "Work");
    addFolder("v1", "Work/Reports");
    addFolder("v1", "Personal");
    const next = removeFolder("v1", "Work");
    expect(next).toEqual(["Personal"]);
  });

  it("normalizes paths", () => {
    expect(normalizeFolderPath(" a / b / ")).toBe("a/b");
    expect(normalizeFolderPath("//x//")).toBe("x");
  });
});

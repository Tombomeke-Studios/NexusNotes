import { describe, it, expect, beforeEach } from "vitest";
import {
  loadFolders,
  addFolder,
  removeFolder,
  normalizeFolderPath,
  openFolders,
  forgetFolders,
  flushFolders,
} from "./folders";
import { generateVaultKey } from "./crypto";
import { vaultKeySession } from "./vaultKeys";

function everythingStored(): string {
  const parts: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const name = localStorage.key(i)!;
    parts.push(name, localStorage.getItem(name) ?? "");
  }
  return parts.join(" | ");
}

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

describe("folders store — encrypted vaults", () => {
  const key = generateVaultKey();

  beforeEach(() => {
    localStorage.clear();
    vaultKeySession.clear();
    forgetFolders("e1");
    vaultKeySession.set("e1", key);
  });

  it("stores the folder names of an unlocked encrypted vault sealed", async () => {
    addFolder("e1", "Medical");
    addFolder("e1", "Medical/Results");
    await flushFolders();
    expect(loadFolders("e1")).toEqual(["Medical", "Medical/Results"]);
    expect(everythingStored()).not.toContain("Medical");
    expect(everythingStored()).not.toContain("Results");
  });

  it("opens them again after a lock and unlock, and keeps nothing readable in between", async () => {
    addFolder("e1", "Medical");
    removeFolder("e1", "Medical");
    addFolder("e1", "Taxes");
    await flushFolders();

    vaultKeySession.lock("e1");
    forgetFolders("e1");
    expect(loadFolders("e1")).toEqual([]);

    vaultKeySession.set("e1", key);
    expect(await openFolders("e1")).toEqual(["Taxes"]);
    expect(loadFolders("e1")).toEqual(["Taxes"]);
  });

  it("seals a readable list left from before on unlock, and removes it", async () => {
    localStorage.setItem("nexus_folders_e1", JSON.stringify(["Old plans"]));
    expect(await openFolders("e1")).toEqual(["Old plans"]);
    expect(localStorage.getItem("nexus_folders_e1")).toBeNull();
    expect(everythingStored()).not.toContain("Old plans");

    forgetFolders("e1");
    expect(await openFolders("e1")).toEqual(["Old plans"]);
  });

  it("does not open them with another key", async () => {
    addFolder("e1", "Medical");
    await flushFolders();
    vaultKeySession.set("e1", generateVaultKey());
    forgetFolders("e1");
    expect(await openFolders("e1")).toEqual([]);
  });

  it("leaves standard vaults readable as before", () => {
    addFolder("v1", "Projects");
    expect(localStorage.getItem("nexus_folders_v1")).toBe(JSON.stringify(["Projects"]));
  });
});

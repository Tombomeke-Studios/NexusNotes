import { describe, it, expect, beforeEach } from "vitest";
import { saveDraft, loadDraft, clearDraft, loadDraftBase, rebaseDraft } from "./drafts";

describe("drafts", () => {
  beforeEach(() => localStorage.clear());

  it("returns null when there is no draft", () => {
    expect(loadDraft("n1")).toBeNull();
  });

  it("saves and loads a draft per note", () => {
    saveDraft("n1", "hello");
    saveDraft("n2", "world");
    expect(loadDraft("n1")).toBe("hello");
    expect(loadDraft("n2")).toBe("world");
  });

  it("overwrites and clears a draft", () => {
    saveDraft("n1", "a");
    saveDraft("n1", "ab");
    expect(loadDraft("n1")).toBe("ab");
    clearDraft("n1");
    expect(loadDraft("n1")).toBeNull();
  });

  it("remembers the checksum a draft was written against", () => {
    saveDraft("n1", "a", "c0");
    expect(loadDraftBase("n1")).toBe("c0");
    clearDraft("n1");
    expect(loadDraftBase("n1")).toBeNull();
  });

  it("moves the base forward only from the checksum it was on", () => {
    saveDraft("n1", "a", "c0");
    rebaseDraft("n1", "cX", "c1");
    expect(loadDraftBase("n1")).toBe("c0");
    rebaseDraft("n1", "c0", "c1");
    expect(loadDraftBase("n1")).toBe("c1");
  });
});

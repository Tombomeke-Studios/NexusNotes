import { describe, it, expect, beforeEach } from "vitest";
import { loadPins, togglePin, pinnedFirst } from "./pins";
import type { Note } from "./types";

function note(overrides: Partial<Note>): Note {
  return {
    id: "n1",
    vault_id: "v1",
    path: "",
    title: "Untitled",
    content: "",
    checksum: "",
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("pins", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts empty", () => {
    expect(loadPins("v1")).toEqual([]);
  });

  it("toggles a pin on and off", () => {
    expect(togglePin("v1", "a")).toEqual(["a"]);
    expect(togglePin("v1", "b")).toEqual(["a", "b"]);
    expect(togglePin("v1", "a")).toEqual(["b"]);
    expect(loadPins("v1")).toEqual(["b"]);
  });

  it("keeps pins separate per vault", () => {
    togglePin("v1", "a");
    togglePin("v2", "z");
    expect(loadPins("v1")).toEqual(["a"]);
    expect(loadPins("v2")).toEqual(["z"]);
  });
});

describe("pinnedFirst", () => {
  it("moves pinned notes to the front, preserving relative order", () => {
    const notes = [note({ id: "a" }), note({ id: "b" }), note({ id: "c" })];
    const result = pinnedFirst(notes, new Set(["c", "b"]));
    expect(result.map((n) => n.id)).toEqual(["b", "c", "a"]);
  });

  it("returns the same order when nothing is pinned", () => {
    const notes = [note({ id: "a" }), note({ id: "b" })];
    expect(pinnedFirst(notes, new Set()).map((n) => n.id)).toEqual(["a", "b"]);
  });
});

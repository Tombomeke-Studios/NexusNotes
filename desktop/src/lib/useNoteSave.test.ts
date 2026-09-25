import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { useNoteSave, type SaveStatus } from "./useNoteSave";
import { loadDraft, saveDraft } from "./drafts";
import type { Note } from "./types";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, notes: { ...actual.notes, update: vi.fn() } };
});

import { notes as notesApi } from "./api";

const update = vi.mocked(notesApi.update);

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "n1",
    vault_id: "v1",
    path: "",
    title: "Note",
    content: "hello",
    checksum: "c0",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Server echo of a successful PUT: a fresh checksum per call. */
function savedNote(checksum: string, overrides: Partial<Note> = {}): Note {
  return makeNote({ checksum, updated_at: "2026-01-02T00:00:00Z", ...overrides });
}

interface HarnessOptions {
  encryptOutgoing?: (vaultId: string, plaintext: string) => Promise<{ content: string; checksum?: string }>;
  keepsDrafts?: (vaultId: string) => boolean;
}

/**
 * Mirrors how App wires the hook: real React state for the open note, note
 * list and editor content, with refs refreshed on every render.
 */
function useHarness(initial: Note, opts: HarnessOptions, onSynced: () => void) {
  const [activeNote, setActiveNote] = useState<Note | null>(initial);
  const [noteList, setNoteList] = useState<Note[]>([initial]);
  const [editorContent, setEditorContent] = useState(initial.content);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const activeNoteRef = useRef(activeNote);
  activeNoteRef.current = activeNote;
  const save = useNoteSave({
    activeNoteRef,
    setActiveNote,
    setNoteList,
    setEditorContent,
    setSaveStatus,
    onSynced,
    encryptOutgoing: opts.encryptOutgoing ?? (async (_vaultId, plaintext) => ({ content: plaintext })),
    keepsDrafts: opts.keepsDrafts ?? (() => true),
  });
  return { ...save, saveStatus, activeNote, noteList, editorContent, setActiveNote };
}

function setup(opts: HarnessOptions = {}, initial: Note = makeNote()) {
  const onSynced = vi.fn();
  const hook = renderHook(() => useHarness(initial, opts, onSynced));
  return { hook, onSynced };
}

beforeEach(() => {
  update.mockReset();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useNoteSave — happy path", () => {
  it("PUTs the open note against its checksum and marks it saved", async () => {
    update.mockResolvedValueOnce(savedNote("c1", { content: "server echo" }));
    const { hook, onSynced } = setup();

    await act(() => hook.result.current.saveNote("hello world"));

    expect(update).toHaveBeenCalledWith("n1", "Note", "", "hello world", "c0", undefined);
    expect(hook.result.current.saveStatus).toBe("saved");
    // State keeps the local plaintext, not whatever the server echoed.
    expect(hook.result.current.activeNote).toMatchObject({ checksum: "c1", content: "hello world" });
    expect(hook.result.current.noteList[0]).toMatchObject({ checksum: "c1", content: "hello world" });
    expect(hook.result.current.editorContent).toBe("hello world");
    expect(onSynced).toHaveBeenCalledTimes(1);
  });

  it("sends the encrypted payload and client checksum for e2ee vaults", async () => {
    update.mockResolvedValueOnce(savedNote("plain-sha", { content: "ciphertext" }));
    const { hook } = setup({
      encryptOutgoing: async () => ({ content: "ciphertext", checksum: "plain-sha" }),
      keepsDrafts: () => false,
    });

    await act(() => hook.result.current.saveNote("secret"));

    expect(update).toHaveBeenCalledWith("n1", "Note", "", "ciphertext", "c0", "plain-sha");
    expect(hook.result.current.activeNote?.content).toBe("secret");
  });

  it("clears the local draft once the save succeeds", async () => {
    update.mockResolvedValueOnce(savedNote("c1"));
    const { hook } = setup();

    act(() => hook.result.current.liveChange("typed"));
    expect(loadDraft("n1")).toBe("typed");

    await act(() => hook.result.current.saveNote("typed"));
    expect(loadDraft("n1")).toBeNull();
  });

  it("does nothing without an open note", async () => {
    const { hook } = setup();
    act(() => hook.result.current.setActiveNote(null));

    await act(() => hook.result.current.saveNote("x"));

    expect(update).not.toHaveBeenCalled();
  });
});

describe("useNoteSave — live changes", () => {
  it("marks the note unsaved and mirrors the content to a draft", () => {
    const { hook } = setup();

    act(() => hook.result.current.liveChange("draft text"));

    expect(hook.result.current.saveStatus).toBe("unsaved");
    expect(hook.result.current.editorContent).toBe("draft text");
    expect(loadDraft("n1")).toBe("draft text");
  });

  it("never writes a plaintext draft for vaults that must not keep one (e2ee)", () => {
    const { hook } = setup({ keepsDrafts: () => false });

    act(() => hook.result.current.liveChange("secret"));

    expect(hook.result.current.saveStatus).toBe("unsaved");
    expect(loadDraft("n1")).toBeNull();
  });
});

describe("useNoteSave — failures", () => {
  it("keeps the draft when a save fails", async () => {
    update.mockRejectedValueOnce(new Error("boom"));
    const { hook } = setup();
    saveDraft("n1", "typed");

    await act(() => hook.result.current.saveNote("typed"));

    expect(hook.result.current.saveStatus).toBe("unsaved");
    expect(loadDraft("n1")).toBe("typed");
  });
});

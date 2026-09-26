import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import {
  useNoteSave,
  classifySaveError,
  isDirtyStatus,
  retryDelay,
  FOLLOW_UP_DELAY_MS,
  MAX_RETRY_DELAY_MS,
  type SaveStatus,
} from "./useNoteSave";
import { loadDraft, saveDraft } from "./drafts";
import { encryptNoteForVault, setupVaultEncryption, vaultKeySession } from "./vaultKeys";
import type { Note } from "./types";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, notes: { ...actual.notes, update: vi.fn() } };
});

import { notes as notesApi, ApiError } from "./api";

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
  const [paused, setPaused] = useState(false);
  const [sessionKey, setSessionKey] = useState<string | null>("user-1");
  const activeNoteRef = useRef(activeNote);
  activeNoteRef.current = activeNote;
  const editorContentRef = useRef(editorContent);
  editorContentRef.current = editorContent;
  const save = useNoteSave({
    activeNoteRef,
    editorContentRef,
    setActiveNote,
    setNoteList,
    setEditorContent,
    setSaveStatus,
    onSynced,
    encryptOutgoing: opts.encryptOutgoing ?? (async (_vaultId, plaintext) => ({ content: plaintext })),
    keepsDrafts: opts.keepsDrafts ?? (() => true),
    paused,
    sessionKey,
  });
  /** What App's sign-out does: the user (and with it the open note) goes away. */
  const signOut = () => {
    setSessionKey(null);
    setActiveNote(null);
  };
  return { ...save, saveStatus, activeNote, noteList, editorContent, setActiveNote, setPaused, signOut };
}

/** A promise whose settlement the test controls (an in-flight PUT). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise callbacks and the React updates they trigger settle. */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

/** Advances the fake clock, then lets the saves it started settle. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await flush();
}

/** The `prev_checksum` argument of the n-th PUT. */
function prevChecksumOfCall(n: number): string {
  return update.mock.calls[n][4];
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

describe("useNoteSave — edits while a save is in flight (#263)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("stays unsaved and keeps the draft when the user typed during the PUT", async () => {
    const put = deferred<Note>();
    update.mockReturnValueOnce(put.promise);
    const { hook } = setup();

    let saving!: Promise<void>;
    act(() => {
      saving = hook.result.current.saveNote("first");
    });
    expect(hook.result.current.saveStatus).toBe("saving");
    act(() => hook.result.current.liveChange("first and more"));

    await act(async () => {
      put.resolve(savedNote("c1"));
      await saving;
    });

    expect(hook.result.current.saveStatus).toBe("unsaved");
    expect(loadDraft("n1")).toBe("first and more");
    // The server's new checksum is adopted so the next save doesn't conflict.
    expect(hook.result.current.activeNote?.checksum).toBe("c1");
    expect(hook.result.current.editorContent).toBe("first and more");
  });

  it("saves the newer content again against the checksum the first save returned", async () => {
    const put = deferred<Note>();
    update.mockReturnValueOnce(put.promise).mockResolvedValueOnce(savedNote("c2"));
    const { hook } = setup();

    let saving!: Promise<void>;
    act(() => {
      saving = hook.result.current.saveNote("first");
    });
    act(() => hook.result.current.liveChange("first and more"));
    await act(async () => {
      put.resolve(savedNote("c1"));
      await saving;
    });

    await advance(FOLLOW_UP_DELAY_MS);

    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1][3]).toBe("first and more");
    expect(prevChecksumOfCall(1)).toBe("c1");
    expect(hook.result.current.saveStatus).toBe("saved");
    expect(loadDraft("n1")).toBeNull();
  });

  it("does not add a save of its own when the editor already requested the latest text", async () => {
    const put = deferred<Note>();
    update.mockReturnValueOnce(put.promise).mockResolvedValueOnce(savedNote("c2"));
    const { hook } = setup();

    let first!: Promise<void>;
    act(() => {
      first = hook.result.current.saveNote("first");
    });
    act(() => hook.result.current.liveChange("first and more"));
    let second!: Promise<void>;
    act(() => {
      second = hook.result.current.saveNote("first and more");
    });
    await act(async () => {
      put.resolve(savedNote("c1"));
      await first;
      await second;
    });
    await advance(FOLLOW_UP_DELAY_MS * 5);

    expect(update).toHaveBeenCalledTimes(2);
    expect(hook.result.current.saveStatus).toBe("saved");
  });

  it("does not revert a rename made while the save was in flight", async () => {
    const put = deferred<Note>();
    update.mockReturnValueOnce(put.promise);
    const { hook } = setup();

    let saving!: Promise<void>;
    act(() => {
      saving = hook.result.current.saveNote("body");
    });
    act(() => {
      hook.result.current.setActiveNote((prev) => (prev ? { ...prev, title: "Renamed" } : prev));
      hook.result.current.markDirty();
    });
    await act(async () => {
      put.resolve(savedNote("c1", { title: "Note" }));
      await saving;
    });

    expect(hook.result.current.activeNote?.title).toBe("Renamed");
    expect(hook.result.current.saveStatus).toBe("unsaved");
  });
});

describe("useNoteSave — serialised saves", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("starts a second save only after the first finished, using the checksum it returned", async () => {
    const first = deferred<Note>();
    update.mockReturnValueOnce(first.promise).mockResolvedValueOnce(savedNote("c2"));
    const { hook } = setup();

    let a!: Promise<void>;
    let b!: Promise<void>;
    act(() => {
      a = hook.result.current.saveNote("one");
    });
    await flush();
    act(() => {
      hook.result.current.liveChange("one two");
      b = hook.result.current.saveNote("one two");
    });
    await flush();
    expect(update).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve(savedNote("c1"));
      await a;
      await b;
    });

    expect(update).toHaveBeenCalledTimes(2);
    expect(prevChecksumOfCall(0)).toBe("c0");
    expect(prevChecksumOfCall(1)).toBe("c1");
    expect(update.mock.calls[1][3]).toBe("one two");
    expect(hook.result.current.saveStatus).toBe("saved");
    expect(hook.result.current.activeNote?.checksum).toBe("c2");
  });

  it("coalesces saves queued behind an in-flight one into a single PUT of the latest text", async () => {
    const first = deferred<Note>();
    update.mockReturnValueOnce(first.promise).mockResolvedValueOnce(savedNote("c2"));
    const { hook } = setup();

    let done!: Promise<void>;
    act(() => {
      done = hook.result.current.saveNote("a");
    });
    await flush();
    act(() => {
      hook.result.current.liveChange("ab");
      void hook.result.current.saveNote("ab");
      hook.result.current.liveChange("abc");
      void hook.result.current.saveNote("abc");
    });
    await act(async () => {
      first.resolve(savedNote("c1"));
      await done;
    });

    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1][3]).toBe("abc");
    expect(hook.result.current.saveStatus).toBe("saved");
  });
});

describe("useNoteSave — conflicts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("marks a 409 as a conflict and never touches the user's text", async () => {
    update.mockRejectedValueOnce(new ApiError(409, "Request failed"));
    const { hook } = setup();

    act(() => hook.result.current.liveChange("my text"));
    await act(() => hook.result.current.saveNote("my text"));

    expect(hook.result.current.saveStatus).toBe("conflict");
    expect(hook.result.current.editorContent).toBe("my text");
    expect(hook.result.current.activeNote?.checksum).toBe("c0");
    expect(loadDraft("n1")).toBe("my text");
    expect(hook.result.current.saveError).toMatchObject({ noteId: "n1", kind: "conflict" });

    // A conflict needs the user, not an automatic retry.
    await advance(60_000);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("stays in conflict while the user keeps typing", async () => {
    update.mockRejectedValueOnce(new ApiError(409, "Request failed"));
    const { hook } = setup();

    await act(() => hook.result.current.saveNote("my text"));
    act(() => hook.result.current.liveChange("my text, more"));

    expect(hook.result.current.saveStatus).toBe("conflict");
    expect(loadDraft("n1")).toBe("my text, more");
  });

  it("clears the conflict once a later save goes through", async () => {
    update.mockRejectedValueOnce(new ApiError(409, "Request failed")).mockResolvedValueOnce(savedNote("c5"));
    const { hook } = setup();

    await act(() => hook.result.current.saveNote("mine"));
    await act(() => hook.result.current.saveNote("mine"));

    expect(hook.result.current.saveStatus).toBe("saved");
    expect(hook.result.current.saveError).toBeNull();
  });
});

describe("useNoteSave — network failures", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("stays unsaved and retries with a growing delay until the server is back", async () => {
    update
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(savedNote("c1"));
    const { hook } = setup();

    act(() => hook.result.current.liveChange("offline text"));
    await act(() => hook.result.current.saveNote("offline text"));

    expect(hook.result.current.saveStatus).toBe("unsaved");
    expect(hook.result.current.saveError).toMatchObject({ noteId: "n1", kind: "network" });
    expect(loadDraft("n1")).toBe("offline text");

    await advance(retryDelay(0) - 1);
    expect(update).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(update).toHaveBeenCalledTimes(2);

    await advance(retryDelay(1) - 1);
    expect(update).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(update).toHaveBeenCalledTimes(3);

    expect(update.mock.calls[2][3]).toBe("offline text");
    expect(hook.result.current.saveStatus).toBe("saved");
    expect(hook.result.current.saveError).toBeNull();
    expect(loadDraft("n1")).toBeNull();
  });

  it("retries with the latest text when the user kept typing while offline", async () => {
    update.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(savedNote("c1"));
    const { hook } = setup();

    await act(() => hook.result.current.saveNote("v1"));
    act(() => hook.result.current.liveChange("v1 plus"));
    await advance(retryDelay(0));

    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1][3]).toBe("v1 plus");
    expect(hook.result.current.saveStatus).toBe("saved");
  });

  it("caps the retry delay", () => {
    expect(retryDelay(0)).toBe(1000);
    expect(retryDelay(1)).toBe(2000);
    expect(retryDelay(2)).toBe(4000);
    expect(retryDelay(50)).toBe(MAX_RETRY_DELAY_MS);
  });

  it("holds retries while autosave is paused and resumes afterwards", async () => {
    update.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(savedNote("c1"));
    const { hook } = setup();

    await act(() => hook.result.current.saveNote("text"));
    act(() => hook.result.current.setPaused(true));
    await advance(retryDelay(0) * 10);
    expect(update).toHaveBeenCalledTimes(1);

    act(() => hook.result.current.setPaused(false));
    await advance(retryDelay(0));
    expect(update).toHaveBeenCalledTimes(2);
    expect(hook.result.current.saveStatus).toBe("saved");
  });

  it("discarding the changes cancels a pending retry and drops the draft", async () => {
    update.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { hook } = setup();

    act(() => hook.result.current.liveChange("throw away"));
    await act(() => hook.result.current.saveNote("throw away"));
    act(() => hook.result.current.discard());
    await advance(60_000);

    expect(update).toHaveBeenCalledTimes(1);
    expect(hook.result.current.saveStatus).toBe("saved");
    expect(hook.result.current.saveError).toBeNull();
    expect(loadDraft("n1")).toBeNull();
  });

  it("stops retrying once the hook unmounts", async () => {
    update.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { hook } = setup();

    await act(() => hook.result.current.saveNote("text"));
    hook.unmount();
    await advance(60_000);

    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe("useNoteSave — sign-out", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  // App stays mounted across sign-out (it renders <Auth/>), so unmount
  // cleanup alone never runs; the session change must drop everything.
  it("drops a pending retry, so nothing goes out with the next user's session", async () => {
    update.mockRejectedValue(new TypeError("Failed to fetch"));
    const { hook } = setup();

    await act(() => hook.result.current.saveNote("text"));
    act(() => hook.result.current.signOut());
    await advance(60_000);

    expect(update).toHaveBeenCalledTimes(1);
    expect(hook.result.current.saveError).toBeNull();
  });

  it("ignores the result of a save that was in flight at sign-out", async () => {
    const put = deferred<Note>();
    update.mockReturnValueOnce(put.promise);
    const { hook } = setup();

    let saving!: Promise<unknown>;
    act(() => {
      saving = hook.result.current.saveNote("text");
    });
    await flush();
    act(() => hook.result.current.signOut());
    await act(async () => {
      put.reject(new TypeError("Failed to fetch"));
      await saving;
    });
    await advance(60_000);

    expect(update).toHaveBeenCalledTimes(1);
    expect(hook.result.current.saveError).toBeNull();
  });

  it("does not send a save that was queued behind an in-flight one", async () => {
    const put = deferred<Note>();
    update.mockReturnValueOnce(put.promise);
    const { hook } = setup();

    let first!: Promise<unknown>;
    act(() => {
      first = hook.result.current.saveNote("one");
    });
    await flush();
    act(() => {
      void hook.result.current.saveNote("one two");
    });
    act(() => hook.result.current.signOut());
    await act(async () => {
      put.resolve(savedNote("c1"));
      await first;
    });
    await advance(60_000);

    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe("useNoteSave — other failures", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("reports an encryption failure without sending anything or retrying", async () => {
    const { hook } = setup({
      encryptOutgoing: async () => {
        throw new Error("vault is locked");
      },
      keepsDrafts: () => false,
    });

    act(() => hook.result.current.liveChange("secret"));
    await act(() => hook.result.current.saveNote("secret"));
    await advance(60_000);

    expect(update).not.toHaveBeenCalled();
    expect(hook.result.current.saveStatus).toBe("unsaved");
    expect(hook.result.current.saveError).toMatchObject({ noteId: "n1", kind: "failed" });
    expect(hook.result.current.saveError?.message).toContain("vault is locked");
  });

  it("reports a server error with its message and does not retry", async () => {
    update.mockRejectedValueOnce(new ApiError(500, "internal error"));
    const { hook } = setup();

    await act(() => hook.result.current.saveNote("text"));
    await advance(60_000);

    expect(update).toHaveBeenCalledTimes(1);
    expect(hook.result.current.saveStatus).toBe("unsaved");
    expect(hook.result.current.saveError?.message).toContain("internal error");
  });
});

describe("useNoteSave — unknown vault encryption fails closed", () => {
  type VaultInfo = { id: string; encryption: "none" | "e2ee" };

  beforeEach(() => {
    vi.useFakeTimers();
    vaultKeySession.clear();
  });

  /** App's encryptOutgoing: look the vault up, then prepare the upload. */
  const uploadVia = (vaults: Map<string, VaultInfo>) => (vaultId: string, plaintext: string) =>
    encryptNoteForVault(vaults.get(vaultId), plaintext);

  it("never sends a request when the note's vault is not known", async () => {
    const { hook } = setup({ encryptOutgoing: uploadVia(new Map()), keepsDrafts: () => false });

    await act(() => hook.result.current.saveNote("secret"));
    await advance(60_000);

    expect(update).not.toHaveBeenCalled();
    expect(hook.result.current.saveStatus).toBe("unsaved");
    expect(hook.result.current.saveError).toMatchObject({ kind: "failed" });
  });

  it("a retry left over after the vault list is emptied never sends e2ee text in plain", async () => {
    const { vaultKey } = await setupVaultEncryption("a-good-passphrase", { m: 64, t: 1, p: 1 });
    vaultKeySession.set("v1", vaultKey);
    const vaults = new Map<string, VaultInfo>([["v1", { id: "v1", encryption: "e2ee" }]]);
    update.mockRejectedValue(new TypeError("Failed to fetch"));
    const { hook } = setup({ encryptOutgoing: uploadVia(vaults), keepsDrafts: () => false });

    await act(() => hook.result.current.saveNote("top secret"));
    expect(update).toHaveBeenCalledTimes(1);

    // What nexus:logout does: the vault list empties and the keys are forgotten.
    vaults.clear();
    vaultKeySession.clear();
    await advance(60_000);

    expect(update).toHaveBeenCalledTimes(1);
    for (const call of update.mock.calls) expect(call[3]).not.toContain("top secret");
  });
});

describe("classifySaveError", () => {
  it("maps a 409 to a conflict", () => {
    expect(classifySaveError(new ApiError(409, "conflict"))).toBe("conflict");
  });

  it("treats fetch failures and gateway errors as transient network problems", () => {
    expect(classifySaveError(new TypeError("Failed to fetch"))).toBe("network");
    expect(classifySaveError(new ApiError(502, "bad gateway"))).toBe("network");
    expect(classifySaveError(new ApiError(503, "unavailable"))).toBe("network");
    expect(classifySaveError(new ApiError(504, "timeout"))).toBe("network");
  });

  it("treats everything else as a plain failure", () => {
    expect(classifySaveError(new ApiError(500, "boom"))).toBe("failed");
    expect(classifySaveError(new ApiError(401, "unauthorized"))).toBe("failed");
    expect(classifySaveError(new Error("boom"))).toBe("failed");
  });
});

describe("isDirtyStatus", () => {
  it("counts unsaved, saving and conflict as unsaved work", () => {
    expect(isDirtyStatus("unsaved")).toBe(true);
    expect(isDirtyStatus("saving")).toBe(true);
    expect(isDirtyStatus("conflict")).toBe(true);
    expect(isDirtyStatus("saved")).toBe(false);
    expect(isDirtyStatus("idle")).toBe(false);
  });
});

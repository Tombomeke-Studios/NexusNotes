import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { useNoteSave, UNREADABLE_DRAFT, type SaveStatus } from "./useNoteSave";
import type { LockableVault } from "./useVaultLock";
import {
  decryptFieldForVault,
  decryptNoteForVault,
  encryptFieldForVault,
  encryptNoteForVault,
  vaultKeySession,
} from "./vaultKeys";
import { decryptNote, generateVaultKey, plaintextChecksum } from "./crypto";
import { flushSealedDrafts, hasSealedDraft, readSealedDraft, writeSealedDraft } from "./sealedDrafts";
import type { Note } from "./types";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, notes: { ...actual.notes, update: vi.fn() } };
});
vi.mock("./toast", () => ({ toast: vi.fn() }));

import { notes as notesApi, ApiError } from "./api";
import { toast } from "./toast";

/**
 * End-to-end behaviour of encrypted local drafts (#549): useNoteSave and
 * useVaultLock wired the way App wires them, with real encryption.
 */

const update = vi.mocked(notesApi.update);
const VAULT: LockableVault = { id: "v1", name: "Private", encryption: "e2ee" };
const NOTE_ID = "6f1c2a9e-0b7d-4c3e-8a21-5d4e3f2a1b0c";
const TITLE = "Quarterly secrets";
const PATH = "Hidden/Plans";
const SERVER_TEXT = "the server's copy";
const TYPED = "words typed while the internet was down";

let serverChecksum = "";
let key: Uint8Array;

function serverNote(overrides: Partial<Note> = {}): Note {
  return {
    id: NOTE_ID,
    vault_id: VAULT.id,
    path: PATH,
    title: TITLE,
    content: SERVER_TEXT,
    checksum: serverChecksum,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** What App passes to useNoteSave for an e2ee vault. */
function useApp(initial: Note | null) {
  const [activeNote, setActiveNote] = useState<Note | null>(initial);
  const [, setNoteList] = useState<Note[]>(initial ? [initial] : []);
  const [editorContent, setEditorContent] = useState(initial?.content ?? "");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
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
    onSynced: () => {},
    encryptOutgoing: (_vaultId, plaintext) => encryptNoteForVault(VAULT, plaintext),
    sealMeta: async (_vaultId, title, path) => ({
      title: await encryptFieldForVault(VAULT, title),
      path: await encryptFieldForVault(VAULT, path),
    }),
    keepsDrafts: () => false,
    draftKey: (vaultId) => vaultKeySession.get(vaultId),
    decryptServerContent: (_vaultId, content) => decryptNoteForVault(VAULT, content),
    sessionKey: "user-1",
  });
  return { ...save, saveStatus, activeNote, editorContent };
}

/** Lets sealing, opening (Web Crypto runs off the main thread) and the saves they start finish. */
async function settle() {
  await act(async () => {
    for (let round = 0; round < 8; round++) {
      await flushSealedDrafts();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  });
}

/** The arguments of the n-th PUT, opened with the vault key. */
async function sentCall(n: number) {
  const [id, title, path, content, prev, checksum] = update.mock.calls[n];
  return {
    id,
    title: await decryptFieldForVault(VAULT, title),
    path: await decryptFieldForVault(VAULT, path),
    content: await decryptNote(content, key),
    prev,
    checksum,
  };
}

const offline = () => update.mockRejectedValue(new TypeError("Failed to fetch"));

beforeEach(async () => {
  update.mockReset();
  vi.mocked(toast).mockClear();
  localStorage.clear();
  vaultKeySession.clear();
  key = generateVaultKey();
  vaultKeySession.set(VAULT.id, key);
  serverChecksum = await plaintextChecksum(SERVER_TEXT);
});

afterEach(() => {
  vi.restoreAllMocks();
  vaultKeySession.clear();
});

describe("encrypted drafts — writing", () => {
  it("seals every edit of an e2ee note to disk and drops it once the server has the text", async () => {
    const hook = renderHook(() => useApp(serverNote()));
    act(() => hook.result.current.liveChange(TYPED));
    await settle();
    expect(await readSealedDraft(VAULT.id, NOTE_ID, key)).toEqual({ content: TYPED, base: serverChecksum });

    update.mockResolvedValueOnce(serverNote({ checksum: "c1" }));
    await act(() => hook.result.current.saveNote(TYPED));
    await settle();
    expect(hasSealedDraft(NOTE_ID)).toBe(false);
  });

  it("writes nothing while the vault is locked", async () => {
    const hook = renderHook(() => useApp(serverNote()));
    vaultKeySession.lock(VAULT.id);
    act(() => hook.result.current.liveChange(TYPED));
    await settle();
    expect(localStorage.length).toBe(0);
  });

  it("moves the draft onto the version our own save created while newer text was typed", async () => {
    const hook = renderHook(() => useApp(serverNote()));
    let answer!: (n: Note) => void;
    update.mockReturnValueOnce(new Promise<Note>((resolve) => (answer = resolve)));
    act(() => hook.result.current.liveChange("first"));
    let saving: Promise<unknown> = Promise.resolve();
    act(() => {
      saving = hook.result.current.saveNote("first");
    });
    await settle();
    act(() => hook.result.current.liveChange("first and more"));
    await settle();
    // A follow-up save is scheduled for the newer text; keep it offline.
    offline();
    answer(serverNote({ checksum: "c1" }));
    await act(async () => {
      await saving;
    });
    await settle();
    expect(await readSealedDraft(VAULT.id, NOTE_ID, key)).toEqual({ content: "first and more", base: "c1" });
  });
});

describe("encrypted drafts — restoring after a crash (#549)", () => {
  it("restores and saves text typed offline once the app is back and the vault is unlocked", async () => {
    // Typing while offline, then the app is killed.
    const before = renderHook(() => useApp(serverNote()));
    offline();
    act(() => before.result.current.liveChange(TYPED));
    await act(() => before.result.current.saveNote(TYPED));
    await settle();
    before.unmount();
    vaultKeySession.clear();
    update.mockReset();

    // A fresh start: nothing in memory, the vault locked.
    const after = renderHook(() => useApp(null));
    act(() => after.result.current.replayDrafts([serverNote()]));
    await settle();
    expect(update).not.toHaveBeenCalled();

    // Unlocking reloads the vault's notes, which replays their drafts.
    vaultKeySession.set(VAULT.id, key);
    let answer!: (n: Note) => void;
    update.mockReturnValueOnce(new Promise<Note>((resolve) => (answer = resolve)));
    act(() => after.result.current.replayDrafts([serverNote()]));
    await settle();

    // Restored: reopening the note shows the typed text on the version it was based on.
    expect(after.result.current.localCopy(serverNote())).toEqual({ content: TYPED, checksum: serverChecksum });
    // Saved: encrypted, against that version, title and path sealed.
    expect(update).toHaveBeenCalledTimes(1);
    expect(await sentCall(0)).toMatchObject({ id: NOTE_ID, title: TITLE, path: PATH, content: TYPED, prev: serverChecksum });

    answer(serverNote({ checksum: await plaintextChecksum(TYPED) }));
    await settle();
    expect(hasSealedDraft(NOTE_ID)).toBe(false);
    expect(after.result.current.hasUnconfirmed()).toBe(false);
  });

  it("keeps the draft and reports a conflict when the note changed elsewhere meanwhile", async () => {
    await writeSealedDraft(VAULT.id, NOTE_ID, { content: TYPED, base: "old-version" }, key);
    update.mockRejectedValueOnce(new ApiError(409, "conflict"));
    const hook = renderHook(() => useApp(null));
    act(() => hook.result.current.replayDrafts([serverNote()]));
    await settle();
    expect(update.mock.calls[0][4]).toBe("old-version");
    expect(await readSealedDraft(VAULT.id, NOTE_ID, key)).toEqual({ content: TYPED, base: "old-version" });
    expect(hook.result.current.localCopy(serverNote())).toEqual({ content: TYPED, checksum: "old-version" });
  });

  it("drops a draft that matches the server's text without sending it", async () => {
    await writeSealedDraft(VAULT.id, NOTE_ID, { content: SERVER_TEXT, base: serverChecksum }, key);
    const hook = renderHook(() => useApp(null));
    act(() => hook.result.current.replayDrafts([serverNote()]));
    await settle();
    expect(update).not.toHaveBeenCalled();
    expect(hasSealedDraft(NOTE_ID)).toBe(false);
  });

  it("keeps and reports a draft that can't be decrypted, and never sends it", async () => {
    await writeSealedDraft(VAULT.id, NOTE_ID, { content: TYPED, base: serverChecksum }, generateVaultKey());
    const hook = renderHook(() => useApp(null));
    act(() => hook.result.current.replayDrafts([serverNote()]));
    await settle();
    expect(update).not.toHaveBeenCalled();
    expect(hasSealedDraft(NOTE_ID)).toBe(true);
    expect(toast).toHaveBeenCalledWith(UNREADABLE_DRAFT, expect.objectContaining({ kind: "error" }));

    // Reported once, not on every replay.
    act(() => hook.result.current.replayDrafts([serverNote()]));
    await settle();
    expect(toast).toHaveBeenCalledTimes(1);
  });
});

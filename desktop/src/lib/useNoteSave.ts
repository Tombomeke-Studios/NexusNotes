import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { notes as notesApi, ApiError } from "./api";
import { saveDraft, loadDraft, loadDraftBase, rebaseDraft, clearDraft } from "./drafts";
import type { Note } from "./types";

/**
 * Save state of the open note. "conflict" means the server rejected the save
 * because the note changed elsewhere (409); the local text is kept, unsaved.
 */
export type SaveStatus = "saved" | "saving" | "unsaved" | "conflict" | "idle";

/** True while the open note holds text the server doesn't have yet. */
export function isDirtyStatus(status: SaveStatus): boolean {
  return status === "unsaved" || status === "saving" || status === "conflict";
}

/**
 * - conflict: the note changed elsewhere since it was loaded (409)
 * - network: the server was unreachable; retried automatically
 * - failed: anything else (encryption, server error); retried on the next edit
 */
export type SaveErrorKind = "conflict" | "network" | "failed";

export interface SaveError {
  noteId: string;
  kind: SaveErrorKind;
  message: string;
}

/** Whether the open note's latest text reached the server; why not, if it didn't. */
export type SaveOutcome = { ok: true } | { ok: false; error: SaveError };

/** Gateway errors are what a reverse proxy returns while the service restarts. */
const TRANSIENT_STATUSES = new Set([502, 503, 504]);

export function classifySaveError(err: unknown): SaveErrorKind {
  if (err instanceof ApiError) {
    if (err.status === 409) return "conflict";
    return TRANSIENT_STATUSES.has(err.status) ? "network" : "failed";
  }
  // fetch() rejects with a TypeError when the request never got a response.
  return err instanceof TypeError ? "network" : "failed";
}

/**
 * The checksum the server will store for an upload: the client's plaintext
 * checksum for e2ee vaults, otherwise SHA-256 of the sent content (mirrors
 * resolveChecksum in the sync service). Synchronous so it is known before
 * the request goes out.
 */
function expectedChecksum(payload: string, clientChecksum: string | undefined): string {
  return clientChecksum ?? bytesToHex(sha256(utf8ToBytes(payload)));
}

/** How many of its own recent checksums the hook remembers per note. */
const OWN_CHECKSUM_HISTORY = 20;

export const BASE_RETRY_DELAY_MS = 1000;
export const MAX_RETRY_DELAY_MS = 30_000;
/** Delay before re-saving edits that landed while an earlier save was in flight. */
export const FOLLOW_UP_DELAY_MS = 1000;

/** Exponential backoff for the n-th consecutive network failure (0-based), capped. */
export function retryDelay(attempt: number): number {
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
}

const MESSAGES: Record<SaveErrorKind, (err: unknown) => string> = {
  conflict: () =>
    "This note was changed elsewhere since you opened it. Your text is kept here but has not been saved.",
  network: () => "Can't reach the server. Your changes are kept and saving is retried automatically.",
  failed: (err) => `Couldn't save this note: ${err instanceof Error ? err.message : String(err)}`,
};

export interface NoteSaveDeps {
  /** The note open in the editor; the caller refreshes it on every render. */
  activeNoteRef: MutableRefObject<Note | null>;
  /** The editor's latest text for the open note; the caller refreshes it on every render. */
  editorContentRef: MutableRefObject<string>;
  setActiveNote: Dispatch<SetStateAction<Note | null>>;
  setNoteList: Dispatch<SetStateAction<Note[]>>;
  setEditorContent: (content: string) => void;
  /** The save status shown in the chrome; owned by the caller. */
  setSaveStatus: Dispatch<SetStateAction<SaveStatus>>;
  /** Called after every successful save (drives the "Synced …" label). */
  onSynced: () => void;
  /** Prepares plaintext for upload (ciphertext + plaintext checksum for e2ee vaults). */
  encryptOutgoing: (vaultId: string, plaintext: string) => Promise<{ content: string; checksum?: string }>;
  /** False when plaintext must never touch disk (e2ee vaults), so no local draft is kept. */
  keepsDrafts: (vaultId: string) => boolean;
  /** While true (close-confirmation dialog open) background saves wait. */
  paused?: boolean;
  /**
   * Identifies the signed-in session (the user id; null when signed out).
   * When it changes, every queued save, retry and in-flight result is
   * dropped, so nothing is sent or applied across a sign-out.
   */
  sessionKey?: string | null;
}

interface SaveRequest {
  /** Snapshot of the note when the save was requested (title, path, checksum). */
  note: Note;
  content: string;
  /** The note's edit version the content corresponds to. */
  version: number;
}

/**
 * Saving the note open in the editor (#263).
 *
 * - Every live edit bumps a per-note version. A save that completes after
 *   newer edits only adopts the server's checksum: the note stays unsaved,
 *   its draft is kept and a follow-up save is scheduled.
 * - Saves are serialised per note; requests queued behind an in-flight save
 *   coalesce into one PUT of the latest text, based on the checksum the
 *   previous save returned.
 * - A 409 turns into a "conflict" that keeps the local text; network errors
 *   retry with capped exponential backoff; other errors report a message.
 *
 * All returned callbacks are stable; they always read the latest deps.
 */
export function useNoteSave(deps: NoteSaveDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const [saveError, setSaveError] = useState<SaveError | null>(null);

  const versions = useRef(new Map<string, number>());
  /** Version of the most recent save requested per note (queued or sent). */
  const requested = useRef(new Map<string, number>());
  /** The next save to send per note, waiting for the in-flight one. */
  const queued = useRef(new Map<string, SaveRequest>());
  const workers = useRef(new Map<string, Promise<void>>());
  /** Last checksum change made by our own save, per note: from → to. */
  const transitions = useRef(new Map<string, { from: string; to: string }>());
  const failures = useRef(new Map<string, number>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** Bumped on sign-out: results of requests from an earlier session are ignored. */
  const generation = useRef(0);
  /** The newest save requested per note, kept until the server confirms it. */
  const lastRequests = useRef(new Map<string, SaveRequest>());
  /** Checksums of content this client sent recently, per note: recognises our own echoes. */
  const ownChecksums = useRef(new Map<string, string[]>());

  const rememberOwn = (id: string, checksum: string) => {
    const list = ownChecksums.current.get(id) ?? [];
    if (!list.includes(checksum)) list.push(checksum);
    ownChecksums.current.set(id, list.slice(-OWN_CHECKSUM_HISTORY));
  };
  /** Edit version of the newest text the server confirmed, per note. */
  const savedVersions = useRef(new Map<string, number>());
  /** Why the note's most recent save failed; cleared by a successful save. */
  const lastErrors = useRef(new Map<string, SaveError>());

  const versionOf = (id: string) => versions.current.get(id) ?? 0;
  const isActive = (id: string) => depsRef.current.activeNoteRef.current?.id === id;

  const cancelTimer = (id: string) => {
    const t = timers.current.get(id);
    if (t !== undefined) clearTimeout(t);
    timers.current.delete(id);
  };

  const clearErrorFor = (id: string) => setSaveError((e) => (e?.noteId === id ? null : e));

  // The open note's React state may not have caught up with a save that just
  // finished; a snapshot still on the checksum it replaced uses the new one.
  const resolveBase = (noteId: string, checksum: string) => {
    const t = transitions.current.get(noteId);
    return t && t.from === checksum ? t.to : checksum;
  };
  const baseChecksum = (note: Note) => resolveBase(note.id, note.checksum);

  const succeed = (req: SaveRequest, updated: Note, base: string) => {
    const { note, content, version } = req;
    const d = depsRef.current;
    transitions.current.set(note.id, { from: base, to: updated.checksum });
    rememberOwn(note.id, updated.checksum);
    savedVersions.current.set(note.id, version);
    lastErrors.current.delete(note.id);
    failures.current.delete(note.id);
    clearErrorFor(note.id);
    const saved = { ...updated, content };
    if (lastRequests.current.get(note.id)?.version === version) lastRequests.current.delete(note.id);
    if (versionOf(note.id) === version) {
      cancelTimer(note.id);
      clearDraft(note.id);
      d.setNoteList((prev) => prev.map((n) => (n.id === saved.id ? saved : n)));
      // Only refresh the open note / status if we haven't since navigated away
      // (e.g. a save flushed on blur while clicking a preview link).
      d.setActiveNote((prev) => (prev && prev.id === saved.id ? saved : prev));
      if (isActive(note.id)) d.setSaveStatus("saved");
    } else {
      // Newer edits exist: adopt the server's checksum and timestamps but keep
      // the local title, the "unsaved" status and the draft.
      const merge = (n: Note) => ({ ...saved, title: n.title });
      d.setNoteList((prev) => prev.map((n) => (n.id === saved.id ? merge(n) : n)));
      d.setActiveNote((prev) => (prev && prev.id === saved.id ? merge(prev) : prev));
      rebaseDraft(note.id, base, updated.checksum);
      scheduleFollowUp(note.id);
    }
    d.onSynced();
  };

  const fail = (req: SaveRequest, kind: SaveErrorKind, err: unknown) => {
    const id = req.note.id;
    const d = depsRef.current;
    const error: SaveError = { noteId: id, kind, message: MESSAGES[kind](err) };
    lastErrors.current.set(id, error);
    setSaveError(error);
    if (kind === "conflict") {
      cancelTimer(id);
      if (isActive(id)) d.setSaveStatus("conflict");
      return;
    }
    // A save queued behind this one is about to run and acts as the retry.
    if (queued.current.has(id)) return;
    if (isActive(id)) d.setSaveStatus((s) => (s === "conflict" ? s : "unsaved"));
    if (kind === "network") {
      const attempt = failures.current.get(id) ?? 0;
      failures.current.set(id, attempt + 1);
      schedule(id, retryDelay(attempt), req);
    }
  };

  const attempt = async (req: SaveRequest) => {
    const { note, content, version } = req;
    const d = depsRef.current;
    const gen = generation.current;
    const stale = () => gen !== generation.current;
    if (isActive(note.id) && versionOf(note.id) === version) {
      d.setSaveStatus((s) => (s === "conflict" ? s : "saving"));
    }
    let payload: string;
    let checksum: string | undefined;
    try {
      // For e2ee vaults only ciphertext + the plaintext checksum go out; the
      // server echoes the ciphertext back, so state keeps the local plaintext.
      ({ content: payload, checksum } = await d.encryptOutgoing(note.vault_id, content));
    } catch (err) {
      if (!stale()) fail(req, "failed", err);
      return;
    }
    if (stale()) return;
    const base = baseChecksum(note);
    // Before sending: the server pushes note:updated before it answers the PUT.
    rememberOwn(note.id, expectedChecksum(payload, checksum));
    let updated: Awaited<ReturnType<typeof notesApi.update>>;
    try {
      updated = await notesApi.update(note.id, note.title, note.path, payload, base, checksum);
    } catch (err) {
      if (!stale()) fail(req, classifySaveError(err), err);
      return;
    }
    if (stale()) return;
    if (updated && "checksum" in updated) succeed(req, updated as Note, base);
  };

  /** Runs the note's queued saves one at a time; resolves once the queue is empty. */
  const drain = (id: string): Promise<void> => {
    let worker = workers.current.get(id);
    if (!worker) {
      worker = (async () => {
        try {
          for (let req = queued.current.get(id); req; req = queued.current.get(id)) {
            queued.current.delete(id);
            try {
              await attempt(req);
            } catch (err) {
              // Callers (autosave timers, close handlers) never see a rejection.
              fail(req, "failed", err);
            }
          }
        } finally {
          // Runs synchronously after the empty-queue check, so a request
          // enqueued afterwards always starts a new worker.
          workers.current.delete(id);
        }
      })();
      workers.current.set(id, worker);
    }
    return worker;
  };

  const enqueue = (note: Note, content: string): Promise<void> => {
    const version = versionOf(note.id);
    requested.current.set(note.id, version);
    cancelTimer(note.id);
    const req = { note, content, version };
    queued.current.set(note.id, req);
    lastRequests.current.set(note.id, req);
    if (isActive(note.id)) depsRef.current.setSaveStatus((s) => (s === "conflict" ? s : "saving"));
    return drain(note.id);
  };

  /**
   * Arms a background save for the note: a network retry (`retry` given) or a
   * follow-up for edits that no save has requested yet. A retry resends the
   * failed request's text unless the user has typed since; only then does it
   * take the editor's newer text. (After the note was reopened the editor may
   * hold the server copy, and e2ee notes have no draft to restore from.)
   */
  const schedule = (id: string, delay: number, retry?: SaveRequest) => {
    cancelTimer(id);
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        const d = depsRef.current;
        if (d.paused) {
          schedule(id, delay, retry);
          return;
        }
        const active = d.activeNoteRef.current;
        if (retry && versionOf(id) === retry.version) {
          void enqueue(retry.note, retry.content);
        } else if (active?.id === id) {
          const unrequested = versionOf(id) > (requested.current.get(id) ?? -1);
          if (retry || unrequested) void enqueue(active, d.editorContentRef.current);
        } else if (retry) {
          void enqueue(retry.note, retry.content);
        }
      }, delay),
    );
  };

  const scheduleFollowUp = (id: string) => {
    if (versionOf(id) > (requested.current.get(id) ?? -1) && !timers.current.has(id)) {
      schedule(id, FOLLOW_UP_DELAY_MS);
    }
  };

  // Nothing may fire after unmount.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
    };
  }, []);

  // App stays mounted across sign-out (it renders the auth screen instead),
  // so a session change drops the whole pipeline: no retry or queued save
  // may go out under the next session, and in-flight results are ignored.
  const sessionKey = deps.sessionKey ?? null;
  const lastSession = useRef(sessionKey);
  useEffect(() => {
    if (lastSession.current === sessionKey) return;
    lastSession.current = sessionKey;
    generation.current += 1;
    for (const t of timers.current.values()) clearTimeout(t);
    timers.current.clear();
    queued.current.clear();
    lastRequests.current.clear();
    ownChecksums.current.clear();
    versions.current.clear();
    requested.current.clear();
    transitions.current.clear();
    failures.current.clear();
    savedVersions.current.clear();
    lastErrors.current.clear();
    setSaveError(null);
  }, [sessionKey]);

  /**
   * Saves the open note with the given text. Resolves once the note's save
   * queue is empty, reporting whether its newest text reached the server.
   */
  const saveNote = useCallback(async (content: string): Promise<SaveOutcome> => {
    const d = depsRef.current;
    const current = d.activeNoteRef.current;
    if (!current) return { ok: true };
    d.setEditorContent(content);
    await enqueue(current, content);
    const id = current.id;
    if (savedVersions.current.get(id) === versionOf(id)) return { ok: true };
    return {
      ok: false,
      error: lastErrors.current.get(id) ?? {
        noteId: id,
        kind: "failed",
        message: "Your latest changes haven't been saved yet.",
      },
    };
    // The helpers only touch refs and the stable deps ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Marks the open note as edited (e.g. a rename) without new editor text. */
  const markDirty = useCallback(() => {
    const d = depsRef.current;
    const current = d.activeNoteRef.current;
    if (current) versions.current.set(current.id, versionOf(current.id) + 1);
    d.setSaveStatus((s) => (s === "conflict" ? s : "unsaved"));
  }, []);

  // Live editor edits mark the note dirty immediately (so the tab dot / status
  // show unsaved before the debounced autosave runs).
  const liveChange = useCallback((content: string) => {
    const d = depsRef.current;
    d.setEditorContent(content);
    markDirty();
    // Mirror to a local draft so nothing is lost if the app closes before the
    // debounced server save runs — except for e2ee vaults, where plaintext
    // must never touch disk (localStorage included).
    const current = d.activeNoteRef.current;
    if (current && d.keepsDrafts(current.vault_id)) {
      saveDraft(current.id, content, baseChecksum(current));
    }
    // baseChecksum only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markDirty]);

  /**
   * Drops the open note's unsaved changes ("Close without saving"): no draft,
   * no pending retry or queued save, status back to saved.
   */
  const discard = useCallback(() => {
    const d = depsRef.current;
    const id = d.activeNoteRef.current?.id;
    if (id) {
      cancelTimer(id);
      queued.current.delete(id);
      lastRequests.current.delete(id);
      failures.current.delete(id);
      lastErrors.current.delete(id);
      clearDraft(id);
      clearErrorFor(id);
    }
    d.setSaveStatus("saved");
  }, []);

  /**
   * Local text of a note that the server doesn't have yet, for reopening it:
   * the draft (standard vaults) or else the text of a save the server hasn't
   * confirmed (failed, queued or in flight; e2ee notes keep no draft). Comes
   * with the checksum it was written against. The caller must open the text
   * on that version, not on the freshly loaded server copy, so saving it
   * gets a 409 if another device changed the note in between.
   */
  const localCopy = useCallback((note: Note): { content: string; checksum: string } | null => {
    const draft = depsRef.current.keepsDrafts(note.vault_id) ? loadDraft(note.id) : null;
    if (draft !== null) {
      if (draft === note.content) return null;
      // A legacy draft without a stored base falls back to the server copy.
      return { content: draft, checksum: resolveBase(note.id, loadDraftBase(note.id) ?? note.checksum) };
    }
    const req = lastRequests.current.get(note.id);
    if (!req || req.content === note.content) return null;
    return { content: req.content, checksum: baseChecksum(req.note) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Decides whether a pushed note:updated may be merged into the open note
   * while it holds unsaved text. Yes when it is the echo of one of our own
   * saves or matches the version the local text is based on. Otherwise
   * another device changed the note: it switches to "conflict" and the
   * caller must keep the local text and base checksum, so the next save gets
   * a 409 instead of silently overwriting that edit.
   */
  const acceptRemoteUpdate = useCallback((incoming: Note): boolean => {
    const d = depsRef.current;
    const current = d.activeNoteRef.current;
    if (!current || current.id !== incoming.id) return true;
    if (incoming.checksum === baseChecksum(current)) return true;
    if (ownChecksums.current.get(incoming.id)?.includes(incoming.checksum)) return true;
    cancelTimer(incoming.id);
    const error: SaveError = { noteId: incoming.id, kind: "conflict", message: MESSAGES.conflict(null) };
    lastErrors.current.set(incoming.id, error);
    setSaveError(error);
    d.setSaveStatus("conflict");
    return false;
    // baseChecksum and cancelTimer only read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { saveNote, liveChange, markDirty, discard, localCopy, acceptRemoteUpdate, saveError };
}

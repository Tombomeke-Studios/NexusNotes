import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "./api";
import { createLoadSequence, keepsDecryptedPush } from "./syncEvents";
import { toast } from "./toast";
import { trashActions } from "./trash";
import type { Note, TrashedNote, VaultRole } from "./types";

/** Debounce for reloading the list after note:trashed (a folder sends one per note). */
export const TRASH_REFRESH_MS = 250;

/** The active vault as the Trash needs it; null when none is open or it is locked. */
export interface TrashVault {
  id: string;
  encryption?: "none" | "e2ee";
  role?: VaultRole;
}

/** A trashed note as the panel shows it: plaintext only. */
export interface TrashEntry {
  id: string;
  /** Null when the sealed title could not be decrypted ("Encrypted note"). */
  title: string | null;
  /** Original folder, "" for the vault root; null when it could not be decrypted. */
  folder: string | null;
  deletedAt: string;
  purgeAt: string;
}

export interface TrashDeps {
  api: {
    list: (vaultId: string) => Promise<TrashedNote[]>;
    restore: (noteId: string) => Promise<Note>;
    purge: (noteId: string) => Promise<void>;
    empty: (vaultId: string) => Promise<{ purged: number }>;
  };
  /** Opens a sealed title or path (plaintext passes through); throws when it can't. */
  openField: (vault: TrashVault, value: string) => Promise<string>;
  /** Decrypts a restored note for state; readable is false when that failed. */
  decryptNote: (note: Note) => Promise<{ note: Note; readable: boolean }>;
  /** The vault's key in this session, null while locked. */
  keyOf: (vaultId: string) => Uint8Array | null;
  /** A restored note, decrypted: it joins the workspace at its original path. */
  onRestored: (note: Note) => void;
  /** Opens a note (the restore toast's "Open"). */
  openNote: (noteId: string) => void;
}

function reasonOf(err: unknown): string {
  return err instanceof Error && err.message ? ` (${err.message})` : "";
}

const isGone = (err: unknown) => err instanceof ApiError && err.status === 404;

/**
 * The active vault's Trash (#569): its list, the panel's open state, and
 * restore / delete for good / empty, limited to what the vault role allows.
 * Titles and folders are decrypted on this device in e2ee vaults; a lock
 * while that runs drops the result, and a locked vault (vault = null) holds
 * nothing. App feeds it the note:trashed / note:restored / note:deleted
 * events through onSyncEvent.
 */
export function useTrash(vault: TrashVault | null, deps: TrashDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const vaultRef = useRef(vault);
  vaultRef.current = vault;
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [emptying, setEmptying] = useState(false);
  const loads = useRef(createLoadSequence());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { canRestore, canPurge } = trashActions(vault?.role);
  const vaultId = vault?.id ?? null;
  const e2ee = vault?.encryption === "e2ee";

  const refresh = useCallback(async () => {
    const v = vaultRef.current;
    const token = loads.current.begin();
    if (!v) return;
    const d = depsRef.current;
    setLoading(true);
    try {
      const keyBefore = d.keyOf(v.id);
      const list = await d.api.list(v.id);
      const opened: TrashEntry[] = [];
      for (const n of list) {
        const reveal = (value: string) => d.openField(v, value).catch(() => null);
        opened.push({ id: n.id, title: await reveal(n.title), folder: await reveal(n.path), deletedAt: n.deleted_at, purgeAt: n.purge_at });
      }
      if (!loads.current.isCurrent(token)) return;
      // Decrypted with a key the vault no longer holds (locked meanwhile): drop it.
      const keyAfter = d.keyOf(v.id);
      if (!keepsDecryptedPush({ e2ee: v.encryption === "e2ee", readable: true, keyBefore, keyAfter })) return;
      setEntries(opened);
    } catch (err) {
      if (loads.current.isCurrent(token)) setError(`Couldn't load the Trash${reasonOf(err)}.`);
    } finally {
      if (loads.current.isCurrent(token)) setLoading(false);
    }
  }, []);

  // A vault switch, lock or unlock: start over.
  useEffect(() => {
    clearTimeout(refreshTimer.current);
    loads.current.invalidate();
    setEntries([]);
    setError(null);
    setBusyIds(new Set());
    setLoading(false);
    if (!vaultId) {
      setOpen(false);
      return;
    }
    void refresh();
  }, [vaultId, e2ee, refresh]);

  useEffect(() => () => clearTimeout(refreshTimer.current), []);

  const openTrash = useCallback(() => {
    if (!vaultRef.current) return;
    setOpen(true);
    setError(null);
    void refresh();
  }, [refresh]);
  const closeTrash = useCallback(() => setOpen(false), []);

  const markBusy = (id: string, busy: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  const drop = (id: string) => setEntries((prev) => prev.filter((e) => e.id !== id));
  const labelOf = (id: string) => {
    const title = entriesRef.current.find((e) => e.id === id)?.title;
    return title === null || title === undefined ? "Encrypted note" : title || "Untitled";
  };

  const restore = useCallback(async (noteId: string) => {
    const v = vaultRef.current;
    if (!v || !trashActions(v.role).canRestore) return;
    const d = depsRef.current;
    const label = labelOf(noteId);
    markBusy(noteId, true);
    setError(null);
    try {
      const keyBefore = d.keyOf(v.id);
      const raw = await d.api.restore(noteId);
      drop(noteId);
      const { note, readable } = await d.decryptNote(raw);
      const keyAfter = d.keyOf(v.id);
      const sameVault = vaultRef.current?.id === v.id;
      if (sameVault && keepsDecryptedPush({ e2ee: v.encryption === "e2ee", readable, keyBefore, keyAfter })) {
        d.onRestored(note);
      }
      toast(`Restored "${label}"`, {
        kind: "success",
        action: {
          label: "Open",
          onClick: () => {
            setOpen(false);
            depsRef.current.openNote(noteId);
          },
        },
      });
    } catch (err) {
      if (isGone(err)) drop(noteId);
      else setError(`Couldn't restore "${label}"${reasonOf(err)}. Try again.`);
    } finally {
      markBusy(noteId, false);
    }
  }, []);

  const purge = useCallback(async (noteId: string) => {
    const v = vaultRef.current;
    if (!v || !trashActions(v.role).canPurge) return;
    const label = labelOf(noteId);
    markBusy(noteId, true);
    setError(null);
    try {
      await depsRef.current.api.purge(noteId);
      drop(noteId);
    } catch (err) {
      if (isGone(err)) drop(noteId);
      else setError(`Couldn't delete "${label}"${reasonOf(err)}. Try again.`);
    } finally {
      markBusy(noteId, false);
    }
  }, []);

  const emptyTrash = useCallback(async () => {
    const v = vaultRef.current;
    if (!v || !trashActions(v.role).canPurge) return;
    setEmptying(true);
    setError(null);
    try {
      await depsRef.current.api.empty(v.id);
      if (vaultRef.current?.id === v.id) setEntries([]);
    } catch (err) {
      setError(`Couldn't empty the Trash${reasonOf(err)}. Try again.`);
      void refresh();
    } finally {
      setEmptying(false);
    }
  }, [refresh]);

  /** note:trashed reloads the list (debounced); note:restored and a purge's note:deleted drop the entry. */
  const onSyncEvent = useCallback((type: string, payload: unknown) => {
    const p = (payload ?? {}) as { id?: string; note_id?: string; vault_id?: string };
    if (type === "note:trashed") {
      if (!vaultRef.current || p.vault_id !== vaultRef.current.id) return;
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void refresh(), TRASH_REFRESH_MS);
    } else if (type === "note:restored" && p.id) {
      drop(p.id);
    } else if (type === "note:deleted" && p.note_id) {
      drop(p.note_id);
    }
  }, [refresh]);

  return useMemo(
    () => ({
      entries,
      count: entries.length,
      open,
      loading,
      error,
      busyIds,
      emptying,
      canRestore,
      canPurge,
      openTrash,
      closeTrash,
      refresh,
      restore,
      purge,
      emptyTrash,
      onSyncEvent,
    }),
    [entries, open, loading, error, busyIds, emptying, canRestore, canPurge, openTrash, closeTrash, refresh, restore, purge, emptyTrash, onSyncEvent],
  );
}

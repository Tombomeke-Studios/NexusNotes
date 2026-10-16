import { useCallback, useEffect, useRef, useState } from "react";
import { isE2eeVault, vaultKeySession, type VaultLike } from "./vaultKeys";
import { toast } from "./toast";
import type { PaletteCommand } from "./palette";
import { NOT_SAVED_YET, type SaveError, type SaveOutcome } from "./useNoteSave";

/** How often the idle clock is looked at; an auto-lock lands at most this late. */
export const IDLE_CHECK_MS = 15_000;

/** What counts as using the app: any keyboard, mouse, touch or focus activity. */
export const ACTIVITY_EVENTS = ["keydown", "pointerdown", "pointermove", "wheel", "touchstart", "focusin", "focus"] as const;

/** Saves a lock runs before it gives up on text that keeps changing. */
export const MAX_SAVE_ROUNDS = 3;

export type LockableVault = VaultLike & { name: string };

/** A manual lock that could not save the vault's text: the failed-save form shows it. */
export interface LockFailure {
  vaultId: string;
  error: SaveError;
  /** Nothing failed: newer edits arrived while the lock was saving. */
  edited?: boolean;
}

export interface VaultLockDeps {
  /** The vaults this window knows about. */
  vaults: () => readonly LockableVault[];
  /** The vault open in the workspace. */
  activeVaultId: () => string | null;
  /** Saves every note of the vault whose text the server hasn't confirmed yet. */
  saveVault: (vaultId: string) => Promise<SaveOutcome>;
  /**
   * Whether any note of the vault still holds text the server hasn't
   * confirmed. Must be exact without a re-render: it is the last check
   * before the key is dropped.
   */
  hasUnsavedText: (vaultId: string) => boolean;
  /**
   * Why the vault can't lock right now (a question about its unsaved text is
   * open, such as "deleted elsewhere", #561; an import into it), or null.
   * Asked before the save and again right before the key is dropped.
   */
  busyReason: (vaultId: string) => string | null;
  /** Drops every decrypted copy of the vault this window holds (state, tabs, dialogs). */
  clearVault: (vaultId: string) => void;
  /** Opens the unlock dialog: the user is back at a vault an auto-lock closed. */
  promptUnlock: (vaultId: string) => void;
  /** Idle minutes before every unlocked vault locks; 0 = never. */
  autoLockMinutes: number;
  /** Overrides the #549 seam below (tests). */
  keepUnsavedText?: (vaultId: string, error: SaveError) => Promise<boolean>;
}

/**
 * THE seam for encrypted drafts (#549): a vault is about to lock, but some of
 * its text did not reach the server (offline, server down, conflict). Returns
 * true when that text is kept somewhere safe, so the lock may go ahead.
 *
 * Today there is no such place: e2ee vaults keep no local drafts (plaintext
 * never touches disk), and once the key is gone the in-memory text could
 * never be encrypted again. So it returns false and the vault stays unlocked:
 * a manual lock shows the failed-save form, an auto-lock is postponed. With
 * encrypted drafts this seals the text under the vault key into a local
 * draft and returns true.
 */
export async function keepUnsavedTextWhileLocked(vaultId: string, error: SaveError): Promise<boolean> {
  // #549: seal the vault's unconfirmed text into encrypted drafts here.
  void vaultId;
  void error;
  return false;
}

/** Whether the vault is end-to-end encrypted and its key is in memory. */
export function canLockVault(vault: VaultLike | null | undefined): boolean {
  return !!vault && isE2eeVault(vault) && vaultKeySession.get(vault.id) !== null;
}

/** The palette's "Lock vault" command, offered only while the vault can be locked. */
export function lockVaultCommands(
  vault: VaultLike | null | undefined,
  lock: (vaultId: string) => void,
): PaletteCommand[] {
  if (!vault || !canLockVault(vault)) return [];
  return [{ id: "lock-vault", label: "Lock vault", action: () => lock(vault.id) }];
}

/**
 * manual: the user asked. auto: the idle timer fired while nobody was there;
 * the unlock dialog opens on their next activity. expired: the user came back
 * after the idle time ran out unnoticed (timers don't run while the machine
 * sleeps); the lock still happens and the unlock dialog opens at once.
 */
type Mode = "manual" | "auto" | "expired";

/**
 * Locking an encrypted vault (#545), by hand or after `autoLockMinutes` idle.
 *
 * A lock never discards text: the vault's unsaved notes are saved first, and
 * only once the server has them (checked again synchronously right before the
 * key is dropped) does the key go, along with every decrypted copy. When that
 * save fails the vault stays unlocked; a manual lock reports it in `failure`
 * (the failed-save form: retry / keep editing), an auto-lock shows a toast
 * and tries again on the next idle tick. `locking` lists the vaults a lock is
 * saving right now; their editor should be read-only meanwhile, so an
 * auto-lock that is under way finishes even when the user comes back. Each
 * vault locks on its own; the others stay as they are.
 */
export function useVaultLock(deps: VaultLockDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const [failure, setFailure] = useState<LockFailure | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [locking, setLocking] = useState<readonly string[]>([]);
  // Bumped by every lock, so the chrome (lock icons, commands) re-renders
  // even when the vault wasn't the open one and no workspace state changed.
  const [, setLocks] = useState(0);

  const inFlight = useRef(new Set<string>());
  const lastActivity = useRef(Date.now());
  const autoRunning = useRef(false);
  /** An auto-lock postponed in this idle stretch already said so. */
  const postponeToasted = useRef(false);
  /** The open vault an auto-lock closed: the user gets the unlock dialog on return. */
  const returnPrompt = useRef<string | null>(null);

  const run = useCallback(async (vaultId: string, mode: Mode): Promise<boolean> => {
    const vault = depsRef.current.vaults().find((v) => v.id === vaultId);
    if (!vault || !canLockVault(vault) || inFlight.current.has(vaultId)) return false;
    inFlight.current.add(vaultId);
    setLocking([...inFlight.current]);
    const postpone = (reason: string | null, error: SaveError | null, edited = false) => {
      if (mode === "manual") {
        if (error) setFailure({ vaultId, error, edited });
        else if (reason) toast(reason, { kind: "error", key: "vault-lock" });
        return false;
      }
      if (!postponeToasted.current) {
        postponeToasted.current = true;
        const retry = mode === "auto" ? " Trying again while you're away." : "";
        toast(`Couldn't lock: unsaved changes in "${vault.name}".${retry}`, { kind: "error", key: "vault-lock" });
      }
      return false;
    };
    try {
      const busy = depsRef.current.busyReason(vaultId);
      if (busy) return postpone(busy, null);
      // Save until the server has everything; text typed meanwhile gets
      // another round. Only after a round with nothing left may the key go.
      let kept = false;
      for (let round = 0; !kept && depsRef.current.hasUnsavedText(vaultId); round++) {
        if (round === MAX_SAVE_ROUNDS) {
          return postpone(null, { noteId: "", kind: "failed", message: NOT_SAVED_YET }, true);
        }
        const outcome = await depsRef.current.saveVault(vaultId);
        if (outcome.ok || outcome.error.message === NOT_SAVED_YET) continue;
        const keep = depsRef.current.keepUnsavedText ?? keepUnsavedTextWhileLocked;
        if (await keep(vaultId, outcome.error)) kept = true;
        else return postpone(null, outcome.error);
      }
      // Nothing is awaited from here on: what is checked is what holds when
      // the key is dropped.
      if (!canLockVault(vault)) return false;
      if (!kept && depsRef.current.hasUnsavedText(vaultId)) {
        return postpone(null, { noteId: "", kind: "failed", message: NOT_SAVED_YET }, true);
      }
      // A question that opened during the save still has its text and needs
      // the key (Keep, #561).
      const late = depsRef.current.busyReason(vaultId);
      if (late) return postpone(late, null);
      vaultKeySession.lock(vaultId);
      depsRef.current.clearVault(vaultId);
      setLocks((n) => n + 1);
      setFailure((f) => (f?.vaultId === vaultId ? null : f));
      const open = depsRef.current.activeVaultId() === vaultId;
      if (mode === "auto" && open) returnPrompt.current = vaultId;
      if (mode === "expired" && open) depsRef.current.promptUnlock(vaultId);
      if (mode === "manual") toast(`Locked "${vault.name}".`, { kind: "success", key: "vault-lock" });
      return true;
    } finally {
      inFlight.current.delete(vaultId);
      setLocking([...inFlight.current]);
    }
  }, []);

  /** Locks every unlocked encrypted vault, one after the other. */
  const lockAll = useCallback(
    async (mode: Mode) => {
      if (autoRunning.current) return;
      autoRunning.current = true;
      try {
        for (const vault of depsRef.current.vaults()) {
          if (canLockVault(vault)) await run(vault.id, mode);
        }
      } finally {
        autoRunning.current = false;
      }
    },
    [run],
  );

  /** Locks the vault now (the vault menu, the palette, the lock icon). */
  const lock = useCallback((vaultId: string) => run(vaultId, "manual"), [run]);

  /** The failed-save form's Retry. */
  const retry = useCallback(async () => {
    const f = failure;
    if (!f || retrying) return;
    setRetrying(true);
    try {
      await run(f.vaultId, "manual");
    } finally {
      setRetrying(false);
    }
  }, [failure, retrying, run]);

  /** The failed-save form's Keep editing: the vault stays unlocked. */
  const dismiss = useCallback(() => {
    if (!retrying) setFailure(null);
  }, [retrying]);

  // Any activity resets the idle clock, and coming back to a vault that an
  // auto-lock closed asks for its passphrase. Activity after the idle time
  // ran out unnoticed (timers don't run while the machine sleeps) locks
  // first: the clock is only reset once the lock has started.
  useEffect(() => {
    const onActivity = (e: Event) => {
      // A pointer passing over a window in the background is not use.
      if (e.type === "pointermove" && !document.hasFocus()) return;
      const now = Date.now();
      const limit = depsRef.current.autoLockMinutes * 60_000;
      if (limit > 0 && now - lastActivity.current >= limit) void lockAll("expired");
      lastActivity.current = now;
      postponeToasted.current = false;
      const id = returnPrompt.current;
      if (id === null) return;
      returnPrompt.current = null;
      const d = depsRef.current;
      const vault = d.vaults().find((v) => v.id === id);
      if (d.activeVaultId() === id && isE2eeVault(vault) && !canLockVault(vault)) d.promptUnlock(id);
    };
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, onActivity, { capture: true, passive: true });
    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity, { capture: true });
    };
  }, [lockAll]);

  const minutes = deps.autoLockMinutes;
  useEffect(() => {
    if (!minutes || minutes <= 0) return;
    const limit = minutes * 60_000;
    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current >= limit) void lockAll("auto");
    }, IDLE_CHECK_MS);
    return () => clearInterval(timer);
  }, [minutes, lockAll]);

  return { lock, locking, failure, retrying, retry, dismiss };
}

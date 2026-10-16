import { useCallback, useEffect, useRef, useState } from "react";
import { isE2eeVault, vaultKeySession, type VaultLike } from "./vaultKeys";
import { toast } from "./toast";
import type { PaletteCommand } from "./palette";
import type { SaveError, SaveOutcome } from "./useNoteSave";

/** How often the idle clock is looked at; an auto-lock lands at most this late. */
export const IDLE_CHECK_MS = 15_000;

/** What counts as using the app: any keyboard, mouse, touch or focus activity. */
export const ACTIVITY_EVENTS = ["keydown", "pointerdown", "pointermove", "wheel", "touchstart", "focusin", "focus"] as const;

export type LockableVault = VaultLike & { name: string };

/** A manual lock that could not save the vault's text: the failed-save form shows it. */
export interface LockFailure {
  vaultId: string;
  error: SaveError;
}

export interface VaultLockDeps {
  /** The vaults this window knows about. */
  vaults: () => readonly LockableVault[];
  /** The vault open in the workspace. */
  activeVaultId: () => string | null;
  /** Saves every note of the vault whose text the server hasn't confirmed yet. */
  saveVault: (vaultId: string) => Promise<SaveOutcome>;
  /**
   * Why the vault can't lock right now (a question about its unsaved text is
   * open, such as "deleted elsewhere", #561), or null. Asked before the save
   * and again right before the key is dropped.
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

type Mode = "manual" | "auto";

/**
 * Locking an encrypted vault (#545), by hand or after `autoLockMinutes` idle.
 *
 * A lock never discards text: the vault's unsaved notes are saved first, and
 * only once the server has them is the key dropped and every decrypted copy
 * cleared. When that save fails the vault stays unlocked; a manual lock
 * reports it in `failure` (the failed-save form: retry / keep editing), an
 * auto-lock shows a toast and tries again on the next idle tick. Each vault
 * locks on its own; the others stay as they are.
 */
export function useVaultLock(deps: VaultLockDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const [failure, setFailure] = useState<LockFailure | null>(null);
  const [retrying, setRetrying] = useState(false);
  // Bumped by every lock, so the chrome (lock icons, commands) re-renders
  // even when the vault wasn't the open one and no workspace state changed.
  const [, setLocks] = useState(0);

  const locking = useRef(new Set<string>());
  const lastActivity = useRef(Date.now());
  const autoRunning = useRef(false);
  /** An auto-lock postponed in this idle stretch already said so. */
  const postponeToasted = useRef(false);
  /** The open vault an auto-lock closed: the user gets the unlock dialog on return. */
  const returnPrompt = useRef<string | null>(null);

  const run = useCallback(async (vaultId: string, mode: Mode): Promise<boolean> => {
    const vault = depsRef.current.vaults().find((v) => v.id === vaultId);
    if (!vault || !canLockVault(vault) || locking.current.has(vaultId)) return false;
    locking.current.add(vaultId);
    const startedAt = lastActivity.current;
    // The user came back while an auto-lock was saving: leave it be.
    const userReturned = () => mode === "auto" && lastActivity.current !== startedAt;
    const postpone = (reason: string | null, error: SaveError | null) => {
      if (mode === "manual") {
        if (error) setFailure({ vaultId, error });
        else if (reason) toast(reason, { kind: "error", key: "vault-lock" });
        return false;
      }
      if (!postponeToasted.current) {
        postponeToasted.current = true;
        toast(`Couldn't lock: unsaved changes in "${vault.name}". Trying again while you're away.`, {
          kind: "error",
          key: "vault-lock",
        });
      }
      return false;
    };
    try {
      const d = depsRef.current;
      const busy = d.busyReason(vaultId);
      if (busy) return postpone(busy, null);
      const outcome = await d.saveVault(vaultId);
      if (!outcome.ok) {
        const keep = depsRef.current.keepUnsavedText ?? keepUnsavedTextWhileLocked;
        if (!(await keep(vaultId, outcome.error))) return postpone(null, outcome.error);
      }
      if (userReturned() || !canLockVault(vault)) return false;
      // Checked again with nothing awaited after it: a question that opened
      // during the save still has its text and needs the key (Keep, #561).
      const late = depsRef.current.busyReason(vaultId);
      if (late) return postpone(late, null);
      vaultKeySession.lock(vaultId);
      depsRef.current.clearVault(vaultId);
      setLocks((n) => n + 1);
      setFailure((f) => (f?.vaultId === vaultId ? null : f));
      if (mode === "auto" && depsRef.current.activeVaultId() === vaultId) returnPrompt.current = vaultId;
      if (mode === "manual") toast(`Locked "${vault.name}".`, { kind: "success", key: "vault-lock" });
      return true;
    } finally {
      locking.current.delete(vaultId);
    }
  }, []);

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
  // auto-lock closed asks for its passphrase.
  useEffect(() => {
    const onActivity = () => {
      lastActivity.current = Date.now();
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
  }, []);

  const minutes = deps.autoLockMinutes;
  useEffect(() => {
    if (!minutes || minutes <= 0) return;
    const limit = minutes * 60_000;
    const timer = setInterval(() => {
      if (autoRunning.current || Date.now() - lastActivity.current < limit) return;
      autoRunning.current = true;
      void (async () => {
        try {
          for (const vault of depsRef.current.vaults()) {
            if (canLockVault(vault)) await run(vault.id, "auto");
          }
        } finally {
          autoRunning.current = false;
        }
      })();
    }, IDLE_CHECK_MS);
    return () => clearInterval(timer);
  }, [minutes, run]);

  return { lock, failure, retrying, retry, dismiss };
}

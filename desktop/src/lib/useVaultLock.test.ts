import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vaultKeySession } from "./vaultKeys";
import { NOT_SAVED_YET, type SaveError, type SaveOutcome } from "./useNoteSave";
import {
  IDLE_CHECK_MS,
  MAX_SAVE_ROUNDS,
  keepUnsavedTextWhileLocked,
  lockVaultCommands,
  useVaultLock,
  type LockableVault,
  type VaultLockDeps,
} from "./useVaultLock";

vi.mock("./toast", () => ({ toast: vi.fn() }));
import { toast } from "./toast";

const MINUTE = 60_000;
const offline: SaveError = { noteId: "n1", kind: "network", message: "Can't reach the server." };
const VAULTS: LockableVault[] = [
  { id: "v1", name: "Private", encryption: "e2ee" },
  { id: "v2", name: "Diary", encryption: "e2ee" },
  { id: "v3", name: "Work", encryption: "none" },
];

/**
 * Each vault starts with unsaved text; a successful save clears it unless
 * the test says otherwise (like the real hasUnsavedText, which reads the
 * edit versions).
 */
function setup(overrides: Partial<VaultLockDeps> = {}) {
  const dirty = new Set(["v1", "v2"]);
  const save = overrides.saveVault ?? (async (): Promise<SaveOutcome> => ({ ok: true }));
  const deps: VaultLockDeps = {
    vaults: () => VAULTS,
    activeVaultId: () => "v1",
    busyReason: vi.fn(() => null),
    hasUnsavedText: vi.fn((id: string) => dirty.has(id)),
    clearVault: vi.fn(),
    promptUnlock: vi.fn(),
    autoLockMinutes: 0,
    ...overrides,
    saveVault: vi.fn(async (id: string) => {
      const outcome = await save(id);
      if (outcome.ok) dirty.delete(id);
      return outcome;
    }),
  };
  const hook = renderHook((props: Partial<VaultLockDeps>) => useVaultLock({ ...deps, ...props }), {
    initialProps: {},
  });
  return { deps, hook, dirty };
}

const unlocked = (id: string) => vaultKeySession.get(id) !== null;

beforeEach(() => {
  vaultKeySession.clear();
  vaultKeySession.set("v1", new Uint8Array(32));
  vaultKeySession.set("v2", new Uint8Array(32).fill(1));
  vi.mocked(toast).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useVaultLock — locking by hand", () => {
  it("saves the vault's text, drops its key and clears its decrypted copies", async () => {
    const { hook, deps } = setup();
    let locked = false;
    await act(async () => {
      locked = await hook.result.current.lock("v1");
    });
    expect(locked).toBe(true);
    expect(deps.saveVault).toHaveBeenCalledWith("v1");
    expect(unlocked("v1")).toBe(false);
    expect(deps.clearVault).toHaveBeenCalledWith("v1");
    expect(hook.result.current.failure).toBeNull();
    expect(toast).toHaveBeenCalledWith('Locked "Private".', expect.objectContaining({ kind: "success" }));
  });

  it("sends no save when nothing is unsaved", async () => {
    const { hook, deps, dirty } = setup();
    dirty.clear();
    await act(async () => {
      expect(await hook.result.current.lock("v1")).toBe(true);
    });
    expect(deps.saveVault).not.toHaveBeenCalled();
  });

  it("leaves the other vaults unlocked", async () => {
    const { hook } = setup();
    await act(async () => {
      await hook.result.current.lock("v1");
    });
    expect(unlocked("v2")).toBe(true);
  });

  it("does nothing for a standard or an already locked vault", async () => {
    vaultKeySession.lock("v2");
    const { hook, deps } = setup();
    await act(async () => {
      expect(await hook.result.current.lock("v3")).toBe(false);
      expect(await hook.result.current.lock("v2")).toBe(false);
    });
    expect(deps.saveVault).not.toHaveBeenCalled();
    expect(deps.clearVault).not.toHaveBeenCalled();
  });

  it("lists the vault as locking while it saves, so its editor can be read-only", async () => {
    let finish: (o: SaveOutcome) => void = () => {};
    const { hook } = setup({ saveVault: () => new Promise<SaveOutcome>((resolve) => (finish = resolve)) });
    let pending: Promise<boolean> = Promise.resolve(false);
    act(() => {
      pending = hook.result.current.lock("v1");
    });
    expect(hook.result.current.locking).toEqual(["v1"]);
    await act(async () => {
      finish({ ok: true });
      await pending;
    });
    expect(hook.result.current.locking).toEqual([]);
    expect(unlocked("v1")).toBe(false);
  });

  it("saves again when text arrives during the save, and only then drops the key", async () => {
    const { hook, deps, dirty } = setup();
    let rounds = 0;
    vi.mocked(deps.saveVault).mockImplementation(async (id: string) => {
      rounds += 1;
      // The first save lands while newer edits came in: still unsaved.
      if (rounds > 1) dirty.delete(id);
      return rounds === 1 ? { ok: false, error: { noteId: "n1", kind: "failed", message: NOT_SAVED_YET } } : { ok: true };
    });
    await act(async () => {
      expect(await hook.result.current.lock("v1")).toBe(true);
    });
    expect(rounds).toBe(2);
    expect(unlocked("v1")).toBe(false);
  });

  it("keeps the vault unlocked and says new edits arrived when the text keeps changing", async () => {
    const { hook, deps } = setup();
    // Every save succeeds, yet there is always newer text by the time it lands.
    vi.mocked(deps.saveVault).mockImplementation(async () => ({ ok: true }));
    await act(async () => {
      expect(await hook.result.current.lock("v1")).toBe(false);
    });
    expect(deps.saveVault).toHaveBeenCalledTimes(MAX_SAVE_ROUNDS);
    expect(unlocked("v1")).toBe(true);
    expect(deps.clearVault).not.toHaveBeenCalled();
    expect(hook.result.current.failure).toMatchObject({ vaultId: "v1", edited: true });
  });

  it("keeps the vault unlocked and shows the failed-save form when the save fails", async () => {
    const saveVault = vi.fn(async (): Promise<SaveOutcome> => ({ ok: false, error: offline }));
    const { hook, deps } = setup({ saveVault });
    let locked = true;
    await act(async () => {
      locked = await hook.result.current.lock("v1");
    });
    expect(locked).toBe(false);
    expect(unlocked("v1")).toBe(true);
    expect(deps.clearVault).not.toHaveBeenCalled();
    expect(hook.result.current.failure).toEqual({ vaultId: "v1", error: offline, edited: false });
  });

  it("locks on Retry once the save goes through", async () => {
    const saveVault = vi
      .fn<(id: string) => Promise<SaveOutcome>>()
      .mockResolvedValueOnce({ ok: false, error: offline })
      .mockResolvedValue({ ok: true });
    const { hook, deps } = setup({ saveVault });
    await act(async () => {
      await hook.result.current.lock("v1");
    });
    await act(async () => {
      await hook.result.current.retry();
    });
    expect(unlocked("v1")).toBe(false);
    expect(deps.clearVault).toHaveBeenCalledWith("v1");
    expect(hook.result.current.failure).toBeNull();
    expect(hook.result.current.retrying).toBe(false);
  });

  it("Keep editing closes the form and leaves the vault unlocked", async () => {
    const saveVault = vi.fn(async (): Promise<SaveOutcome> => ({ ok: false, error: offline }));
    const { hook } = setup({ saveVault });
    await act(async () => {
      await hook.result.current.lock("v1");
    });
    act(() => hook.result.current.dismiss());
    expect(hook.result.current.failure).toBeNull();
    expect(unlocked("v1")).toBe(true);
  });

  it("waits for an open question about the vault's text (deleted elsewhere, #561) and says why", async () => {
    const busyReason = vi.fn((id: string) => (id === "v1" ? "Decide about the deleted note first." : null));
    const { hook, deps } = setup({ busyReason });
    await act(async () => {
      expect(await hook.result.current.lock("v1")).toBe(false);
    });
    expect(deps.saveVault).not.toHaveBeenCalled();
    expect(unlocked("v1")).toBe(true);
    expect(toast).toHaveBeenCalledWith("Decide about the deleted note first.", expect.objectContaining({ kind: "error" }));
  });

  it("does not drop the key when such a question opens while the save runs", async () => {
    let asking = false;
    const busyReason = vi.fn(() => (asking ? "Decide about the deleted note first." : null));
    const saveVault = vi.fn(async (): Promise<SaveOutcome> => {
      asking = true;
      return { ok: true };
    });
    const { hook, deps } = setup({ busyReason, saveVault });
    await act(async () => {
      expect(await hook.result.current.lock("v1")).toBe(false);
    });
    expect(unlocked("v1")).toBe(true);
    expect(deps.clearVault).not.toHaveBeenCalled();
  });

  it("locks despite a failed save once encrypted drafts (#549) keep the text", async () => {
    const saveVault = vi.fn(async (): Promise<SaveOutcome> => ({ ok: false, error: offline }));
    const keepUnsavedText = vi.fn(async () => true);
    const { hook } = setup({ saveVault, keepUnsavedText });
    await act(async () => {
      expect(await hook.result.current.lock("v1")).toBe(true);
    });
    expect(keepUnsavedText).toHaveBeenCalledWith("v1", offline);
    expect(unlocked("v1")).toBe(false);
  });

  it("has nowhere to keep unsaved text yet: the default seam refuses", async () => {
    expect(await keepUnsavedTextWhileLocked("v1", offline)).toBe(false);
  });
});

describe("useVaultLock — auto-lock when idle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // The app window has focus (jsdom says it never does).
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  it("never locks while auto-lock is off (the default)", async () => {
    const { deps } = setup();
    await advance(120 * MINUTE);
    expect(deps.saveVault).not.toHaveBeenCalled();
    expect(unlocked("v1")).toBe(true);
  });

  it("locks every unlocked encrypted vault after the idle time", async () => {
    const { deps } = setup({ autoLockMinutes: 5 });
    await advance(4 * MINUTE);
    expect(unlocked("v1")).toBe(true);
    await advance(MINUTE + IDLE_CHECK_MS);
    expect(unlocked("v1")).toBe(false);
    expect(unlocked("v2")).toBe(false);
    expect(deps.clearVault).toHaveBeenCalledWith("v1");
    expect(deps.clearVault).toHaveBeenCalledWith("v2");
    expect(deps.clearVault).not.toHaveBeenCalledWith("v3");
  });

  it("counts keyboard, mouse and focus activity as not idle", async () => {
    setup({ autoLockMinutes: 5 });
    for (const event of ["keydown", "pointermove", "focusin"]) {
      await advance(4 * MINUTE);
      window.dispatchEvent(new Event(event));
    }
    await advance(4 * MINUTE);
    expect(unlocked("v1")).toBe(true);
    await advance(MINUTE + IDLE_CHECK_MS);
    expect(unlocked("v1")).toBe(false);
  });

  it("ignores the pointer passing over the window while the app is in the background", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    setup({ autoLockMinutes: 5 });
    await advance(4 * MINUTE);
    window.dispatchEvent(new Event("pointermove"));
    await advance(MINUTE + IDLE_CHECK_MS);
    expect(unlocked("v1")).toBe(false);
  });

  it("locks on the first activity after the machine slept through the idle time", async () => {
    const { deps } = setup({ autoLockMinutes: 5 });
    // Asleep: the clock moves on, timers don't run.
    vi.setSystemTime(Date.now() + 3 * 60 * MINUTE);
    await act(async () => {
      window.dispatchEvent(new Event("pointermove"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(unlocked("v1")).toBe(false);
    expect(unlocked("v2")).toBe(false);
    // The user is here: the open vault asks for its passphrase straight away.
    expect(deps.promptUnlock).toHaveBeenCalledWith("v1");
  });

  it("is postponed with a toast when a save fails, and retries on the next idle tick", async () => {
    const saveVault = vi
      .fn<(id: string) => Promise<SaveOutcome>>()
      .mockResolvedValueOnce({ ok: false, error: offline })
      .mockResolvedValue({ ok: true });
    const { hook, deps } = setup({ autoLockMinutes: 5, saveVault, vaults: () => VAULTS.slice(0, 1) });
    await advance(5 * MINUTE);
    expect(deps.saveVault).toHaveBeenCalledTimes(1);
    expect(unlocked("v1")).toBe(true);
    expect(toast).toHaveBeenCalledWith(
      expect.stringMatching(/^Couldn't lock: unsaved changes/),
      expect.objectContaining({ kind: "error" }),
    );
    // Never the manual failed-save form: nobody is there to answer it.
    expect(hook.result.current.failure).toBeNull();

    await advance(IDLE_CHECK_MS);
    expect(unlocked("v1")).toBe(false);
  });

  it("toasts a postponed auto-lock once per idle stretch, not on every tick", async () => {
    const saveVault = vi.fn(async (): Promise<SaveOutcome> => ({ ok: false, error: offline }));
    const { deps } = setup({ autoLockMinutes: 5, saveVault, vaults: () => VAULTS.slice(0, 1) });
    await advance(5 * MINUTE + 4 * IDLE_CHECK_MS);
    expect(vi.mocked(deps.saveVault).mock.calls.length).toBeGreaterThan(1);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("finishes a started auto-lock when the user comes back during its save", async () => {
    let finish: (o: SaveOutcome) => void = () => {};
    const saveVault = vi.fn(() => new Promise<SaveOutcome>((resolve) => (finish = resolve)));
    const { hook, deps } = setup({ autoLockMinutes: 5, saveVault, vaults: () => VAULTS.slice(0, 1) });
    await advance(5 * MINUTE);
    expect(deps.saveVault).toHaveBeenCalled();
    expect(hook.result.current.locking).toEqual(["v1"]);
    window.dispatchEvent(new Event("keydown"));
    await act(async () => finish({ ok: true }));
    expect(unlocked("v1")).toBe(false);
  });

  it("asks for the passphrase when the user returns to the vault it locked", async () => {
    const { deps } = setup({ autoLockMinutes: 5 });
    await advance(5 * MINUTE + IDLE_CHECK_MS);
    expect(deps.promptUnlock).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("keydown"));
    expect(deps.promptUnlock).toHaveBeenCalledWith("v1");
    window.dispatchEvent(new Event("keydown"));
    expect(deps.promptUnlock).toHaveBeenCalledTimes(1);
  });

  it("does not prompt after a manual lock", async () => {
    const { hook, deps } = setup({ autoLockMinutes: 5 });
    await act(async () => {
      await hook.result.current.lock("v1");
    });
    window.dispatchEvent(new Event("keydown"));
    expect(deps.promptUnlock).not.toHaveBeenCalled();
  });

  it("follows a changed idle time without a restart", async () => {
    const { hook } = setup({ autoLockMinutes: 60 });
    await advance(10 * MINUTE);
    expect(unlocked("v1")).toBe(true);
    hook.rerender({ autoLockMinutes: 5 });
    await advance(IDLE_CHECK_MS);
    expect(unlocked("v1")).toBe(false);
  });
});

describe("lockVaultCommands", () => {
  it("offers Lock vault in the palette only for an unlocked encrypted vault", () => {
    const lock = vi.fn();
    expect(lockVaultCommands(VAULTS[0], lock).map((c) => c.label)).toEqual(["Lock vault"]);
    expect(lockVaultCommands(VAULTS[2], lock)).toEqual([]);
    expect(lockVaultCommands(undefined, lock)).toEqual([]);
    vaultKeySession.lock("v1");
    expect(lockVaultCommands(VAULTS[0], lock)).toEqual([]);
  });

  it("locks that vault when run", () => {
    const lock = vi.fn();
    lockVaultCommands(VAULTS[1], lock)[0].action();
    expect(lock).toHaveBeenCalledWith("v2");
  });
});

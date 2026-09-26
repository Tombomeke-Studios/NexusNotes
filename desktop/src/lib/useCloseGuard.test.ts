import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { useCloseGuard, type ClosePrompt } from "./useCloseGuard";
import type { SaveError, SaveOutcome } from "./useNoteSave";

const networkError: SaveError = { noteId: "n1", kind: "network", message: "Can't reach the server." };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function setup(save: () => Promise<SaveOutcome>, initial: ClosePrompt | null = { kind: "window" }) {
  const discard = vi.fn();
  const finishClose = vi.fn();
  const saveSpy = vi.fn(save);
  const hook = renderHook(() => {
    const [prompt, setPrompt] = useState<ClosePrompt | null>(initial);
    const guard = useCloseGuard({ prompt, setPrompt, save: saveSpy, discard, finishClose });
    return { ...guard, prompt, setPrompt };
  });
  return { hook, discard, finishClose, save: saveSpy };
}

describe("useCloseGuard — Save & close", () => {
  it("closes once the save succeeded", async () => {
    const { hook, finishClose } = setup(async () => ({ ok: true }));

    await act(() => hook.result.current.saveAndClose());

    expect(finishClose).toHaveBeenCalledWith({ kind: "window" });
    expect(hook.result.current.prompt).toBeNull();
    expect(hook.result.current.error).toBeNull();
  });

  it("stays open and explains why when the save fails", async () => {
    const { hook, finishClose } = setup(async () => ({ ok: false, error: networkError }));

    await act(() => hook.result.current.saveAndClose());

    expect(finishClose).not.toHaveBeenCalled();
    expect(hook.result.current.prompt).toEqual({ kind: "window" });
    expect(hook.result.current.error).toEqual(networkError);
    expect(hook.result.current.saving).toBe(false);
  });

  it("shows the saving state while waiting for the server", async () => {
    const pending = deferred<SaveOutcome>();
    const { hook, finishClose } = setup(() => pending.promise);

    let done!: Promise<void>;
    act(() => {
      done = hook.result.current.saveAndClose();
    });
    expect(hook.result.current.saving).toBe(true);
    expect(finishClose).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve({ ok: true });
      await done;
    });
    expect(hook.result.current.saving).toBe(false);
    expect(finishClose).toHaveBeenCalledTimes(1);
  });

  it("ignores a second click while the save is in progress", async () => {
    const pending = deferred<SaveOutcome>();
    const { hook, save } = setup(() => pending.promise);

    let done!: Promise<void>;
    act(() => {
      done = hook.result.current.saveAndClose();
    });
    await act(() => hook.result.current.saveAndClose());
    await act(async () => {
      pending.resolve({ ok: true });
      await done;
    });

    expect(save).toHaveBeenCalledTimes(1);
  });

  it("closes on a retry once the save goes through", async () => {
    const outcomes: SaveOutcome[] = [{ ok: false, error: networkError }, { ok: true }];
    const { hook, finishClose } = setup(async () => outcomes.shift()!);

    await act(() => hook.result.current.saveAndClose());
    expect(finishClose).not.toHaveBeenCalled();

    await act(() => hook.result.current.saveAndClose());
    expect(finishClose).toHaveBeenCalledWith({ kind: "window" });
    expect(hook.result.current.error).toBeNull();
  });

  it("closes a tab the same way", async () => {
    const { hook, finishClose } = setup(async () => ({ ok: true }), { kind: "tab", key: "n1" });

    await act(() => hook.result.current.saveAndClose());

    expect(finishClose).toHaveBeenCalledWith({ kind: "tab", key: "n1" });
  });
});

describe("useCloseGuard — other choices", () => {
  it("closes without saving when asked to, even after a failed save", async () => {
    const { hook, discard, finishClose } = setup(async () => ({ ok: false, error: networkError }));

    await act(() => hook.result.current.saveAndClose());
    await act(() => hook.result.current.discardAndClose());

    expect(discard).toHaveBeenCalledTimes(1);
    expect(finishClose).toHaveBeenCalledWith({ kind: "window" });
    expect(hook.result.current.prompt).toBeNull();
    expect(hook.result.current.error).toBeNull();
  });

  it("keeps editing: dismisses the dialog and forgets the error", async () => {
    const { hook, discard, finishClose } = setup(async () => ({ ok: false, error: networkError }));

    await act(() => hook.result.current.saveAndClose());
    act(() => hook.result.current.cancel());

    expect(hook.result.current.prompt).toBeNull();
    expect(hook.result.current.error).toBeNull();
    expect(discard).not.toHaveBeenCalled();
    expect(finishClose).not.toHaveBeenCalled();
  });
});

describe("useCloseGuard — OS-level close", () => {
  it("closes without a dialog when the save succeeds", async () => {
    const { hook, finishClose } = setup(async () => ({ ok: true }), null);

    await act(() => hook.result.current.saveThenClose({ kind: "window" }));

    expect(finishClose).toHaveBeenCalledWith({ kind: "window" });
    expect(hook.result.current.prompt).toBeNull();
  });

  it("shows the dialog in its saving state while a pending save settles", async () => {
    const pending = deferred<SaveOutcome>();
    const { hook, finishClose } = setup(() => pending.promise, null);

    let done!: Promise<void>;
    act(() => {
      done = hook.result.current.saveThenClose({ kind: "window" });
    });
    expect(hook.result.current.prompt).toEqual({ kind: "window" });
    expect(hook.result.current.saving).toBe(true);

    await act(async () => {
      pending.resolve({ ok: true });
      await done;
    });
    expect(hook.result.current.prompt).toBeNull();
    expect(finishClose).toHaveBeenCalledWith({ kind: "window" });
  });

  it("opens the dialog with the reason instead of closing when the save fails", async () => {
    const { hook, finishClose } = setup(async () => ({ ok: false, error: networkError }), null);

    await act(() => hook.result.current.saveThenClose({ kind: "window" }));

    expect(finishClose).not.toHaveBeenCalled();
    expect(hook.result.current.prompt).toEqual({ kind: "window" });
    expect(hook.result.current.error).toEqual(networkError);
  });
});

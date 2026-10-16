import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { TRASH_BATCH_LIMIT, useDeleteConfirm } from "./useDeleteConfirm";

function setup({
  trashOne = vi.fn<(id: string) => Promise<void>>(async () => {}),
  trashMany = vi.fn<(ids: string[]) => Promise<void>>(async () => {}),
} = {}) {
  const onDeleted = vi.fn();
  const hook = renderHook(() => useDeleteConfirm({ trashOne, trashMany, onDeleted }));
  return { hook, trashOne, trashMany, onDeleted };
}

async function confirm(hook: ReturnType<typeof setup>["hook"]) {
  await act(async () => {
    await hook.result.current.confirm();
  });
}

describe("useDeleteConfirm", () => {
  it("moves nothing until the user confirms", () => {
    const { hook, trashOne, trashMany } = setup();
    act(() => hook.result.current.request(["a", "b"]));
    expect(hook.result.current.pending).toEqual(["a", "b"]);
    expect(trashOne).not.toHaveBeenCalled();
    expect(trashMany).not.toHaveBeenCalled();
  });

  it("moves nothing on cancel", () => {
    const { hook, trashOne } = setup();
    act(() => hook.result.current.request(["a"]));
    act(() => hook.result.current.cancel());
    expect(hook.result.current.pending).toBeNull();
    expect(trashOne).not.toHaveBeenCalled();
  });

  it("ignores an empty request", () => {
    const { hook } = setup();
    act(() => hook.result.current.request([]));
    expect(hook.result.current.pending).toBeNull();
  });

  it("moves a single note with the single-note call", async () => {
    const { hook, trashOne, trashMany, onDeleted } = setup();
    act(() => hook.result.current.request(["a"]));
    await confirm(hook);
    expect(trashOne.mock.calls).toEqual([["a"]]);
    expect(trashMany).not.toHaveBeenCalled();
    expect(onDeleted).toHaveBeenCalledWith(["a"], null);
    expect(hook.result.current.pending).toBeNull();
  });

  it("moves several notes in one batch call (#569)", async () => {
    const { hook, trashOne, trashMany, onDeleted } = setup();
    act(() => hook.result.current.request(["a", "b", "a"]));
    await confirm(hook);
    expect(trashMany.mock.calls).toEqual([[["a", "b"]]]);
    expect(trashOne).not.toHaveBeenCalled();
    expect(onDeleted).toHaveBeenCalledWith(["a", "b"], null);
  });

  it("moves a folder's notes in one batch call, even a single note, and names the folder", async () => {
    const { hook, trashOne, trashMany, onDeleted } = setup();
    act(() => hook.result.current.request(["a"], "Projects"));
    expect(hook.result.current.folder).toBe("Projects");
    await confirm(hook);
    expect(trashMany.mock.calls).toEqual([[["a"]]]);
    expect(trashOne).not.toHaveBeenCalled();
    expect(onDeleted).toHaveBeenCalledWith(["a"], "Projects");
    expect(hook.result.current.folder).toBeNull();
  });

  it("splits more notes than one call takes into batches", async () => {
    const { hook, trashMany } = setup();
    const ids = Array.from({ length: TRASH_BATCH_LIMIT + 2 }, (_, i) => `n${i}`);
    act(() => hook.result.current.request(ids));
    await confirm(hook);
    expect(trashMany.mock.calls.map(([batch]) => batch.length)).toEqual([TRASH_BATCH_LIMIT, 2]);
  });

  it("keeps the notes of a failed batch in the dialog, with the reason", async () => {
    const trashMany = vi.fn(async (ids: string[]) => {
      if (ids[0] !== "n0") throw new Error("Failed to fetch");
    });
    const { hook, onDeleted } = setup({ trashMany });
    const ids = Array.from({ length: TRASH_BATCH_LIMIT + 2 }, (_, i) => `n${i}`);
    act(() => hook.result.current.request(ids, "Big"));
    await confirm(hook);
    expect(onDeleted).toHaveBeenCalledWith(ids.slice(0, TRASH_BATCH_LIMIT), null);
    expect(hook.result.current.pending).toEqual(ids.slice(TRASH_BATCH_LIMIT));
    // The folder is not done until all of its notes are.
    expect(hook.result.current.folder).toBe("Big");
    expect(hook.result.current.error).toMatch(/^Couldn't move 2 notes to the Trash \(Failed to fetch\)/);
    expect(hook.result.current.busy).toBe(false);
  });

  it("names a single failed note in the error", async () => {
    const trashOne = vi.fn(async () => {
      throw new Error("Failed to fetch");
    });
    const { hook, onDeleted } = setup({ trashOne });
    act(() => hook.result.current.request(["a"]));
    await confirm(hook);
    expect(hook.result.current.error).toMatch(/^Couldn't move this note to the Trash/);
    expect(hook.result.current.pending).toEqual(["a"]);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("counts a note that is already gone (404) as moved, not as an error (#586)", async () => {
    const trashOne = vi.fn(async () => {
      throw new ApiError(404, "note not found");
    });
    const { hook, onDeleted } = setup({ trashOne });
    act(() => hook.result.current.request(["a"]));
    await confirm(hook);
    expect(onDeleted).toHaveBeenCalledWith(["a"], null);
    expect(hook.result.current.pending).toBeNull();
    expect(hook.result.current.error).toBeNull();
  });
});

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDeleteConfirm } from "./useDeleteConfirm";

function setup(deleteOne = vi.fn<(id: string) => Promise<void>>(async () => {})) {
  const onDeleted = vi.fn();
  const hook = renderHook(() => useDeleteConfirm({ deleteOne, onDeleted }));
  return { hook, deleteOne, onDeleted };
}

describe("useDeleteConfirm", () => {
  it("deletes nothing until the user confirms", () => {
    const { hook, deleteOne } = setup();
    act(() => hook.result.current.request(["a", "b"]));
    expect(hook.result.current.pending).toEqual(["a", "b"]);
    expect(deleteOne).not.toHaveBeenCalled();
  });

  it("deletes nothing on cancel", () => {
    const { hook, deleteOne } = setup();
    act(() => hook.result.current.request(["a"]));
    act(() => hook.result.current.cancel());
    expect(hook.result.current.pending).toBeNull();
    expect(deleteOne).not.toHaveBeenCalled();
  });

  it("ignores an empty request", () => {
    const { hook } = setup();
    act(() => hook.result.current.request([]));
    expect(hook.result.current.pending).toBeNull();
  });

  it("deletes every requested note on confirm, then closes", async () => {
    const { hook, deleteOne, onDeleted } = setup();
    act(() => hook.result.current.request(["a", "b"]));
    await act(async () => {
      await hook.result.current.confirm();
    });
    expect(deleteOne.mock.calls).toEqual([["a"], ["b"]]);
    expect(onDeleted).toHaveBeenCalledWith(["a", "b"]);
    expect(hook.result.current.pending).toBeNull();
  });

  it("keeps the notes that could not be deleted in the dialog, with the reason", async () => {
    const deleteOne = vi.fn(async (id: string) => {
      if (id === "b") throw new Error("Failed to fetch");
    });
    const { hook, onDeleted } = setup(deleteOne);
    act(() => hook.result.current.request(["a", "b", "c"]));
    await act(async () => {
      await hook.result.current.confirm();
    });
    expect(deleteOne.mock.calls).toEqual([["a"], ["b"]]);
    expect(onDeleted).toHaveBeenCalledWith(["a"]);
    expect(hook.result.current.pending).toEqual(["b", "c"]);
    expect(hook.result.current.error).toMatch(/couldn.t delete/i);
    expect(hook.result.current.busy).toBe(false);
  });
});

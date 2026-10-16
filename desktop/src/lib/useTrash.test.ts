import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { clearToasts, getToasts } from "./toast";
import type { Note, TrashedNote } from "./types";
import { TRASH_REFRESH_MS, useTrash, type TrashDeps, type TrashVault } from "./useTrash";

function trashed(partial: Partial<TrashedNote>): TrashedNote {
  return {
    id: "n1",
    vault_id: "v1",
    title: "Plan",
    path: "Work",
    checksum: "c1",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    deleted_at: "2026-10-16T10:00:00Z",
    purge_at: "2026-11-15T10:00:00Z",
    ...partial,
  };
}

function note(partial: Partial<Note>): Note {
  return {
    id: "n1",
    vault_id: "v1",
    title: "Plan",
    path: "Work",
    content: "text",
    checksum: "c1",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...partial,
  };
}

const plainVault: TrashVault = { id: "v1", encryption: "none", role: "owner" };
const key = new Uint8Array(32);

function setup(overrides: Partial<TrashDeps> = {}, vault: TrashVault | null = plainVault) {
  const deps: TrashDeps = {
    api: {
      list: vi.fn(async () => [trashed({}), trashed({ id: "n2", title: "Old", path: "" })]),
      restore: vi.fn(async (id: string) => note({ id })),
      purge: vi.fn(async () => {}),
      empty: vi.fn(async () => ({ purged: 2 })),
    },
    openField: vi.fn(async (_v, value: string) => value),
    decryptNote: vi.fn(async (n: Note) => ({ note: n, readable: true })),
    keyOf: vi.fn(() => null),
    onRestored: vi.fn(),
    openNote: vi.fn(),
    ...overrides,
  };
  const hook = renderHook(({ v }) => useTrash(v, deps), { initialProps: { v: vault } });
  return { hook, deps };
}

beforeEach(() => clearToasts());
afterEach(() => {
  vi.useRealTimers();
  clearToasts();
});

describe("useTrash (#569)", () => {
  it("loads the active vault's trash with titles and folders", async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.entries).toHaveLength(2));
    expect(hook.result.current.entries[0]).toMatchObject({ id: "n1", title: "Plan", folder: "Work" });
    expect(hook.result.current.count).toBe(2);
  });

  it("holds nothing without a vault (none open, or locked)", async () => {
    const { hook, deps } = setup({}, null);
    await act(async () => {});
    expect(hook.result.current.entries).toEqual([]);
    expect(deps.api.list).not.toHaveBeenCalled();
  });

  it("drops the entries and closes the panel when the vault locks", async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.count).toBe(2));
    act(() => hook.result.current.openTrash());
    hook.rerender({ v: null });
    expect(hook.result.current.entries).toEqual([]);
    expect(hook.result.current.open).toBe(false);
  });

  it("decrypts titles and folders in e2ee vaults; one that fails reads as encrypted", async () => {
    const vault: TrashVault = { id: "v1", encryption: "e2ee", role: "owner" };
    const { hook } = setup(
      {
        keyOf: vi.fn(() => key),
        api: {
          list: vi.fn(async () => [trashed({ title: "e2ee:a", path: "e2ee:b" }), trashed({ id: "n2", title: "e2ee:bad", path: "e2ee:bad" })]),
          restore: vi.fn(),
          purge: vi.fn(),
          empty: vi.fn(),
        },
        openField: vi.fn(async (_v, value: string) => {
          if (value === "e2ee:bad") throw new Error("decrypt failed");
          return value === "e2ee:a" ? "Secret plan" : "Private";
        }),
      },
      vault,
    );
    await waitFor(() => expect(hook.result.current.entries).toHaveLength(2));
    expect(hook.result.current.entries[0]).toMatchObject({ title: "Secret plan", folder: "Private" });
    expect(hook.result.current.entries[1]).toMatchObject({ title: null, folder: null });
  });

  it("keeps no decrypted titles when the vault was locked during the decrypt", async () => {
    let current: Uint8Array | null = key;
    const vault: TrashVault = { id: "v1", encryption: "e2ee", role: "owner" };
    const { hook, deps } = setup(
      {
        keyOf: vi.fn(() => current),
        openField: vi.fn(async (_v, value: string) => {
          current = null;
          return `open:${value}`;
        }),
      },
      vault,
    );
    await waitFor(() => expect(deps.openField).toHaveBeenCalled());
    await act(async () => {});
    expect(hook.result.current.entries).toEqual([]);
  });

  it("restores a note: drops it from the trash, hands it to the workspace and toasts with Open", async () => {
    const { hook, deps } = setup();
    await waitFor(() => expect(hook.result.current.count).toBe(2));
    await act(async () => {
      await hook.result.current.restore("n1");
    });
    expect(deps.api.restore).toHaveBeenCalledWith("n1");
    expect(deps.onRestored).toHaveBeenCalledWith(expect.objectContaining({ id: "n1" }));
    expect(hook.result.current.entries.map((e) => e.id)).toEqual(["n2"]);
    const [t] = getToasts();
    expect(t.message).toBe('Restored "Plan"');
    act(() => hook.result.current.openTrash());
    act(() => t.action!.onClick());
    expect(deps.openNote).toHaveBeenCalledWith("n1");
    expect(hook.result.current.open).toBe(false);
  });

  it("does not hand over a restored e2ee note that could not be decrypted", async () => {
    const vault: TrashVault = { id: "v1", encryption: "e2ee", role: "owner" };
    const { hook, deps } = setup(
      { keyOf: vi.fn(() => key), decryptNote: vi.fn(async (n: Note) => ({ note: n, readable: false })) },
      vault,
    );
    await waitFor(() => expect(hook.result.current.count).toBe(2));
    await act(async () => {
      await hook.result.current.restore("n1");
    });
    expect(deps.onRestored).not.toHaveBeenCalled();
    expect(hook.result.current.entries.map((e) => e.id)).toEqual(["n2"]);
  });

  it("keeps the entry and says why when a restore fails", async () => {
    const { hook, deps } = setup();
    (deps.api.restore as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Failed to fetch"));
    await waitFor(() => expect(hook.result.current.count).toBe(2));
    await act(async () => {
      await hook.result.current.restore("n1");
    });
    expect(hook.result.current.entries).toHaveLength(2);
    expect(hook.result.current.error).toMatch(/Couldn't restore "Plan" \(Failed to fetch\)/);
  });

  it("drops an entry that is no longer in the trash (404)", async () => {
    const { hook, deps } = setup();
    (deps.api.purge as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new ApiError(404, "not found"));
    await waitFor(() => expect(hook.result.current.count).toBe(2));
    await act(async () => {
      await hook.result.current.purge("n1");
    });
    expect(hook.result.current.entries.map((e) => e.id)).toEqual(["n2"]);
    expect(hook.result.current.error).toBeNull();
  });

  it("deletes a note for good", async () => {
    const { hook, deps } = setup();
    await waitFor(() => expect(hook.result.current.count).toBe(2));
    await act(async () => {
      await hook.result.current.purge("n2");
    });
    expect(deps.api.purge).toHaveBeenCalledWith("n2");
    expect(hook.result.current.entries.map((e) => e.id)).toEqual(["n1"]);
  });

  it("empties the trash", async () => {
    const { hook, deps } = setup();
    await waitFor(() => expect(hook.result.current.count).toBe(2));
    await act(async () => {
      await hook.result.current.emptyTrash();
    });
    expect(deps.api.empty).toHaveBeenCalledWith("v1");
    expect(hook.result.current.entries).toEqual([]);
  });

  it("offers only what the role allows, and refuses the rest", async () => {
    const { hook, deps } = setup({}, { id: "v1", encryption: "none", role: "editor" });
    await waitFor(() => expect(hook.result.current.count).toBe(2));
    expect(hook.result.current.canRestore).toBe(true);
    expect(hook.result.current.canPurge).toBe(false);
    await act(async () => {
      await hook.result.current.purge("n1");
      await hook.result.current.emptyTrash();
    });
    expect(deps.api.purge).not.toHaveBeenCalled();
    expect(deps.api.empty).not.toHaveBeenCalled();
  });

  it("follows the sync events: restored and purged notes leave, trashed ones reload the list", async () => {
    const { hook, deps } = setup();
    await waitFor(() => expect(hook.result.current.count).toBe(2));
    act(() => hook.result.current.onSyncEvent("note:restored", { id: "n1", vault_id: "v1" }));
    expect(hook.result.current.entries.map((e) => e.id)).toEqual(["n2"]);
    act(() => hook.result.current.onSyncEvent("note:deleted", { note_id: "n2" }));
    expect(hook.result.current.entries).toEqual([]);

    vi.useFakeTimers();
    const calls = (deps.api.list as ReturnType<typeof vi.fn>).mock.calls.length;
    act(() => {
      hook.result.current.onSyncEvent("note:trashed", { note_id: "a", vault_id: "v1" });
      hook.result.current.onSyncEvent("note:trashed", { note_id: "b", vault_id: "v1" });
      hook.result.current.onSyncEvent("note:trashed", { note_id: "c", vault_id: "other" });
    });
    await act(async () => {
      vi.advanceTimersByTime(TRASH_REFRESH_MS);
    });
    // A folder's worth of events is one reload; other vaults' are ignored.
    expect((deps.api.list as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls + 1);
  });
});

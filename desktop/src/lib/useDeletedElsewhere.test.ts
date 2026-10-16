import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "./types";
import { useDeletedElsewhere, type DeletedElsewhereDeps } from "./useDeletedElsewhere";

function note(partial: Partial<Note>): Note {
  return {
    id: "n1",
    vault_id: "v1",
    title: "Plans",
    path: "Work",
    content: "server text",
    checksum: "c1",
    created_at: "2026-10-15T00:00:00Z",
    updated_at: "2026-10-15T00:00:00Z",
    ...partial,
  } as Note;
}

function setup(overrides: Partial<DeletedElsewhereDeps> = {}) {
  const open = note({ title: "Plans (renamed)" });
  const deps: DeletedElsewhereDeps = {
    activeNoteRef: { current: open },
    editorContentRef: { current: "my unsaved text" },
    noteListRef: { current: [note({ id: "n2", title: "Plans (renamed)" })] },
    encryptOutgoing: vi.fn(async (_vault: string, text: string) => ({ content: `enc:${text}`, checksum: undefined })),
    sealMeta: vi.fn(async (_vault: string, title: string, path: string) => ({ title: `sealed:${title}`, path: `sealed:${path}` })),
    createNote: vi.fn(async () => note({ id: "n3", title: "sealed", path: "sealed", content: "enc", checksum: "c3" })),
    discardUnsaved: vi.fn(),
    openReplacement: vi.fn(),
    closeNote: vi.fn(),
    ...overrides,
  };
  const hook = renderHook(() => useDeletedElsewhere(deps));
  return { deps, hook, open };
}

describe("useDeletedElsewhere", () => {
  it("keeps the open note and asks when it was deleted elsewhere with unsaved text", () => {
    const { hook, deps } = setup();
    let kept = false;
    act(() => {
      kept = hook.result.current.onRemoteDelete("n1", true);
    });
    expect(kept).toBe(true);
    expect(hook.result.current.deleted?.id).toBe("n1");
    expect(deps.closeNote).not.toHaveBeenCalled();
  });

  it("remembers that the note went to the Trash on another device (#569)", () => {
    const { hook } = setup();
    act(() => {
      hook.result.current.onRemoteDelete("n1", true, true);
    });
    expect(hook.result.current.deleted?.id).toBe("n1");
    expect(hook.result.current.trashed).toBe(true);
    act(() => hook.result.current.reset());
    expect(hook.result.current.trashed).toBe(false);
  });

  it("does not call a plain delete elsewhere a move to the Trash", () => {
    const { hook } = setup();
    act(() => {
      hook.result.current.onRemoteDelete("n1", true);
    });
    expect(hook.result.current.trashed).toBe(false);
  });

  it("lets a saved note close as before", () => {
    const { hook } = setup();
    let kept = true;
    act(() => {
      kept = hook.result.current.onRemoteDelete("n1", false);
    });
    expect(kept).toBe(false);
    expect(hook.result.current.deleted).toBeNull();
  });

  it("ignores the echo of a delete this device sent", () => {
    const { hook } = setup();
    act(() => hook.result.current.markOwnDelete("n1"));
    let kept = true;
    act(() => {
      kept = hook.result.current.onRemoteDelete("n1", true);
    });
    expect(kept).toBe(false);
    expect(hook.result.current.deleted).toBeNull();
  });

  it("asks again after this device's own delete failed", () => {
    const { hook } = setup();
    act(() => hook.result.current.markOwnDelete("n1"));
    act(() => hook.result.current.forgetOwnDelete("n1"));
    let kept = false;
    act(() => {
      kept = hook.result.current.onRemoteDelete("n1", true);
    });
    expect(kept).toBe(true);
  });

  it("keeps the text as a new note in the same vault and folder, with a unique title", async () => {
    const { hook, deps } = setup();
    act(() => {
      hook.result.current.onRemoteDelete("n1", true);
    });
    await act(async () => {
      await hook.result.current.keepAsNew();
    });
    expect(deps.encryptOutgoing).toHaveBeenCalledWith("v1", "my unsaved text");
    expect(deps.sealMeta).toHaveBeenCalledWith("v1", "Plans (renamed) 1", "Work");
    expect(deps.createNote).toHaveBeenCalledWith("v1", "sealed:Plans (renamed) 1", "sealed:Work", "enc:my unsaved text", undefined);
    // The old note's pending saves go only once the new note exists.
    expect(deps.discardUnsaved).toHaveBeenCalledTimes(1);
    expect(deps.openReplacement).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ id: "n3", title: "Plans (renamed) 1", path: "Work", content: "my unsaved text" }),
    );
    expect(hook.result.current.deleted).toBeNull();
  });

  it("keeps the text and shows why when the new note can't be created", async () => {
    const { hook, deps } = setup({ createNote: vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))) });
    act(() => {
      hook.result.current.onRemoteDelete("n1", true);
    });
    await act(async () => {
      await hook.result.current.keepAsNew();
    });
    expect(deps.discardUnsaved).not.toHaveBeenCalled();
    expect(deps.openReplacement).not.toHaveBeenCalled();
    expect(hook.result.current.deleted?.id).toBe("n1");
    expect(hook.result.current.error).toMatch(/couldn.t create/i);
    expect(hook.result.current.busy).toBe(false);
  });

  it("discards the text and closes the note only on Discard", () => {
    const { hook, deps } = setup();
    act(() => {
      hook.result.current.onRemoteDelete("n1", true);
    });
    act(() => hook.result.current.discard());
    expect(deps.discardUnsaved).toHaveBeenCalledTimes(1);
    expect(deps.closeNote).toHaveBeenCalledWith("n1");
    expect(hook.result.current.deleted).toBeNull();
  });

  it("forgets the question on reset (vault switch, sign-out)", () => {
    const { hook } = setup();
    act(() => {
      hook.result.current.onRemoteDelete("n1", true);
    });
    act(() => hook.result.current.reset());
    expect(hook.result.current.deleted).toBeNull();
  });

  it("closes the question when its vault becomes encrypted elsewhere", () => {
    const { hook } = setup();
    act(() => {
      hook.result.current.onRemoteDelete("n1", true);
    });
    act(() => hook.result.current.onVaultEncrypted("other-vault"));
    expect(hook.result.current.deleted?.id).toBe("n1");
    act(() => hook.result.current.onVaultEncrypted("v1"));
    expect(hook.result.current.deleted).toBeNull();
    expect(hook.result.current.busy).toBe(false);
  });

  it("sends nothing from a Keep still running when the vault becomes encrypted", async () => {
    let release: (v: { content: string; checksum?: string }) => void = () => {};
    const encryptOutgoing = vi.fn(
      () => new Promise<{ content: string; checksum?: string }>((resolve) => (release = resolve)),
    );
    const { hook, deps } = setup({ encryptOutgoing });
    act(() => {
      hook.result.current.onRemoteDelete("n1", true);
    });
    let keeping: Promise<void> = Promise.resolve();
    act(() => {
      keeping = hook.result.current.keepAsNew();
    });
    expect(hook.result.current.busy).toBe(true);
    act(() => hook.result.current.onVaultEncrypted("v1"));
    await act(async () => {
      release({ content: "my unsaved text" });
      await keeping;
    });
    expect(deps.sealMeta).not.toHaveBeenCalled();
    expect(deps.createNote).not.toHaveBeenCalled();
    expect(deps.discardUnsaved).not.toHaveBeenCalled();
    expect(deps.openReplacement).not.toHaveBeenCalled();
    expect(hook.result.current.deleted).toBeNull();
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.busy).toBe(false);
  });

  it("tells a vault lock (#545) that it is still asking about one of that vault's notes", () => {
    const { hook } = setup();
    expect(hook.result.current.asksAbout("v1")).toBe(false);
    act(() => {
      hook.result.current.onRemoteDelete("n1", true);
    });
    // Read without a re-render: a lock checks it right before dropping the key.
    expect(hook.result.current.asksAbout("v1")).toBe(true);
    expect(hook.result.current.asksAbout("other-vault")).toBe(false);
    act(() => hook.result.current.discard());
    expect(hook.result.current.asksAbout("v1")).toBe(false);
  });
});

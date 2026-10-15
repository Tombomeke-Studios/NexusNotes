import { describe, expect, it } from "vitest";
import { createLoadSequence, deletedNoteAction, isForVault } from "./syncEvents";

describe("deletedNoteAction", () => {
  const base = { deletedId: "n1", openNoteId: "n1", ownDelete: false, unsavedText: true };

  it("keeps the open note on screen when it holds text the server doesn't have", () => {
    expect(deletedNoteAction(base)).toBe("ask");
  });

  it("closes the open note when all its text is saved", () => {
    expect(deletedNoteAction({ ...base, unsavedText: false })).toBe("close");
  });

  it("closes a note that isn't open", () => {
    expect(deletedNoteAction({ ...base, openNoteId: "n2" })).toBe("close");
    expect(deletedNoteAction({ ...base, openNoteId: null })).toBe("close");
  });

  it("closes the note when this device deleted it", () => {
    expect(deletedNoteAction({ ...base, ownDelete: true })).toBe("close");
  });
});

describe("isForVault", () => {
  it("accepts a note of the open vault", () => {
    expect(isForVault({ vault_id: "v1" }, "v1")).toBe(true);
  });

  it("rejects a note of another vault", () => {
    expect(isForVault({ vault_id: "v2" }, "v1")).toBe(false);
  });

  it("rejects everything while no vault is open", () => {
    expect(isForVault({ vault_id: "v1" }, null)).toBe(false);
  });

  it("rejects a payload without a vault id", () => {
    expect(isForVault({} as { vault_id: string }, "v1")).toBe(false);
    expect(isForVault(null as unknown as { vault_id: string }, "v1")).toBe(false);
  });
});

describe("createLoadSequence", () => {
  it("treats only the latest load as current", () => {
    const seq = createLoadSequence();
    const first = seq.begin();
    expect(seq.isCurrent(first)).toBe(true);
    const second = seq.begin();
    expect(seq.isCurrent(first)).toBe(false);
    expect(seq.isCurrent(second)).toBe(true);
  });

  it("makes every running load stale on invalidate (a locked vault was selected)", () => {
    const seq = createLoadSequence();
    const running = seq.begin();
    seq.invalidate();
    expect(seq.isCurrent(running)).toBe(false);
    expect(seq.isCurrent(seq.begin())).toBe(true);
  });

  it("keeps separate sequences apart", () => {
    const a = createLoadSequence();
    const b = createLoadSequence();
    const tokenA = a.begin();
    b.begin();
    b.invalidate();
    expect(a.isCurrent(tokenA)).toBe(true);
  });
});

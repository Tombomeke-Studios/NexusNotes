import { describe, it, expect, beforeEach, vi } from "vitest";
import { toast, dismissToast, getToasts, subscribeToasts, clearToasts, MAX_TOASTS } from "./toast";

beforeEach(() => clearToasts());

describe("toast store", () => {
  it("adds toasts newest last and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToasts(listener);
    const a = toast("First");
    toast("Second", { kind: "error" });
    expect(getToasts().map((t) => [t.message, t.kind])).toEqual([
      ["First", "info"],
      ["Second", "error"],
    ]);
    expect(listener).toHaveBeenCalledTimes(2);
    dismissToast(a);
    expect(getToasts().map((t) => t.message)).toEqual(["Second"]);
    unsubscribe();
    toast("Third");
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("keeps only the newest few", () => {
    for (let i = 0; i < MAX_TOASTS + 2; i++) toast(`T${i}`);
    expect(getToasts()).toHaveLength(MAX_TOASTS);
    expect(getToasts()[0].message).toBe("T2");
  });

  it("replaces a toast with the same key instead of stacking it", () => {
    toast("Link copied", { key: "copy" });
    toast("Link copied", { key: "copy" });
    expect(getToasts()).toHaveLength(1);
  });

  it("updates a keyed toast in place, so no second copy is on screen while the old one leaves (#604)", () => {
    toast("First");
    const progress = toast("Importing 6 of 7…", { key: "import", duration: 60_000 });
    const before = getToasts()[1];
    const done = toast("Imported 7 notes", { key: "import", kind: "success" });
    expect(done).toBe(progress);
    expect(getToasts().map((t) => t.message)).toEqual(["First", "Imported 7 notes"]);
    const after = getToasts()[1];
    expect(after).not.toBe(before);
    expect([after.id, after.kind, after.duration]).toEqual([progress, "success", 3500]);
  });

  it("drops the action of a keyed toast when its replacement has none", () => {
    toast("Moved to Trash", { key: "trash", action: { label: "Undo", onClick: () => {} } });
    toast("Trash emptied", { key: "trash" });
    expect(getToasts()[0].action).toBeUndefined();
  });

  it("returns a stable snapshot between changes", () => {
    toast("x");
    expect(getToasts()).toBe(getToasts());
  });
});

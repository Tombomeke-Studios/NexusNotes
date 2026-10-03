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

  it("returns a stable snapshot between changes", () => {
    toast("x");
    expect(getToasts()).toBe(getToasts());
  });
});

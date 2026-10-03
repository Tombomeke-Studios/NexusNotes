import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Toaster } from "./Toaster";
import { toast, clearToasts, getToasts } from "../lib/toast";

beforeEach(() => {
  vi.useFakeTimers();
  clearToasts();
});
afterEach(() => vi.useRealTimers());

describe("Toaster", () => {
  it("shows toasts and dismisses them after their time", () => {
    render(<Toaster />);
    act(() => {
      toast("Link copied", { duration: 1000 });
    });
    expect(screen.getByRole("status").textContent).toContain("Link copied");
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(getToasts()).toHaveLength(0);
  });

  it("announces errors as alerts", () => {
    render(<Toaster />);
    act(() => {
      toast("Couldn't export", { kind: "error" });
    });
    expect(screen.getByRole("alert").textContent).toContain("Couldn't export");
  });

  it("waits while the pointer is over a toast", () => {
    render(<Toaster />);
    act(() => {
      toast("Hold on", { duration: 1000 });
    });
    const item = screen.getByRole("status");
    fireEvent.mouseEnter(item);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(getToasts()).toHaveLength(1);
    fireEvent.mouseLeave(item);
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(getToasts()).toHaveLength(0);
  });

  it("can be closed by hand", () => {
    render(<Toaster />);
    act(() => {
      toast("Closable");
    });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(getToasts()).toHaveLength(0);
  });
});

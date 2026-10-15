import { describe, expect, it, vi } from "vitest";
import { rafThrottle } from "./rafThrottle";

function fakeFrames() {
  let next = 1;
  const queued = new Map<number, FrameRequestCallback>();
  return {
    request: (cb: FrameRequestCallback) => {
      const id = next++;
      queued.set(id, cb);
      return id;
    },
    cancel: (id: number) => {
      queued.delete(id);
    },
    flush: () => {
      const callbacks = [...queued.values()];
      queued.clear();
      for (const cb of callbacks) cb(0);
    },
    pending: () => queued.size,
  };
}

describe("rafThrottle", () => {
  it("delivers only the latest value once per frame", () => {
    const frames = fakeFrames();
    const fn = vi.fn();
    const throttled = rafThrottle(fn, frames.request, frames.cancel);
    throttled.push(1);
    throttled.push(2);
    throttled.push(3);
    expect(fn).not.toHaveBeenCalled();
    expect(frames.pending()).toBe(1);
    frames.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });

  it("schedules a new frame after the previous one ran", () => {
    const frames = fakeFrames();
    const fn = vi.fn();
    const throttled = rafThrottle(fn, frames.request, frames.cancel);
    throttled.push("a");
    frames.flush();
    throttled.push("b");
    frames.flush();
    expect(fn.mock.calls).toEqual([["a"], ["b"]]);
  });

  it("drops a pending value when cancelled", () => {
    const frames = fakeFrames();
    const fn = vi.fn();
    const throttled = rafThrottle(fn, frames.request, frames.cancel);
    throttled.push(1);
    throttled.cancel();
    frames.flush();
    expect(fn).not.toHaveBeenCalled();
    throttled.push(2);
    frames.flush();
    expect(fn).toHaveBeenCalledWith(2);
  });
});

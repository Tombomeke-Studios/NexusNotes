/**
 * Coalesces rapid updates (zoom, scroll, drag) into at most one call per
 * animation frame, always with the latest value. Use it to keep React state
 * that mirrors a 60+ Hz event stream from re-rendering on every event.
 */
export interface RafThrottled<T> {
  push: (value: T) => void;
  /** Drops a pending value (call on unmount). */
  cancel: () => void;
}

export function rafThrottle<T>(
  fn: (value: T) => void,
  request: (cb: FrameRequestCallback) => number = (cb) => requestAnimationFrame(cb),
  cancelFrame: (id: number) => void = (id) => cancelAnimationFrame(id),
): RafThrottled<T> {
  let frame: number | null = null;
  let latest: T;
  return {
    push(value) {
      latest = value;
      if (frame !== null) return;
      frame = request(() => {
        frame = null;
        fn(latest);
      });
    },
    cancel() {
      if (frame !== null) cancelFrame(frame);
      frame = null;
    },
  };
}

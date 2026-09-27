import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { MotionGlobalConfig } from "framer-motion";
import {
  REDUCED_MOTION_QUERY,
  applyReducedMotion,
  osPrefersReducedMotion,
  resolveReducedMotion,
  useReducedMotion,
} from "./motion";

/** A controllable matchMedia stub for the reduced-motion query. */
function stubMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      get matches() {
        return query === REDUCED_MOTION_QUERY && matches;
      },
      media: query,
      addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb),
    })),
  );
  return {
    set(next: boolean) {
      matches = next;
      for (const cb of listeners) cb({ matches: next } as MediaQueryListEvent);
    },
    listenerCount: () => listeners.size,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  applyReducedMotion(false);
});

describe("resolveReducedMotion", () => {
  it("follows the OS when the setting is 'system'", () => {
    expect(resolveReducedMotion("system", true)).toBe(true);
    expect(resolveReducedMotion("system", false)).toBe(false);
  });

  it("always reduces when the setting is 'reduce'", () => {
    expect(resolveReducedMotion("reduce", false)).toBe(true);
    expect(resolveReducedMotion("reduce", true)).toBe(true);
  });

  it("keeps full motion when the setting is 'full', even if the OS asks otherwise", () => {
    expect(resolveReducedMotion("full", true)).toBe(false);
    expect(resolveReducedMotion("full", false)).toBe(false);
  });
});

describe("osPrefersReducedMotion", () => {
  it("is false where matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(osPrefersReducedMotion()).toBe(false);
  });

  it("reads the prefers-reduced-motion media query", () => {
    stubMatchMedia(true);
    expect(osPrefersReducedMotion()).toBe(true);
  });
});

describe("applyReducedMotion", () => {
  it("marks the document root for CSS and makes framer-motion instant", () => {
    applyReducedMotion(true);
    expect(document.documentElement.dataset.rm).toBe("1");
    expect(MotionGlobalConfig.skipAnimations).toBe(true);

    applyReducedMotion(false);
    expect(document.documentElement.dataset.rm).toBe("0");
    expect(MotionGlobalConfig.skipAnimations).toBe(false);
  });
});

describe("useReducedMotion", () => {
  it("applies the resolved preference and reports it", () => {
    stubMatchMedia(false);
    const { result, rerender } = renderHook(({ pref }) => useReducedMotion(pref), {
      initialProps: { pref: "system" as "system" | "reduce" | "full" },
    });
    expect(result.current).toEqual({ reduced: false, osReduced: false });
    expect(document.documentElement.dataset.rm).toBe("0");

    rerender({ pref: "reduce" });
    expect(result.current.reduced).toBe(true);
    expect(document.documentElement.dataset.rm).toBe("1");
  });

  it("reacts live when the OS preference changes", () => {
    const media = stubMatchMedia(false);
    const { result, unmount } = renderHook(() => useReducedMotion("system"));
    expect(result.current.reduced).toBe(false);

    act(() => media.set(true));
    expect(result.current).toEqual({ reduced: true, osReduced: true });
    expect(document.documentElement.dataset.rm).toBe("1");
    expect(MotionGlobalConfig.skipAnimations).toBe(true);

    unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it("lets 'full' override a reduced OS preference", () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion("full"));
    expect(result.current).toEqual({ reduced: false, osReduced: true });
    expect(document.documentElement.dataset.rm).toBe("0");
  });
});

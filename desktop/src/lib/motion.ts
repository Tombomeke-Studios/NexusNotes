import { useEffect, useLayoutEffect, useState } from "react";
import { MotionGlobalConfig } from "framer-motion";

/**
 * Reduced motion: the single source of truth.
 *
 * The in-app setting has three states, like VS Code's `workbench.reduceMotion`:
 * - "system" (default) follows the OS `prefers-reduced-motion` query;
 * - "reduce" always reduces motion;
 * - "full" keeps full motion even when the OS asks for less. This escape hatch
 *   matters on Windows, where turning off "Show animations" also makes
 *   browsers report reduced motion.
 *
 * The resolved value drives both animation systems at once:
 * - CSS: `data-rm="1"` on <html> collapses every transition and keyframe
 *   animation (index.css), including infinite loops;
 * - framer-motion: `MotionGlobalConfig.skipAnimations` makes every JS-driven
 *   animation, enter/exit presence included, jump to its end state.
 */
export type MotionPreference = "system" | "reduce" | "full";

export const MOTION_PREFERENCES: MotionPreference[] = ["system", "reduce", "full"];

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function resolveReducedMotion(pref: MotionPreference, osPrefersReduced: boolean): boolean {
  if (pref === "reduce") return true;
  if (pref === "full") return false;
  return osPrefersReduced;
}

export function osPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function applyReducedMotion(reduced: boolean, root: HTMLElement = document.documentElement): void {
  root.dataset.rm = reduced ? "1" : "0";
  MotionGlobalConfig.skipAnimations = reduced;
}

/** Tracks the OS preference live (the user can flip it while the app runs). */
function useOsPrefersReducedMotion(): boolean {
  const [osReduced, setOsReduced] = useState(osPrefersReducedMotion);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = (e: MediaQueryListEvent) => setOsReduced(e.matches);
    mql.addEventListener("change", onChange);
    setOsReduced(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return osReduced;
}

/**
 * Resolves the preference against the OS, applies it to the document before
 * paint, and reports both values (Settings shows what "system" resolves to).
 */
export function useReducedMotion(pref: MotionPreference): { reduced: boolean; osReduced: boolean } {
  const osReduced = useOsPrefersReducedMotion();
  const reduced = resolveReducedMotion(pref, osReduced);
  useLayoutEffect(() => {
    applyReducedMotion(reduced);
  }, [reduced]);
  return { reduced, osReduced };
}

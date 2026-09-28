/**
 * Shared motion tokens: one rhythm for every animation in the app.
 *
 * framer-motion components take these directly; the CSS side mirrors them as
 * custom properties in index.css (--duration-*, --easing-*, --transition-*),
 * so a hover transition and a dialog spring feel like the same system.
 *
 * Rules the tokens encode (and motion-tokens.test.ts enforces):
 * - durations stay within 120-320 ms;
 * - exits run at about 65% of the entry, so closing feels immediate;
 * - springs settle within 320 ms; only `bounce` visibly overshoots.
 */

export interface SpringConfig {
  type: "spring";
  stiffness: number;
  damping: number;
  mass: number;
}

type CubicBezier = [number, number, number, number];

/** Durations in seconds (framer-motion's unit). */
export const duration = {
  fast: 0.14,
  base: 0.2,
  slow: 0.28,
} as const;

/** Exit duration as a fraction of the matching entry. */
export const EXIT_RATIO = 0.65;

export function exitDuration(enterSeconds: number): number {
  return Math.round(enterSeconds * EXIT_RATIO * 1000) / 1000;
}

/** Cubic-bezier curves; `out` matches the CSS --easing-spring token. */
export const ease = {
  out: [0.22, 1, 0.36, 1] as CubicBezier,
  in: [0.4, 0, 1, 1] as CubicBezier,
};

export const spring = {
  /** UI chrome: dialogs, palette, indicators. Crisp, practically no overshoot. */
  snappy: { type: "spring", stiffness: 520, damping: 38, mass: 1 } as SpringConfig,
  /** Larger surfaces and height changes: critically damped feel. */
  smooth: { type: "spring", stiffness: 400, damping: 38, mass: 1 } as SpringConfig,
  /** Playful confirmations (star pop, toggles): a visible but short overshoot. */
  bounce: { type: "spring", stiffness: 800, damping: 28, mass: 1 } as SpringConfig,
};

/** Damping ratio (zeta) and natural frequency (omega) of a spring. */
function springParams(s: SpringConfig): { zeta: number; omega: number } {
  return {
    zeta: s.damping / (2 * Math.sqrt(s.stiffness * s.mass)),
    omega: Math.sqrt(s.stiffness / s.mass),
  };
}

/** Peak overshoot of a 0 -> 1 step as a fraction (0.1 = 10% past the target). */
export function springOvershoot(s: SpringConfig): number {
  const { zeta } = springParams(s);
  if (zeta >= 1) return 0;
  return Math.exp((-zeta * Math.PI) / Math.sqrt(1 - zeta * zeta));
}

/**
 * Seconds until a 0 -> 1 step stays within 2% of the target, found by
 * simulating the spring (exact enough for tokens, and valid for any damping).
 */
export function springSettleTime(s: SpringConfig): number {
  const dt = 1 / 2000;
  let x = 0;
  let v = 0;
  let lastOutside = 0;
  for (let t = 0; t < 3; t += dt) {
    const a = (-s.stiffness * (x - 1) - s.damping * v) / s.mass;
    v += a * dt;
    x += v * dt;
    if (Math.abs(x - 1) > 0.02) lastOutside = t + dt;
  }
  return Math.round(lastOutside * 1000) / 1000;
}

/**
 * Samples a spring 0 -> 1 step at `steps + 1` evenly spaced points over
 * `seconds`, ending exactly at 1: the stops of a CSS `linear()` easing that
 * reproduces the spring in plain CSS (see --easing-bounce in index.css).
 */
export function sampleSpring(s: SpringConfig, seconds: number, steps: number): number[] {
  const dt = 1 / 4000;
  let x = 0;
  let v = 0;
  let t = 0;
  const points: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const target = (seconds * i) / steps;
    while (t < target - 1e-9) {
      const a = (-s.stiffness * (x - 1) - s.damping * v) / s.mass;
      v += a * dt;
      x += v * dt;
      t += dt;
    }
    points.push(Math.round(x * 1000) / 1000);
  }
  points[points.length - 1] = 1;
  return points;
}

type EnterTransition =
  | (SpringConfig & { opacity?: { duration: number; ease: CubicBezier } })
  | { duration: number; ease: CubicBezier };

/** How long an entry transition takes to visually complete. */
export function enterDuration(t: EnterTransition): number {
  if ("type" in t && t.type === "spring") {
    return Math.max(springSettleTime(t), t.opacity?.duration ?? 0);
  }
  return (t as { duration: number }).duration;
}

interface MotionState {
  opacity: number;
  scale?: number;
  x?: number;
  y?: number;
}

export interface OverlayPreset {
  initial: MotionState;
  animate: MotionState & { transition: EnterTransition };
  exit: MotionState & { transition: { duration: number; ease: CubicBezier } };
}

const springEnter = (s: SpringConfig): EnterTransition => ({
  ...s,
  // Opacity never springs: overshooting past 1 would be clamped and read as a
  // hard stop, so it fades on a short curve alongside the spring.
  opacity: { duration: duration.fast, ease: ease.out },
});

const leave = (enterSeconds: number) => ({ duration: exitDuration(enterSeconds), ease: ease.in });

/**
 * Enter/exit presets for everything that floats above the workspace. Spread a
 * preset onto a motion element: `<motion.div {...overlayMotion.dialog} />`.
 */
export const overlayMotion = {
  /** Dimmed (and optionally blurred) layer behind a dialog or palette. */
  backdrop: {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: duration.base, ease: ease.out } },
    exit: { opacity: 0, transition: leave(duration.base) },
  },
  /** Modal dialogs: scale 0.95 -> 1 with a small rise. */
  dialog: {
    initial: { opacity: 0, scale: 0.95, y: 8 },
    animate: { opacity: 1, scale: 1, y: 0, transition: springEnter(spring.snappy) },
    exit: { opacity: 0, scale: 0.95, y: 4, transition: leave(springSettleTime(spring.snappy)) },
  },
  /** Command palette and global search: a short downward drop. */
  palette: {
    initial: { opacity: 0, scale: 0.98, y: -18 },
    animate: { opacity: 1, scale: 1, y: 0, transition: springEnter(spring.snappy) },
    exit: { opacity: 0, scale: 0.98, y: -10, transition: leave(springSettleTime(spring.snappy)) },
  },
  /** Context menus and anchored popovers: quick, anchored at their origin. */
  popover: {
    initial: { opacity: 0, scale: 0.96, y: -4 },
    animate: { opacity: 1, scale: 1, y: 0, transition: { duration: duration.fast, ease: ease.out } },
    exit: { opacity: 0, scale: 0.98, y: 0, transition: leave(duration.fast) },
  },
} satisfies Record<string, OverlayPreset>;

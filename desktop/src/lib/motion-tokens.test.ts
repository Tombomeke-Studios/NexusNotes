import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXIT_RATIO,
  duration,
  enterDuration,
  exitDuration,
  overlayMotion,
  sampleSpring,
  spring,
  springOvershoot,
  springSettleTime,
} from "./motion-tokens";

describe("motion tokens", () => {
  it("keeps every duration inside the 120-320 ms band", () => {
    for (const [name, value] of Object.entries(duration)) {
      expect(value, name).toBeGreaterThanOrEqual(0.12);
      expect(value, name).toBeLessThanOrEqual(0.32);
    }
  });

  it("derives exits at about 65% of the entry", () => {
    expect(EXIT_RATIO).toBeCloseTo(0.65, 2);
    expect(exitDuration(0.2)).toBeCloseTo(0.13, 3);
    expect(exitDuration(duration.base)).toBeLessThan(duration.base);
  });

  it("settles every spring within 320 ms", () => {
    for (const [name, s] of Object.entries(spring)) {
      expect(springSettleTime(s), name).toBeLessThanOrEqual(0.32);
    }
  });

  it("keeps snappy and smooth nearly overshoot-free and gives bounce a visible pop", () => {
    expect(springOvershoot(spring.snappy)).toBeLessThan(0.05);
    expect(springOvershoot(spring.smooth)).toBeLessThan(0.02);
    expect(springOvershoot(spring.bounce)).toBeGreaterThan(0.08);
    expect(springOvershoot(spring.bounce)).toBeLessThan(0.3);
  });

  it("reports no overshoot for a critically damped spring", () => {
    // stiffness 400 -> omega 20; damping 40 -> zeta 1
    expect(springOvershoot({ type: "spring", stiffness: 400, damping: 40, mass: 1 })).toBe(0);
  });

  describe("CSS mirror (index.css)", () => {
    // Vitest runs from desktop/.
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    const token = (name: string) => css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();

    it("exposes the same durations as custom properties", () => {
      expect(token("duration-fast")).toBe(`${duration.fast * 1000}ms`);
      expect(token("duration-base")).toBe(`${duration.base * 1000}ms`);
      expect(token("duration-slow")).toBe(`${duration.slow * 1000}ms`);
      expect(token("duration-exit")).toBe(`${exitDuration(duration.base) * 1000}ms`);
    });

    it("defines the snappy and smooth transition shorthands", () => {
      expect(token("transition-snappy")).toBe("var(--duration-fast) var(--easing-spring)");
      expect(token("transition-smooth")).toBe("var(--duration-slow) var(--easing-spring)");
    });

    it("samples the bounce spring into --easing-bounce", () => {
      const stops = token("easing-bounce")!.match(/linear\(([^)]+)\)/)![1].split(",").map(Number);
      const seconds = parseInt(token("duration-bounce")!, 10) / 1000;
      expect(seconds).toBeGreaterThanOrEqual(springSettleTime(spring.bounce));
      const expected = sampleSpring(spring.bounce, seconds, stops.length - 1);
      stops.forEach((stop, i) => expect(stop).toBeCloseTo(expected[i], 2));
      expect(Math.max(...stops)).toBeCloseTo(1 + springOvershoot(spring.bounce), 1);
    });
  });

  describe("overlay presets", () => {
    for (const [name, preset] of Object.entries(overlayMotion)) {
      it(`${name}: starts hidden, ends visible and leaves faster than it enters`, () => {
        expect(preset.initial.opacity).toBe(0);
        expect(preset.animate.opacity).toBe(1);
        expect(preset.exit.opacity).toBe(0);

        const enter = enterDuration(preset.animate.transition);
        const exit = preset.exit.transition.duration;
        expect(enter, `${name} enter`).toBeGreaterThanOrEqual(0.12);
        expect(enter, `${name} enter`).toBeLessThanOrEqual(0.32);
        expect(exit, `${name} exit`).toBeLessThanOrEqual(enter * 0.7);
        expect(exit, `${name} exit`).toBeGreaterThanOrEqual(0.07);
      });
    }

    it("only animates transform and opacity", () => {
      const allowed = new Set(["opacity", "scale", "x", "y", "transition", "transformOrigin"]);
      for (const preset of Object.values(overlayMotion)) {
        for (const state of [preset.initial, preset.animate, preset.exit]) {
          for (const key of Object.keys(state)) expect(allowed.has(key), key).toBe(true);
        }
      }
    });

    it("scales dialogs from 0.95 to 1", () => {
      expect(overlayMotion.dialog.initial.scale).toBe(0.95);
      expect(overlayMotion.dialog.animate.scale).toBe(1);
      expect(overlayMotion.dialog.exit.scale).toBe(0.95);
    });

    it("drops the palette down from above", () => {
      expect(overlayMotion.palette.initial.y).toBeLessThan(0);
      expect(overlayMotion.palette.animate.y).toBe(0);
    });
  });
});

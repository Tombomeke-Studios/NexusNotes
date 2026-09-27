import { describe, expect, it } from "vitest";
import {
  EXIT_RATIO,
  duration,
  enterDuration,
  exitDuration,
  overlayMotion,
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

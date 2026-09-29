import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { foldMotion } from "../../lib/motion-tokens";

describe("folder fold (#312)", () => {
  it("leaves clipping to the stylesheet", () => {
    // An inline overflow (set by the animation) would override the CSS below.
    for (const state of [foldMotion.initial, foldMotion.animate, foldMotion.exit]) {
      expect(state).not.toHaveProperty("overflow");
      expect(state).not.toHaveProperty("transitionEnd");
    }
  });

  it("clips folder contents with room for the focus ring of the rows inside", () => {
    const css = readFileSync(resolve(process.cwd(), "src/components/Sidebar/Sidebar.css"), "utf8");
    const rule = css.match(/\.tree-folder-children\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/overflow:\s*clip;/);
    // The ring is 2px wide with a 2px offset: the clip margin must cover both.
    const margin = Number(rule.match(/overflow-clip-margin:\s*(\d+)px/)?.[1] ?? 0);
    expect(margin).toBeGreaterThanOrEqual(4);
  });
});

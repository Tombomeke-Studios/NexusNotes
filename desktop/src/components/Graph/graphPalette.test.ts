import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FOLDER_COLOR_COUNT } from "../../lib/graphLayout";

// Folder colours must be told apart at a glance (#593), also by people with a
// colour-vision deficiency. Distances are CIEDE2000 (ΔE00): ~2 is "just
// noticeable", 10+ reads as a clearly different colour. Colour-blind vision is
// simulated with the Machado, Oliveira & Fernandes (2009) matrices at full
// severity, applied in linear sRGB.

const tokens = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

function token(name: string): string {
  const match = tokens.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`token --${name} not found`);
  return match[1];
}

type RGB = [number, number, number];

const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => {
  const c = Math.min(1, Math.max(0, v));
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
};

const CVD: Record<string, number[][]> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

function simulate(c: RGB, m: number[][]): RGB {
  const l = c.map(toLinear);
  return m.map((row) => fromLinear(row[0] * l[0] + row[1] * l[1] + row[2] * l[2])) as RGB;
}

function lab(c: RGB): RGB {
  const [r, g, b] = c.map(toLinear);
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** CIEDE2000 colour difference (Sharma, Wu & Dalal 2005). */
function deltaE(c1: RGB, c2: RGB): number {
  const [L1, a1, b1] = lab(c1);
  const [L2, a2, b2] = lab(c2);
  const rad = Math.PI / 180;
  const pow7 = (v: number) => v ** 7;
  const Cbar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(pow7(Cbar) / (pow7(Cbar) + pow7(25))));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => {
    if (a === 0 && b === 0) return 0;
    const h = Math.atan2(b, a) / rad;
    return h < 0 ? h + 360 : h;
  };
  const h1 = hue(b1, a1p);
  const h2 = hue(b2, a2p);
  let dh = 0;
  if (C1p * C2p !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dL = L2 - L1;
  const dC = C2p - C1p;
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh / 2) * rad);
  const Lbar = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbar = h1 + h2;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1 - h2) > 180) hbar += hbar < 360 ? 360 : -360;
    hbar /= 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hbar - 30) * rad) +
    0.24 * Math.cos(2 * hbar * rad) +
    0.32 * Math.cos((3 * hbar + 6) * rad) -
    0.2 * Math.cos((4 * hbar - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbar - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(pow7(Cbarp) / (pow7(Cbarp) + pow7(25)));
  const SL = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(2 * dTheta * rad) * RC;
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

function luminance(c: RGB): number {
  const [r, g, b] = c.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The smallest ΔE00 between any two of the first `n` colours. */
function minDistance(colours: RGB[], n: number): { d: number; pair: string } {
  let best = { d: Infinity, pair: "" };
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const d = deltaE(colours[i], colours[j]);
      if (d < best.d) best = { d, pair: `--graph-folder-${i + 1} / --graph-folder-${j + 1}` };
    }
  return best;
}

const palette = Array.from({ length: FOLDER_COLOR_COUNT }, (_, i) => rgb(token(`graph-folder-${i + 1}`)));
const root = rgb(token("graph-root"));

// Slots are handed out in sorted folder order (#593), so a typical vault with
// a handful of folders only ever uses the first few: they get the strictest bar.
const CORE = 6;

describe("graph folder palette (#593)", () => {
  it("defines one colour per slot", () => {
    expect(palette).toHaveLength(FOLDER_COLOR_COUNT);
  });

  it("keeps every pair of folder colours clearly apart", () => {
    const { d, pair } = minDistance(palette, FOLDER_COLOR_COUNT);
    expect(d, pair).toBeGreaterThanOrEqual(10);
  });

  it("keeps folder colours apart from the neutral root colour", () => {
    for (const c of palette) expect(deltaE(c, root)).toBeGreaterThanOrEqual(15);
  });

  for (const [name, matrix] of Object.entries(CVD)) {
    describe(`with ${name}`, () => {
      const seen = palette.map((c) => simulate(c, matrix));

      it(`keeps the first ${CORE} folder colours clearly apart`, () => {
        const { d, pair } = minDistance(seen, CORE);
        expect(d, pair).toBeGreaterThanOrEqual(10);
      });

      it("never lets two folder colours run together", () => {
        const { d, pair } = minDistance(seen, FOLDER_COLOR_COUNT);
        expect(d, pair).toBeGreaterThanOrEqual(6);
      });

      it("keeps folder colours apart from the root colour", () => {
        const r = simulate(root, matrix);
        for (const c of seen) expect(deltaE(c, r)).toBeGreaterThanOrEqual(8);
      });
    });
  }

  // Nodes are meaningful graphics: WCAG 1.4.11 asks for 3:1 against the
  // full graph's background (--bg-base) and the local graph's (--bg-mantle).
  for (const bg of ["bg-base", "bg-mantle"]) {
    it(`gives every node colour 3:1 on --${bg}`, () => {
      for (const c of [...palette, root]) expect(contrast(c, rgb(token(bg)))).toBeGreaterThanOrEqual(3);
    });
  }
});

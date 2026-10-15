import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Graph links are meaningful graphics, so WCAG 1.4.11 asks for 3:1 against the
// background they sit on. The stroke colour and its opacity live in the CSS;
// this test blends them over the panel backgrounds and checks the ratio.

const tokens = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
const graphCss = readFileSync(resolve(process.cwd(), "src/components/Graph/GraphView.css"), "utf8");

function token(name: string): string {
  const match = tokens.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`token --${name} not found`);
  return match[1];
}

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  const match = graphCss.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`rule ${selector} not found`);
  return match[1];
}

function declaration(body: string, prop: string): string | undefined {
  return body.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+);`))?.[1].trim();
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function luminance([r, g, b]: number[]): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(fg: number[], bg: number[]): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

const blend = (fg: number[], bg: number[], alpha: number) => fg.map((v, i) => v * alpha + bg[i] * (1 - alpha));

function strokeColour(value: string): string {
  const name = value.match(/^var\(--([\w-]+)\)$/)?.[1];
  if (!name) throw new Error(`unexpected stroke ${value}`);
  return token(name);
}

const base = rule(".graph-link");
const baseStroke = declaration(base, "stroke")!;
const baseOpacity = Number(declaration(base, "opacity") ?? 1);

// The full graph sits on the editor background, the local graph on the side
// panel; popovers and overlays use the lighter overlay layer.
const backgrounds = ["bg-base", "bg-mantle", "bg-overlay"];

describe("graph link contrast", () => {
  for (const selector of [".graph-link", ".graph-link--ghost"]) {
    for (const bgName of backgrounds) {
      it(`${selector} reaches 3:1 on --${bgName}`, () => {
        const body = rule(selector);
        const stroke = strokeColour(declaration(body, "stroke") ?? baseStroke);
        const opacity = Number(declaration(body, "opacity") ?? baseOpacity);
        const bg = rgb(token(bgName));
        expect(contrast(blend(rgb(stroke), bg, opacity), bg)).toBeGreaterThanOrEqual(3);
      });
    }
  }
});

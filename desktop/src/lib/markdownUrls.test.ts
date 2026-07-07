import { describe, it, expect } from "vitest";
import { wikiUrlTransform } from "./markdownUrls";

describe("wikiUrlTransform", () => {
  it("keeps wikilink protocol URLs intact", () => {
    expect(wikiUrlTransform("wikilink://Some%20Note")).toBe("wikilink://Some%20Note");
    expect(wikiUrlTransform("wikilink://Note#Section")).toBe("wikilink://Note#Section");
  });

  it("keeps standard web URLs", () => {
    expect(wikiUrlTransform("https://example.com/page")).toBe("https://example.com/page");
    expect(wikiUrlTransform("mailto:a@b.c")).toBe("mailto:a@b.c");
  });

  it("still sanitizes dangerous protocols", () => {
    expect(wikiUrlTransform("javascript:alert(1)")).toBe("");
  });
});

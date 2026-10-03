import { describe, it, expect } from "vitest";
import { welcomeNotes, QUICK_START_TITLE } from "./welcome";
import { extractLinks } from "./wikilinks";
import { wordCount } from "./stats";
import { DEFAULT_DAILY_TEMPLATE, TEMPLATES_FOLDER } from "./templates";

const now = new Date(2026, 9, 3, 9, 30);
const seeds = welcomeNotes(now, DEFAULT_DAILY_TEMPLATE);
const titles = new Set(seeds.map((n) => n.title.toLowerCase()));

// The first vault's sample notes (#445, #446, #449).
describe("welcome notes", () => {
  it("include the notes the onboarding promises", () => {
    for (const t of ["Welcome", "Getting Started", "My First Note", "Project Ideas", "Keyboard Shortcuts"]) {
      expect(titles.has(t.toLowerCase())).toBe(true);
    }
  });

  it("only link to each other, so the graph has no dangling links", () => {
    for (const n of seeds) {
      for (const link of extractLinks(n.content)) {
        expect(titles.has(link.toLowerCase()), `${n.title} -> [[${link}]]`).toBe(true);
      }
    }
  });

  it("leave no note unconnected in the graph (templates aside)", () => {
    const linked = new Set<string>();
    for (const n of seeds) {
      const out = extractLinks(n.content).map((l) => l.toLowerCase());
      if (out.length > 0) linked.add(n.title.toLowerCase());
      for (const l of out) linked.add(l);
    }
    for (const n of seeds.filter((s) => s.path !== TEMPLATES_FOLDER)) {
      expect(linked.has(n.title.toLowerCase()), n.title).toBe(true);
    }
  });

  it("link Project Ideas and My First Note back to Welcome", () => {
    for (const t of ["Project Ideas", "My First Note"]) {
      const note = seeds.find((n) => n.title === t)!;
      expect(extractLinks(note.content)).toContain("Welcome");
    }
  });

  it("keep the quick-start guide readable in under two minutes", () => {
    const guide = seeds.find((n) => n.title === QUICK_START_TITLE)!;
    expect(wordCount(guide.content)).toBeLessThan(400);
  });

  it("seed a template for Ctrl+T and today's daily note from the daily template", () => {
    expect(seeds.some((n) => n.path === TEMPLATES_FOLDER)).toBe(true);
    const daily = seeds.find((n) => n.path === "Daily")!;
    expect(daily.title).toBe("2026-10-03");
    expect(daily.content.startsWith("# 2026-10-03")).toBe(true);
  });
});

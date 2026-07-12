import { describe, it, expect } from "vitest";
import { renderTemplate, templateVars, listTemplates, DEFAULT_DAILY_TEMPLATE } from "./templates";
import type { Note } from "./types";

const note = (id: string, title: string, path: string): Note => ({
  id,
  vault_id: "v1",
  path,
  title,
  content: "",
  checksum: "",
  created_at: "",
  updated_at: "",
});

describe("renderTemplate", () => {
  const vars = { date: "2026-07-12", time: "14:05", title: "My Note" };

  it("substitutes all three variables, repeatedly", () => {
    expect(renderTemplate("# {{title}}\n{{date}} {{time}} / {{date}}", vars)).toBe(
      "# My Note\n2026-07-12 14:05 / 2026-07-12",
    );
  });

  it("tolerates whitespace inside the braces", () => {
    expect(renderTemplate("{{ date }} and {{  title }}", vars)).toBe("2026-07-12 and My Note");
  });

  it("leaves unknown variables and stray braces untouched", () => {
    expect(renderTemplate("{{author}} {date} {{}}", vars)).toBe("{{author}} {date} {{}}");
  });

  it("renders the default daily template with the date", () => {
    const out = renderTemplate(DEFAULT_DAILY_TEMPLATE, vars);
    expect(out).toContain("# 2026-07-12");
    expect(out).toContain("#daily");
    expect(out).not.toContain("{{");
  });
});

describe("templateVars", () => {
  it("formats date as ISO and time as HH:MM, zero-padded", () => {
    const vars = templateVars(new Date(2026, 0, 5, 9, 7), "T");
    expect(vars).toEqual({ date: "2026-01-05", time: "09:07", title: "T" });
  });
});

describe("listTemplates", () => {
  const notes = [
    note("1", "Meeting", "Templates"),
    note("2", "book review", "templates/Reading"),
    note("3", "Regular note", ""),
    note("4", "Not a template", "Templates Extra"),
  ];

  it("finds notes in the Templates folder and subfolders, case-insensitively, sorted", () => {
    expect(listTemplates(notes).map((n) => n.id)).toEqual(["2", "1"]);
  });

  it("returns empty when the folder does not exist", () => {
    expect(listTemplates([note("1", "A", "Work")])).toEqual([]);
  });
});

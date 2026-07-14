import { describe, it, expect } from "vitest";
import { renameTagInContent, normalizeTag, contentHasTag } from "./tagRename";
import { extractTags } from "./tags";

describe("normalizeTag", () => {
  it("strips #, lowercases, trims stray slashes", () => {
    expect(normalizeTag("#Work")).toBe("work");
    expect(normalizeTag("/work/")).toBe("work");
    expect(normalizeTag("  #Work/Projects  ")).toBe("work/projects");
  });
});

describe("renameTagInContent", () => {
  it("renames a simple inline tag without touching similar prefixes", () => {
    const out = renameTagInContent("I like #work but not #workaholic or work.", "work", "job");
    expect(out).toBe("I like #job but not #workaholic or work.");
  });

  it("cascades to nested child tags", () => {
    const out = renameTagInContent("#work and #work/projects and #work/projects/x", "work", "job");
    expect(out).toBe("#job and #job/projects and #job/projects/x");
  });

  it("renames only the matched prefix segment, not a coincidental substring", () => {
    const out = renameTagInContent("#homework #work", "work", "job");
    expect(out).toBe("#homework #job");
  });

  it("is case-insensitive both ways (tags are stored lowercased)", () => {
    expect(renameTagInContent("#Work here", "work", "Job")).toBe("#job here");
  });

  it("updates front-matter tag entries (list and array forms)", () => {
    const list = "---\ntags:\n  - work\n  - personal\n---\n# Body #work";
    expect(renameTagInContent(list, "work", "job")).toBe(
      "---\ntags:\n  - job\n  - personal\n---\n# Body #job",
    );
    const arr = "---\ntags: [work, personal]\n---\nbody";
    expect(renameTagInContent(arr, "work", "job")).toBe("---\ntags: [job, personal]\n---\nbody");
  });

  it("leaves content unchanged when the tag is absent or names are equal", () => {
    expect(renameTagInContent("nothing here", "work", "job")).toBe("nothing here");
    expect(renameTagInContent("#work", "work", "work")).toBe("#work");
  });

  it("produces content whose extracted tags reflect the rename", () => {
    const before = "---\ntags: [work]\n---\n#work/projects notes";
    const after = renameTagInContent(before, "work", "job");
    expect(extractTags(after).sort()).toEqual(["job", "job/projects"]);
  });
});

describe("contentHasTag", () => {
  it("matches the tag and its descendants", () => {
    expect(contentHasTag(["work/projects"], "work")).toBe(true);
    expect(contentHasTag(["work"], "work")).toBe(true);
    expect(contentHasTag(["homework"], "work")).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { extractTags } from "./tags";

describe("extractTags", () => {
  it("extracts inline #tags", () => {
    expect(extractTags("note with #work and #project")).toEqual(["work", "project"]);
  });

  it("ignores tags inside code blocks and inline code", () => {
    expect(extractTags("```\n#include <stdio.h>\n```\nand `#nope` here")).toEqual([]);
  });

  it("includes front-matter tags from an inline list", () => {
    const content = "---\ntags: [frontend, design]\n---\n\nNote body";
    expect(extractTags(content)).toEqual(["frontend", "design"]);
  });

  it("includes front-matter tags from a dash list", () => {
    const content = "---\ntags:\n  - alpha\n  - beta\n---\nbody";
    expect(extractTags(content)).toEqual(["alpha", "beta"]);
  });

  it("merges front-matter and inline tags with front-matter first and dedupes", () => {
    const content = "---\ntags: [fromfm, shared]\n---\n\nBody with #inlinetag and #shared";
    expect(extractTags(content)).toEqual(["fromfm", "shared", "inlinetag"]);
  });

  it("lowercases tags from both sources", () => {
    const content = "---\ntags: [MixedCase]\n---\n\n#UPPER";
    expect(extractTags(content)).toEqual(["mixedcase", "upper"]);
  });

  it("returns only inline tags when no front-matter exists", () => {
    expect(extractTags("plain #solo note")).toEqual(["solo"]);
  });
});

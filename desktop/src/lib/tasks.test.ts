import { describe, it, expect } from "vitest";
import { toggleTask } from "./tasks";

const CONTENT = `# Log

- [x] Read paper
- [ ] Expand note
- [ ] Ship it

Some text.
`;

describe("toggleTask", () => {
  it("checks an unchecked task by document order index", () => {
    const next = toggleTask(CONTENT, 1);
    expect(next).toContain("- [x] Expand note");
    expect(next).toContain("- [x] Read paper");
    expect(next).toContain("- [ ] Ship it");
  });

  it("unchecks a checked task", () => {
    const next = toggleTask(CONTENT, 0);
    expect(next).toContain("- [ ] Read paper");
  });

  it("returns content unchanged for an out-of-range index", () => {
    expect(toggleTask(CONTENT, 99)).toBe(CONTENT);
  });

  it("supports asterisk list markers", () => {
    const next = toggleTask("* [ ] star task", 0);
    expect(next).toBe("* [x] star task");
  });
});

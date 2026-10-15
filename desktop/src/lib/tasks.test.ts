import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
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

describe("toggleTask follows GFM task items (#560)", () => {
  it("ignores `- [ ]` in the middle of a line", () => {
    const content = "Write - [ ] like this\n- [ ] real";
    expect(toggleTask(content, 0)).toBe("Write - [ ] like this\n- [x] real");
  });

  it("skips tasks inside fenced code", () => {
    const content = "```md\n- [ ] example\n```\n~~~\n* [x] also code\n~~~\n- [ ] real";
    expect(toggleTask(content, 0)).toBe(content.replace("- [ ] real", "- [x] real"));
    expect(toggleTask(content, 1)).toBe(content);
  });

  it("accepts [X], plus markers and ordered lists", () => {
    expect(toggleTask("- [X] done", 0)).toBe("- [ ] done");
    expect(toggleTask("+ [ ] plus", 0)).toBe("+ [x] plus");
    expect(toggleTask("1. [ ] first\n2) [ ] second", 1)).toBe("1. [ ] first\n2) [x] second");
  });

  it("handles nested and quoted tasks and inline code after the box", () => {
    const content = "- [ ] parent\n  - [ ] child\n> - [ ] quoted\n- [ ] `code` task";
    expect(toggleTask(content, 1)).toBe(content.replace("  - [ ] child", "  - [x] child"));
    expect(toggleTask(content, 2)).toBe(content.replace("> - [ ] quoted", "> - [x] quoted"));
    expect(toggleTask(content, 3)).toBe(content.replace("- [ ] `code`", "- [x] `code`"));
  });

  it("does not count a box without text or without a space after it", () => {
    const content = "- [ ]\n- [x]done\n- [ ] real";
    expect(toggleTask(content, 0)).toBe("- [ ]\n- [x]done\n- [x] real");
  });

  it("keeps Windows line endings", () => {
    expect(toggleTask("- [ ] a\r\n- [ ] b\r\n", 1)).toBe("- [ ] a\r\n- [x] b\r\n");
  });

  it("toggles the line of each checkbox the preview renders, in order", () => {
    const content = [
      "# Plan",
      "Inline - [ ] is text",
      "```",
      "- [ ] code",
      "```",
      "- [ ] one",
      "  * [X] two",
      "",
      "3. [ ] three",
      "",
      "> + [ ] four",
      "",
      "- [ ] `five`",
      "",
      "- [ ]",
      "- [x]six",
    ].join("\n");
    // remark-gfm is the parser the preview renders with.
    const tree = unified().use(remarkParse).use(remarkGfm).parse(content) as MdNode;
    const taskLines: number[] = [];
    visit(tree, (node) => {
      if (node.type === "listItem" && typeof node.checked === "boolean") taskLines.push(node.position!.start.line - 1);
    });
    expect(taskLines).toHaveLength(5);
    const before = content.split("\n");
    taskLines.forEach((line, index) => {
      const after = toggleTask(content, index).split("\n");
      const changed = after.flatMap((l, n) => (l === before[n] ? [] : [n]));
      expect(changed).toEqual([line]);
    });
    expect(toggleTask(content, taskLines.length)).toBe(content);
  });
});

type MdNode = { type: string; checked?: boolean | null; position?: { start: { line: number } }; children?: MdNode[] };

function visit(node: MdNode, fn: (n: MdNode) => void) {
  fn(node);
  for (const child of node.children ?? []) visit(child, fn);
}

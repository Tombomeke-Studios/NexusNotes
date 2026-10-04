import { describe, it, expect } from "vitest";
import { highlightMarkdown, MAX_HIGHLIGHT_CHARS } from "./mdHighlight";

const flat = (text: string) => highlightMarkdown(text)!.map((line) => line.map((s) => `${s.cls ?? "-"}:${s.text}`));

describe("highlightMarkdown (#267)", () => {
  it("keeps every character, in order", () => {
    const text = "# Title\n\nSome **bold** and _it_ `code` [[Link]] #tag [x](http://y)\n> quote\n- [ ] task";
    const lines = highlightMarkdown(text)!;
    expect(lines.map((l) => l.map((s) => s.text).join("")).join("\n")).toBe(text);
  });

  it("marks headings, emphasis, code, links and tags", () => {
    expect(flat("# Title")).toEqual([["md-heading:# Title"]]);
    const [line] = flat("a **b** _c_ `d` [[E]] #f [g](h)");
    expect(line).toEqual([
      "-:a ", "md-strong:**b**", "-: ", "md-em:_c_", "-: ", "md-code:`d`", "-: ",
      "md-wikilink:[[E]]", "-: ", "md-tag:#f", "-: ", "md-link:[g](h)",
    ]);
  });

  it("marks quotes, list markers, tasks and fenced code", () => {
    expect(flat("> said")).toEqual([["md-quote:> said"]]);
    expect(flat("- item")[0]).toEqual(["md-list:- ", "-:item"]);
    expect(flat("- [x] done")[0]).toEqual(["md-list:- ", "md-task:[x]", "-: done"]);
    expect(flat("```js\nconst a = '**not bold**';\n```")).toEqual([
      ["md-fence:```js"],
      ["md-codeblock:const a = '**not bold**';"],
      ["md-fence:```"],
    ]);
  });

  it("does not mistake a heading-less hash or an email for a tag", () => {
    expect(flat("issue #12 and a@b.c")[0]).toEqual(["-:issue #12 and a@b.c"]);
  });

  it("gives up on huge notes so typing stays fast", () => {
    expect(highlightMarkdown("x".repeat(MAX_HIGHLIGHT_CHARS + 1))).toBeNull();
  });
});

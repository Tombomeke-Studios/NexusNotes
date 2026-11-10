import { describe, it, expect } from "vitest";
import {
  INDENT,
  applyEdit,
  continueList,
  editForKey,
  inCodeFence,
  indentLines,
  insertLink,
  toggleWrap,
  type KeyPress,
  type TextEdit,
} from "./editorKeys";

/** Text with the selection marked: "|" for a caret, "[" … "]" for a range. */
function parse(marked: string): { text: string; start: number; end: number } {
  const caret = marked.indexOf("|");
  if (caret >= 0) return { text: marked.replace("|", ""), start: caret, end: caret };
  const start = marked.indexOf("«");
  const end = marked.indexOf("»") - 1;
  return { text: marked.replace("«", "").replace("»", ""), start, end };
}

/** The marked text after the edit, or null when the key is left alone. */
function show(text: string, edit: TextEdit | null): string | null {
  if (!edit) return null;
  const next = applyEdit(text, edit);
  if (edit.selStart === edit.selEnd) return next.slice(0, edit.selStart) + "|" + next.slice(edit.selStart);
  return next.slice(0, edit.selStart) + "«" + next.slice(edit.selStart, edit.selEnd) + "»" + next.slice(edit.selEnd);
}

const enter = (marked: string) => {
  const { text, start, end } = parse(marked);
  return show(text, continueList(text, start, end));
};
const tab = (marked: string, outdent = false) => {
  const { text, start, end } = parse(marked);
  return show(text, indentLines(text, start, end, outdent));
};

describe("continueList — Enter", () => {
  it("starts the next bullet with the same marker and indentation", () => {
    expect(enter("- one|")).toBe("- one\n- |");
    expect(enter("  * one|\nafter")).toBe("  * one\n  * |\nafter");
    expect(enter("+ one|")).toBe("+ one\n+ |");
  });

  it("counts numbered items up and keeps their delimiter", () => {
    expect(enter("1. one|")).toBe("1. one\n2. |");
    expect(enter("9) nine|")).toBe("9) nine\n10) |");
  });

  it("starts the next task unticked", () => {
    expect(enter("- [x] done|")).toBe("- [x] done\n- [ ] |");
    expect(enter("1. [ ] todo|")).toBe("1. [ ] todo\n2. [ ] |");
  });

  it("continues a quote, and a list inside one", () => {
    expect(enter("> said|")).toBe("> said\n> |");
    expect(enter("> - item|")).toBe("> - item\n> - |");
  });

  it("splits an item at the caret", () => {
    expect(enter("- one| two")).toBe("- one\n- | two");
  });

  it("ends the list on an empty item by removing the marker", () => {
    expect(enter("- one\n- |")).toBe("- one\n|");
    expect(enter("- [ ] |")).toBe("|");
    expect(enter("> |")).toBe("|");
  });

  it("replaces a selection inside an item", () => {
    expect(enter("- one «two» three")).toBe("- one \n- | three");
  });

  it("leaves Enter alone outside lists, in the marker, and in code blocks", () => {
    expect(enter("plain|")).toBeNull();
    expect(enter("-| one")).toBeNull();
    expect(enter("**bold** text|")).toBeNull();
    expect(enter("---|")).toBeNull();
    expect(enter("```\n- code|\n```")).toBeNull();
  });
});

describe("inCodeFence", () => {
  it("knows open, closed and tilde fences", () => {
    const text = "a\n```js\nx\n```\nb\n~~~\ny";
    expect(inCodeFence(text, text.indexOf("x"))).toBe(true);
    expect(inCodeFence(text, text.indexOf("b"))).toBe(false);
    expect(inCodeFence(text, text.indexOf("y"))).toBe(true);
    expect(inCodeFence(text, 0)).toBe(false);
  });
});

describe("indentLines — Tab and Shift+Tab", () => {
  it("nests the list item the caret is in", () => {
    expect(tab("- one\n- tw|o")).toBe(`- one\n${INDENT}- tw|o`);
  });

  it("inserts an indent at the caret in ordinary text and in code", () => {
    expect(tab("word|")).toBe(`word${INDENT}|`);
    expect(tab("```\n- x|\n```")).toBe(`\`\`\`\n- x${INDENT}|\n\`\`\``);
  });

  it("indents every selected line, skipping blank ones", () => {
    expect(tab("«a\n\nb»\nc")).toBe(`«${INDENT}a\n\n${INDENT}b»\nc`);
  });

  it("does not take the line after a selection that ends at a line break", () => {
    expect(tab("«a\n»b")).toBe(`«${INDENT}a»\nb`);
  });

  it("outdents by one level, a tab, or whatever spaces there are", () => {
    expect(tab(`${INDENT}${INDENT}- x|`, true)).toBe(`${INDENT}- x|`);
    expect(tab("\t- x|", true)).toBe("- x|");
    expect(tab("  - x|", true)).toBe("- x|");
  });

  it("keeps the caret on its line when outdenting from inside the indentation", () => {
    expect(tab("a\n  |  b", true)).toBe("a\n|b");
  });

  it("outdents every selected line", () => {
    expect(tab(`«${INDENT}a\n  b\nc»`, true)).toBe("«a\nb\nc»");
  });

  it("leaves Shift+Tab alone when there is nothing to outdent", () => {
    expect(tab("a|", true)).toBeNull();
    expect(tab("«a\nb»", true)).toBeNull();
  });
});

describe("toggleWrap — Ctrl+I", () => {
  const italic = (marked: string) => {
    const { text, start, end } = parse(marked);
    return show(text, toggleWrap(text, start, end, "*"));
  };

  it("wraps the selection and keeps it selected", () => {
    expect(italic("a «word» b")).toBe("a *«word»* b");
  });

  it("puts the caret between the markers when nothing is selected", () => {
    expect(italic("a | b")).toBe("a *|* b");
  });

  it("unwraps a selection that has the markers inside or around it", () => {
    expect(italic("a «*word*» b")).toBe("a «word» b");
    expect(italic("a *«word»* b")).toBe("a «word» b");
  });

  const bold = (marked: string) => {
    const { text, start, end } = parse(marked);
    return show(text, toggleWrap(text, start, end, "**"));
  };

  it("makes the selection bold with two stars, and plain again", () => {
    expect(bold("«x»")).toBe("**«x»**");
    expect(bold("**«x»**")).toBe("«x»");
    expect(bold("«**x**»")).toBe("«x»");
    expect(bold("a | b")).toBe("a **|** b");
  });

  it("tells bold and italic apart", () => {
    // Italic on bold text adds to it rather than taking a star off.
    expect(italic("**«x»**")).toBe("***«x»***");
    expect(italic("***«x»***")).toBe("**«x»**");
    expect(bold("*«x»*")).toBe("***«x»***");
    expect(bold("***«x»***")).toBe("*«x»*");
    expect(italic("«**x**»")).toBe("*«**x**»*");
  });
});

describe("insertLink — Ctrl+K", () => {
  const link = (marked: string) => {
    const { text, start, end } = parse(marked);
    return show(text, insertLink(text, start, end));
  };

  it("makes the selected words the link text, caret in the target", () => {
    expect(link("see «the docs» now")).toBe("see [the docs](|) now");
    expect(link("|")).toBe("[](|)");
  });

  it("makes a selected address the target, caret in the text", () => {
    expect(link("«https://example.com/a»")).toBe("[|](https://example.com/a)");
  });
});

describe("editForKey", () => {
  const press = (key: string, extra: Partial<KeyPress> = {}): KeyPress => ({
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...extra,
  });

  it("maps the keys to their edits", () => {
    expect(editForKey(press("Enter"), "- a", 3, 3)?.insert).toBe("\n- ");
    expect(editForKey(press("Tab"), "a", 1, 1)?.insert).toBe(INDENT);
    expect(editForKey(press("Tab", { shiftKey: true }), "  a", 3, 3)?.insert).toBe("a");
    expect(editForKey(press("b", { ctrlKey: true }), "a", 0, 1)?.insert).toBe("**a**");
    expect(editForKey(press("i", { ctrlKey: true }), "a", 0, 1)?.insert).toBe("*a*");
    expect(editForKey(press("I", { metaKey: true }), "a", 0, 1)?.insert).toBe("*a*");
    expect(editForKey(press("k", { ctrlKey: true }), "a", 0, 1)?.insert).toBe("[a]()");
  });

  it("leaves Shift+Enter, Ctrl+Enter, Alt combinations and other keys alone", () => {
    expect(editForKey(press("Enter", { shiftKey: true }), "- a", 3, 3)).toBeNull();
    expect(editForKey(press("Enter", { ctrlKey: true }), "- a", 3, 3)).toBeNull();
    expect(editForKey(press("i", { ctrlKey: true, altKey: true }), "a", 0, 1)).toBeNull();
    expect(editForKey(press("i", { ctrlKey: true, shiftKey: true }), "a", 0, 1)).toBeNull();
    // Ctrl+Shift+B is the sidebar toggle.
    expect(editForKey(press("B", { ctrlKey: true, shiftKey: true }), "a", 0, 1)).toBeNull();
    expect(editForKey(press("x"), "a", 0, 1)).toBeNull();
  });

  it("lets Tab move the focus right after Esc", () => {
    expect(editForKey(press("Tab"), "a", 1, 1, true)).toBeNull();
  });
});

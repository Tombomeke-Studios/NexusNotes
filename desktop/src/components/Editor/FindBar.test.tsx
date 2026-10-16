import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, waitFor, act } from "@testing-library/react";
import type { ComponentProps } from "react";
import { Editor } from "./Editor";
import type { Note } from "../../lib/types";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  attachments: { list: vi.fn().mockResolvedValue([]) },
}));

const note = (content: string) => ({ id: "n1", vault_id: "v1", title: "Note", path: "", content, checksum: "c1" }) as Note;

function setup(content = "The cat sat.\nA cat ran.\nNo dog, one cat.", extra: Partial<ComponentProps<typeof Editor>> = {}) {
  const onSave = vi.fn();
  const onLiveChange = vi.fn();
  const onModeChange = vi.fn();
  const view = render(
    <Editor
      note={note(content)}
      notes={[]}
      mode="edit"
      onModeChange={onModeChange}
      onSave={onSave}
      onLiveChange={onLiveChange}
      onRename={() => {}}
      onRenameCommit={() => {}}
      onCreateNote={() => {}}
      onNavigateToNote={() => {}}
      {...extra}
    />,
  );
  const textarea = () => view.container.querySelector(".editor-textarea") as HTMLTextAreaElement;
  const find = () => view.queryByRole("textbox", { name: "Find" }) as HTMLInputElement | null;
  const replace = () => view.getByRole("textbox", { name: "Replace with" }) as HTMLInputElement;
  const count = () => view.container.querySelector(".find-bar-count")?.textContent;
  const marks = () => Array.from(view.container.querySelectorAll(".editor-highlight .find-match"));
  const ctrlF = () => fireEvent.keyDown(window, { key: "f", ctrlKey: true });
  return { view, textarea, find, replace, count, marks, ctrlF, onSave, onLiveChange, onModeChange };
}

afterEach(() => {
  vi.useRealTimers();
  // jsdom has no execCommand; some tests install one.
  delete (document as { execCommand?: unknown }).execCommand;
});

describe("Find bar (#547)", () => {
  it("opens on Ctrl+F with focus in the search field", () => {
    const { find, ctrlF } = setup();
    expect(find()).toBeNull();
    const notCancelled = ctrlF();
    expect(notCancelled).toBe(false); // the browser's own find stays shut
    expect(find()).not.toBeNull();
    expect(document.activeElement).toBe(find());
  });

  it("counts and highlights the matches, emphasising the current one", () => {
    const { find, count, marks, ctrlF, view } = setup();
    ctrlF();
    fireEvent.change(find()!, { target: { value: "cat" } });
    expect(count()).toBe("1 of 3");
    expect(marks()).toHaveLength(3);
    const current = view.container.querySelectorAll(".editor-highlight .find-match--current");
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toBe("cat");
  });

  it("says when nothing matches", () => {
    const { find, count, marks, ctrlF } = setup();
    ctrlF();
    fireEvent.change(find()!, { target: { value: "zebra" } });
    expect(count()).toBe("No results");
    expect(marks()).toHaveLength(0);
  });

  it("goes to the next match on Enter and back on Shift+Enter, selecting it in the textarea", async () => {
    const { find, count, ctrlF, textarea } = setup();
    ctrlF();
    fireEvent.change(find()!, { target: { value: "cat" } });
    fireEvent.keyDown(find()!, { key: "Enter" });
    expect(count()).toBe("2 of 3");
    await waitFor(() => expect([textarea().selectionStart, textarea().selectionEnd]).toEqual([15, 18]));
    fireEvent.keyDown(find()!, { key: "Enter" });
    fireEvent.keyDown(find()!, { key: "Enter" });
    expect(count()).toBe("1 of 3"); // wraps around
    fireEvent.keyDown(find()!, { key: "Enter", shiftKey: true });
    expect(count()).toBe("3 of 3");
    await waitFor(() => expect(textarea().selectionStart).toBe(36));
  });

  it("matches case only when Aa is on", () => {
    const { find, count, ctrlF, view } = setup("Cat cat CAT");
    ctrlF();
    fireEvent.change(find()!, { target: { value: "cat" } });
    expect(count()).toBe("1 of 3");
    fireEvent.click(view.getByRole("button", { name: "Match case" }));
    expect(count()).toBe("1 of 1");
  });

  it("closes on Esc and gives focus back to the editor", () => {
    const { find, ctrlF, textarea, marks } = setup();
    ctrlF();
    fireEvent.change(find()!, { target: { value: "cat" } });
    fireEvent.keyDown(find()!, { key: "Escape" });
    expect(find()).toBeNull();
    expect(marks()).toHaveLength(0);
    expect(document.activeElement).toBe(textarea());
  });

  it("starts from the selected text", () => {
    const { find, ctrlF, textarea, count } = setup();
    textarea().setSelectionRange(15, 18);
    ctrlF();
    expect(find()!.value).toBe("cat");
    expect(count()).toBe("2 of 3");
  });

  it("switches the reading view to split so there is text to search", () => {
    const { ctrlF, onModeChange, find } = setup(undefined, { mode: "preview" });
    ctrlF();
    expect(onModeChange).toHaveBeenCalledWith("split");
    expect(find()).not.toBeNull();
  });

  it("does nothing without an open note", () => {
    const view = render(
      <Editor
        note={null}
        notes={[]}
        mode="edit"
        onModeChange={() => {}}
        onSave={() => {}}
        onRename={() => {}}
        onRenameCommit={() => {}}
        onCreateNote={() => {}}
        onNavigateToNote={() => {}}
      />,
    );
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(view.queryByRole("search")).toBeNull();
  });

  it("leaves Ctrl+Shift+F (global search) alone", () => {
    const { find } = setup();
    const notCancelled = fireEvent.keyDown(window, { key: "F", ctrlKey: true, shiftKey: true });
    expect(notCancelled).toBe(true);
    expect(find()).toBeNull();
  });

  it("still counts and jumps on a note too large to highlight", async () => {
    const big = "word ".repeat(40_000) + "needle and needle";
    const { find, count, ctrlF, textarea, view } = setup(big);
    expect(view.container.querySelector(".editor-highlight")).toBeNull();
    ctrlF();
    fireEvent.change(find()!, { target: { value: "needle" } });
    expect(count()).toBe("1 of 2");
    fireEvent.keyDown(find()!, { key: "Enter" });
    expect(count()).toBe("2 of 2");
    await waitFor(() => expect(textarea().selectionStart).toBe(200_011));
    expect(document.activeElement).toBe(find()); // focus came back to the bar
  });
});

describe("Replace (#547)", () => {
  /** A stand-in for the browser's insertText/delete: edits the focused textarea and fires input. */
  function installExecCommand() {
    const calls: Array<[string, string, number, number]> = [];
    (document as { execCommand?: unknown }).execCommand = vi.fn((cmd: string, _ui: boolean, value = "") => {
      const ta = document.activeElement as HTMLTextAreaElement;
      calls.push([cmd, value, ta.selectionStart, ta.selectionEnd]);
      ta.setRangeText(cmd === "delete" ? "" : value, ta.selectionStart, ta.selectionEnd, "end");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    });
    return calls;
  }

  it("replaces the current match through the browser's undoable insert, and moves on", () => {
    const calls = installExecCommand();
    const { find, replace, ctrlF, textarea, count, view, onLiveChange } = setup();
    ctrlF();
    fireEvent.change(find()!, { target: { value: "cat" } });
    fireEvent.change(replace(), { target: { value: "lion" } });
    fireEvent.click(view.getByRole("button", { name: "Replace" }));
    expect(calls).toEqual([["insertText", "lion", 4, 7]]);
    expect(textarea().value).toBe("The lion sat.\nA cat ran.\nNo dog, one cat.");
    expect(onLiveChange).toHaveBeenLastCalledWith("The lion sat.\nA cat ran.\nNo dog, one cat.");
    expect(count()).toBe("1 of 2"); // the next cat
  });

  it("replaces all matches in one undoable edit and autosaves it", () => {
    vi.useFakeTimers();
    const calls = installExecCommand();
    const { find, replace, ctrlF, textarea, count, view, onSave } = setup();
    ctrlF();
    fireEvent.change(find()!, { target: { value: "cat" } });
    fireEvent.change(replace(), { target: { value: "dog" } });
    fireEvent.click(view.getByRole("button", { name: "Replace all" }));
    // One insert over the range from the first to the last match: one undo step.
    expect(calls).toEqual([["insertText", "dog sat.\nA dog ran.\nNo dog, one dog", 4, 39]]);
    expect(textarea().value).toBe("The dog sat.\nA dog ran.\nNo dog, one dog.");
    expect(count()).toBe("Replaced 3");
    act(() => vi.advanceTimersByTime(1500));
    expect(onSave).toHaveBeenLastCalledWith("The dog sat.\nA dog ran.\nNo dog, one dog.");
  });

  it("deletes the matches when the replacement is empty", () => {
    const calls = installExecCommand();
    const { find, ctrlF, textarea, view } = setup("a-b-c");
    ctrlF();
    fireEvent.change(find()!, { target: { value: "-" } });
    fireEvent.click(view.getByRole("button", { name: "Replace all" }));
    // The range between the first and last match keeps its "b".
    expect(calls).toEqual([["insertText", "b", 1, 4]]);
    expect(textarea().value).toBe("abc");
    fireEvent.change(find()!, { target: { value: "b" } });
    fireEvent.click(view.getByRole("button", { name: "Replace" }));
    expect(calls[1]).toEqual(["delete", "", 1, 2]);
    expect(textarea().value).toBe("ac");
  });

  it("falls back to setting the text when the browser cannot insert", () => {
    const { find, replace, ctrlF, textarea, view, onLiveChange } = setup();
    ctrlF();
    fireEvent.change(find()!, { target: { value: "cat" } });
    fireEvent.change(replace(), { target: { value: "dog" } });
    fireEvent.click(view.getByRole("button", { name: "Replace all" }));
    expect(textarea().value).toBe("The dog sat.\nA dog ran.\nNo dog, one dog.");
    expect(onLiveChange).toHaveBeenLastCalledWith("The dog sat.\nA dog ran.\nNo dog, one dog.");
  });

  it("cannot replace in a read-only editor", () => {
    const { find, ctrlF, view } = setup(undefined, { readOnly: true });
    ctrlF();
    fireEvent.change(find()!, { target: { value: "cat" } });
    expect(view.getByRole("button", { name: "Replace" })).toBeDisabled();
    expect(view.getByRole("button", { name: "Replace all" })).toBeDisabled();
  });
});

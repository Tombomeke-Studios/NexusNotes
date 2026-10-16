import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import type { ComponentProps } from "react";
import { Editor } from "./Editor";
import type { Note } from "../../lib/types";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  attachments: { list: vi.fn().mockResolvedValue([]) },
}));

const mk = (id: string, title: string, path = "", content = "", updated = "2026-01-01T00:00:00Z") =>
  ({ id, vault_id: "v1", title, path, content, checksum: "c", created_at: updated, updated_at: updated }) as Note;

const NOTES = [
  mk("open", "Open note"),
  mk("a", "Planning", "Work", "", "2026-01-02T00:00:00Z"),
  mk("b", "Plan", "", "# Goals\n## Risks", "2026-01-01T00:00:00Z"),
  mk("c", "Groceries", "Home", "", "2026-01-04T00:00:00Z"),
];

function setup(extra: Partial<ComponentProps<typeof Editor>> = {}) {
  const onLiveChange = vi.fn();
  const view = render(
    <Editor
      note={NOTES[0]}
      notes={NOTES}
      mode="edit"
      onModeChange={() => {}}
      onSave={() => {}}
      onLiveChange={onLiveChange}
      onRename={() => {}}
      onRenameCommit={() => {}}
      onCreateNote={() => {}}
      onNavigateToNote={() => {}}
      {...extra}
    />,
  );
  const textarea = () => view.container.querySelector(".editor-textarea") as HTMLTextAreaElement;
  /** Types: the textarea ends up holding `value` with the caret at its end. */
  const type = (value: string) => {
    textarea().focus();
    fireEvent.input(textarea(), { target: { value } });
  };
  const list = () => document.querySelector('[role="listbox"]');
  const labels = () => Array.from(document.querySelectorAll('[role="option"] .link-suggest-label')).map((e) => e.textContent);
  const selected = () => document.querySelector('[role="option"][aria-selected="true"] .link-suggest-label')?.textContent;
  const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(textarea(), { key: k, ...init });
  return { view, textarea, type, list, labels, selected, key, onLiveChange };
}

/** A stand-in for the browser's undoable insert (jsdom has no execCommand). */
function installExecCommand() {
  const calls: Array<[string, string]> = [];
  (document as { execCommand?: unknown }).execCommand = vi.fn((cmd: string, _ui: boolean, value = "") => {
    const ta = document.activeElement as HTMLTextAreaElement;
    calls.push([cmd, value]);
    ta.setRangeText(value, ta.selectionStart, ta.selectionEnd, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  });
  return calls;
}

afterEach(() => {
  delete (document as { execCommand?: unknown }).execCommand;
});

describe("Link autocomplete (#548)", () => {
  it("opens on [[ with the most recently edited notes, minus the open one", () => {
    const { type, list, labels, textarea } = setup();
    expect(list()).toBeNull();
    type("See [[");
    expect(list()).not.toBeNull();
    expect(labels()).toEqual(["Groceries", "Planning", "Plan"]);
    // Folder hints, dimmed next to the title.
    const hints = Array.from(document.querySelectorAll(".link-suggest-hint")).map((e) => e.textContent);
    expect(hints).toEqual(["Home", "Work"]);
    // Focus stays in the textarea, which points at the highlighted option.
    expect(document.activeElement).toBe(textarea());
    const active = textarea().getAttribute("aria-activedescendant");
    expect(active).toBeTruthy();
    expect(document.getElementById(active!)?.getAttribute("aria-selected")).toBe("true");
    expect(textarea().getAttribute("aria-controls")).toBe(list()!.id);
  });

  it("filters on the typed fragment, exact and prefix matches first", () => {
    const { type, labels } = setup();
    type("[[pla");
    expect(labels()).toEqual(["Plan", "Planning"]);
  });

  it("moves with the arrow keys and inserts the pick on Enter as an undoable edit", () => {
    const calls = installExecCommand();
    const { type, key, selected, textarea, list, onLiveChange } = setup();
    type("See [[pla");
    expect(selected()).toBe("Plan");
    key("ArrowDown");
    expect(selected()).toBe("Planning");
    key("ArrowUp");
    key("ArrowUp"); // wraps around
    expect(selected()).toBe("Planning");
    const notCancelled = key("Enter");
    expect(notCancelled).toBe(false); // no newline typed
    expect(calls).toEqual([["insertText", "[[Planning]]"]]);
    expect(textarea().value).toBe("See [[Planning]]");
    expect(textarea().selectionStart).toBe("See [[Planning]]".length);
    expect(onLiveChange).toHaveBeenLastCalledWith("See [[Planning]]");
    expect(list()).toBeNull();
  });

  it("inserts on Tab too, setting the text when the browser cannot insert it", () => {
    const { type, key, textarea, list } = setup();
    type("[[gro");
    const notCancelled = key("Tab");
    expect(notCancelled).toBe(false); // focus stays in the editor
    expect(textarea().value).toBe("[[Groceries]]");
    expect(list()).toBeNull();
  });

  it("inserts the clicked result", () => {
    installExecCommand();
    const { type, textarea, list } = setup();
    type("x [[");
    const option = Array.from(document.querySelectorAll('[role="option"]')).find((o) => o.textContent?.includes("Plan") && !o.textContent.includes("Planning"))!;
    const down = fireEvent.mouseDown(option);
    expect(down).toBe(false); // the caret stays in the textarea
    fireEvent.click(option);
    expect(textarea().value).toBe("x [[Plan]]");
    expect(list()).toBeNull();
  });

  it("offers to create a link when nothing matches", () => {
    installExecCommand();
    const { type, key, labels, textarea } = setup();
    type("[[Brand new");
    expect(labels()).toEqual(["Create link to 'Brand new'"]);
    key("Enter");
    expect(textarea().value).toBe("[[Brand new]]");
  });

  it("closes on Esc without letting the key through, and stays closed in that link", () => {
    const { type, key, list } = setup();
    const outside = vi.fn();
    window.addEventListener("keydown", outside);
    type("[[pl");
    key("Escape");
    expect(list()).toBeNull();
    expect(outside).not.toHaveBeenCalled();
    type("[[pla");
    expect(list()).toBeNull();
    // A new link opens it again.
    type("[[pla and [[");
    expect(list()).not.toBeNull();
    window.removeEventListener("keydown", outside);
  });

  it("closes when ]] is typed", () => {
    const { type, list } = setup();
    type("[[Plan");
    expect(list()).not.toBeNull();
    type("[[Plan]");
    expect(list()).toBeNull();
    type("[[Plan]]");
    expect(list()).toBeNull();
  });

  it("closes when the caret moves out of the link, and does not open by moving in", () => {
    const { type, list, textarea } = setup();
    type("Hello [[pl");
    expect(list()).not.toBeNull();
    act(() => textarea().setSelectionRange(2, 2));
    fireEvent.keyUp(textarea(), { key: "ArrowLeft" });
    expect(list()).toBeNull();
    act(() => textarea().setSelectionRange(10, 10));
    fireEvent.mouseUp(textarea());
    expect(list()).toBeNull();
  });

  it("closes when the textarea loses focus", () => {
    const { type, list, textarea } = setup();
    type("[[pl");
    fireEvent.blur(textarea());
    expect(list()).toBeNull();
  });

  it("leaves other keys alone while closed", () => {
    const { type, key } = setup();
    type("plain text");
    expect(key("Enter")).toBe(true);
    expect(key("ArrowDown")).toBe(true);
  });

  it("lists a note's headings after #", () => {
    installExecCommand();
    const { type, labels, key, textarea } = setup();
    type("[[Plan#");
    expect(labels()).toEqual(["Goals", "Risks"]);
    key("ArrowDown");
    key("Enter");
    expect(textarea().value).toBe("[[Plan#Risks]]");
  });

  it("does not open while the editor is read-only", () => {
    const { type, list } = setup({ readOnly: true });
    type("[[");
    expect(list()).toBeNull();
  });
});

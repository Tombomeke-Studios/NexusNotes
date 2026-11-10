import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { Editor } from "./Editor";
import { INDENT } from "../../lib/editorKeys";
import type { Note } from "../../lib/types";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  attachments: { list: vi.fn().mockResolvedValue([]) },
}));

function setup(content: string, extra: Partial<ComponentProps<typeof Editor>> = {}) {
  const onLiveChange = vi.fn();
  const onSave = vi.fn();
  const note = { id: "n1", vault_id: "v1", title: "Note", path: "", content, checksum: "c1" } as Note;
  const view = render(
    <Editor
      note={note}
      notes={[note]}
      mode="edit"
      onModeChange={() => {}}
      onSave={onSave}
      onLiveChange={onLiveChange}
      onRename={() => {}}
      onRenameCommit={() => {}}
      onCreateNote={() => {}}
      onNavigateToNote={() => {}}
      {...extra}
    />,
  );
  const textarea = view.container.querySelector(".editor-textarea") as HTMLTextAreaElement;
  /** Presses a key with the caret at the end; true when the editor took the key. */
  const press = (key: string, init: KeyboardEventInit = {}, at = textarea.value.length) => {
    textarea.focus();
    textarea.setSelectionRange(at, at);
    return !fireEvent.keyDown(textarea, { key, ...init });
  };
  return { textarea, press, onLiveChange, onSave };
}

describe("Editor — typing basics (#571)", () => {
  it("continues a list on Enter and reports it like typing", () => {
    const { textarea, press, onLiveChange } = setup("- one");
    expect(press("Enter")).toBe(true);
    expect(textarea.value).toBe("- one\n- ");
    expect(onLiveChange).toHaveBeenLastCalledWith("- one\n- ");
    expect(textarea.selectionStart).toBe(textarea.value.length);
  });

  it("leaves Enter to the browser in ordinary text", () => {
    const { textarea, press, onLiveChange } = setup("plain");
    expect(press("Enter")).toBe(false);
    expect(textarea.value).toBe("plain");
    expect(onLiveChange).not.toHaveBeenCalled();
  });

  it("indents with Tab and outdents with Shift+Tab instead of leaving the editor", () => {
    const { textarea, press } = setup("- one");
    expect(press("Tab")).toBe(true);
    expect(textarea.value).toBe(`${INDENT}- one`);
    expect(press("Tab", { shiftKey: true })).toBe(true);
    expect(textarea.value).toBe("- one");
  });

  it("lets Tab move the focus right after Esc, once", () => {
    const { textarea, press } = setup("- one");
    press("Escape");
    expect(press("Tab")).toBe(false);
    expect(textarea.value).toBe("- one");
    expect(press("Tab")).toBe(true);
  });

  it("formats with Ctrl+I and Ctrl+K", async () => {
    const { textarea, press } = setup("word");
    textarea.setSelectionRange(0, 4);
    expect(fireEvent.keyDown(textarea, { key: "i", ctrlKey: true })).toBe(false);
    expect(textarea.value).toBe("*word*");
    // Without the browser's own edit command (jsdom) the selection follows the render.
    await waitFor(() => expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([1, 5]));
    expect(press("k", { ctrlKey: true })).toBe(true);
    expect(textarea.value).toBe("*word*[]()");
  });

  it("changes nothing while the note is read-only", () => {
    const { textarea, press } = setup("- one", { readOnly: true });
    expect(press("Enter")).toBe(false);
    expect(press("Tab")).toBe(false);
    expect(textarea.value).toBe("- one");
  });

  it("saves on Ctrl+S with Caps Lock on", () => {
    const { textarea, onSave } = setup("text");
    fireEvent.keyDown(textarea, { key: "S", ctrlKey: true });
    expect(onSave).toHaveBeenCalledWith("text");
  });
});

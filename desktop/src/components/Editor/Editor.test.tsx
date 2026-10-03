import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import type { ComponentProps } from "react";
import { Editor } from "./Editor";
import type { Note } from "../../lib/types";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  attachments: { list: vi.fn().mockResolvedValue([]) },
}));

const note = (id: string, content: string) =>
  ({ id, vault_id: "v1", title: "Note", path: "", content, checksum: "c1" }) as Note;

function setup() {
  const onSave = vi.fn();
  const onLiveChange = vi.fn();
  const props: ComponentProps<typeof Editor> = {
    note: note("n1", "old text"),
    notes: [],
    mode: "edit",
    onModeChange: () => {},
    onSave,
    onLiveChange,
    onRename: () => {},
    onRenameCommit: () => {},
    onCreateNote: () => {},
    onNavigateToNote: () => {},
  };
  const view = render(<Editor {...props} />);
  const textarea = () => view.container.querySelector(".editor-textarea") as HTMLTextAreaElement;
  const rerender = (extra: Partial<ComponentProps<typeof Editor>>) => view.rerender(<Editor {...props} {...extra} />);
  return { onSave, onLiveChange, textarea, rerender };
}

describe("Editor — replacing the open note's text (#324)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows replacement text for the open note", () => {
    const { textarea, rerender, onLiveChange } = setup();
    expect(textarea().value).toBe("old text");
    rerender({ replaceRequest: { noteId: "n1", text: "their text", nonce: 1 } });
    expect(textarea().value).toBe("their text");
    // The caller already holds this text; it is not reported back as an edit.
    expect(onLiveChange).not.toHaveBeenCalled();
  });

  it("drops a pending autosave of the text it replaces", () => {
    const { textarea, rerender, onSave } = setup();
    fireEvent.change(textarea(), { target: { value: "old text, edited" } });
    rerender({ replaceRequest: { noteId: "n1", text: "their text", nonce: 1 } });
    act(() => vi.advanceTimersByTime(2000));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("ignores a replacement meant for another note", () => {
    const { textarea, rerender } = setup();
    rerender({ replaceRequest: { noteId: "n2", text: "other note", nonce: 1 } });
    expect(textarea().value).toBe("old text");
  });

  it("applies each request once", () => {
    const { textarea, rerender } = setup();
    const request = { noteId: "n1", text: "their text", nonce: 1 };
    rerender({ replaceRequest: request });
    fireEvent.change(textarea(), { target: { value: "typed after" } });
    rerender({ replaceRequest: request, fontSize: 15 });
    expect(textarea().value).toBe("typed after");
  });

  it("reports a replacement it applied", () => {
    const onReplaceApplied = vi.fn();
    const { textarea, rerender } = setup();
    const request = { noteId: "n1", text: "their text", nonce: 1, expected: "old text" };
    rerender({ replaceRequest: request, onReplaceApplied });
    expect(textarea().value).toBe("their text");
    expect(onReplaceApplied).toHaveBeenCalledWith(request);
  });

  it("keeps text typed after the replacement was requested, and reports that instead", () => {
    const onReplaceApplied = vi.fn();
    const onReplaceRejected = vi.fn();
    const { textarea, rerender } = setup();
    // A keystroke lands between the request and the moment it is applied.
    fireEvent.change(textarea(), { target: { value: "old text!" } });
    const request = { noteId: "n1", text: "their text", nonce: 1, expected: "old text" };
    rerender({ replaceRequest: request, onReplaceApplied, onReplaceRejected });
    expect(textarea().value).toBe("old text!");
    expect(onReplaceRejected).toHaveBeenCalledWith(request);
    expect(onReplaceApplied).not.toHaveBeenCalled();
  });

  it("starts from the app's text for the note, unsaved edits included", () => {
    // E.g. back from the graph view to a note whose edits aren't saved yet:
    // the note object still holds the last saved text.
    const { container } = render(
      <Editor
        note={note("n1", "saved text")}
        initialText="saved text, and unsaved edits"
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
    expect((container.querySelector(".editor-textarea") as HTMLTextAreaElement).value).toBe(
      "saved text, and unsaved edits",
    );
  });

  it("reports a replacement for a note it no longer shows as rejected", () => {
    const onReplaceRejected = vi.fn();
    const { textarea, rerender } = setup();
    const request = { noteId: "n-other", text: "other note", nonce: 1, expected: "x" };
    rerender({ replaceRequest: request, onReplaceRejected });
    expect(textarea().value).toBe("old text");
    expect(onReplaceRejected).toHaveBeenCalledWith(request);
  });

  it("tells the caller while it is on screen", () => {
    const onPresenceChange = vi.fn();
    const view = render(
      <Editor
        note={note("n1", "text")}
        notes={[]}
        mode="edit"
        onModeChange={() => {}}
        onSave={() => {}}
        onRename={() => {}}
        onRenameCommit={() => {}}
        onCreateNote={() => {}}
        onNavigateToNote={() => {}}
        onPresenceChange={onPresenceChange}
      />,
    );
    expect(onPresenceChange).toHaveBeenLastCalledWith(true);
    view.unmount();
    expect(onPresenceChange).toHaveBeenLastCalledWith(false);
  });

  it("does not apply an earlier request again when it mounts", () => {
    // E.g. after the graph view: the note's own content is current by now.
    const onReplaceApplied = vi.fn();
    const { container } = render(
      <Editor
        note={note("n1", "saved later")}
        notes={[]}
        mode="edit"
        onModeChange={() => {}}
        onSave={() => {}}
        onRename={() => {}}
        onRenameCommit={() => {}}
        onCreateNote={() => {}}
        onNavigateToNote={() => {}}
        replaceRequest={{ noteId: "n1", text: "stale remote text", nonce: 3 }}
        onReplaceApplied={onReplaceApplied}
      />,
    );
    expect((container.querySelector(".editor-textarea") as HTMLTextAreaElement).value).toBe("saved later");
    expect(onReplaceApplied).not.toHaveBeenCalled();
  });
});

describe("Editor — heading anchors in the preview (#426)", () => {
  it("scrolls to the heading a #link names instead of opening a tab", () => {
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      const view = render(
        <Editor
          note={note("n1", "[jump](#second-part)\n\n# First\n\n## Second Part\n")}
          notes={[]}
          mode="preview"
          onModeChange={() => {}}
          onSave={() => {}}
          onLiveChange={() => {}}
          onRename={() => {}}
          onRenameCommit={() => {}}
          onCreateNote={() => {}}
          onNavigateToNote={() => {}}
        />,
      );
      const link = view.getByText("jump").closest("a") as HTMLAnchorElement;
      expect(link.getAttribute("target")).toBeNull();
      const notCancelled = fireEvent.click(link);
      expect(notCancelled).toBe(false);
      expect(scrolled.map((el) => el.textContent)).toEqual(["Second Part"]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});

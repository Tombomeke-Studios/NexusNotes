import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Toggle } from "./Settings";
import { Editor } from "../Editor/Editor";
import type { Note } from "../../lib/types";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  attachments: { list: vi.fn().mockResolvedValue([]) },
}));

describe("Settings toggle", () => {
  it("is a named switch that says whether it is on", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<Toggle label="Check spelling" on={false} onToggle={onToggle} />);
    const toggle = screen.getByRole("switch", { name: "Check spelling" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledOnce();
    rerender(<Toggle label="Check spelling" on onToggle={onToggle} />);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });
});

describe("Editor — spell check (#572)", () => {
  const note = { id: "n1", vault_id: "v1", title: "Note", path: "", content: "text", checksum: "c" } as Note;
  const editor = (spellCheck?: boolean) => (
    <Editor
      note={note}
      notes={[note]}
      mode="edit"
      spellCheck={spellCheck}
      onModeChange={() => {}}
      onSave={() => {}}
      onRename={() => {}}
      onRenameCommit={() => {}}
      onCreateNote={() => {}}
      onNavigateToNote={() => {}}
    />
  );

  it("is off unless the preference turns it on", () => {
    const { container, rerender } = render(editor());
    const textarea = container.querySelector(".editor-textarea") as HTMLTextAreaElement;
    expect(textarea.getAttribute("spellcheck")).toBe("false");
    rerender(editor(true));
    expect(textarea.getAttribute("spellcheck")).toBe("true");
  });
});

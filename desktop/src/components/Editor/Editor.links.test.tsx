import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { Editor } from "./Editor";
import { attachments } from "../../lib/api";
import type { Attachment } from "../../lib/api";
import type { Note } from "../../lib/types";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  attachments: { list: vi.fn().mockResolvedValue([]), objectUrl: vi.fn().mockResolvedValue("blob:x") },
}));
vi.mock("../../lib/export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/export")>()),
  startDownload: vi.fn(),
}));
import { startDownload } from "../../lib/export";

const note = (id: string, title: string, content: string) =>
  ({ id, vault_id: "v1", title, path: "", content, checksum: "c1" }) as Note;

const TEXT = "# Plan\n\nintro\n\n## Open questions\n\nbody\n\n## Open questions\n\nsecond";
const other = note("n2", "Roadmap", "# Roadmap\n\n## Later\n\ntext");

function setup(content: string, extra: Partial<ComponentProps<typeof Editor>> = {}) {
  const onNavigateToNote = vi.fn();
  const onCreateNote = vi.fn();
  const onHeadingHandled = vi.fn();
  const open = note("n1", "Plan", content);
  const props: ComponentProps<typeof Editor> = {
    note: open,
    notes: [open, other],
    mode: "preview",
    vault: { id: "v1", encryption: "none" },
    onModeChange: () => {},
    onSave: () => {},
    onRename: () => {},
    onRenameCommit: () => {},
    onCreateNote,
    onNavigateToNote,
    onHeadingHandled,
    ...extra,
  };
  const view = render(<Editor {...props} />);
  const rerender = (more: Partial<ComponentProps<typeof Editor>>) => view.rerender(<Editor {...props} {...more} />);
  return { view, rerender, onNavigateToNote, onCreateNote, onHeadingHandled };
}

beforeEach(() => {
  vi.mocked(attachments.list).mockResolvedValue([]);
  vi.mocked(startDownload).mockClear();
});

describe("Editor — links to a section (#558)", () => {
  it("opens the note at the section a [[Note#Section]] link names", () => {
    const { onNavigateToNote } = setup("see [[Roadmap#Later]] and [[Roadmap]]");
    fireEvent.click(screen.getByRole("button", { name: "Open Roadmap, section Later" }));
    expect(onNavigateToNote).toHaveBeenLastCalledWith("n2", "Later");
    fireEvent.click(screen.getByRole("button", { name: "Open Roadmap" }));
    expect(onNavigateToNote).toHaveBeenLastCalledWith("n2", undefined);
  });

  it("shows which section a link goes to", () => {
    setup("see [[Roadmap#Later]]");
    expect(screen.getByRole("button", { name: "Open Roadmap, section Later" }).textContent).toBe("Roadmap › Later");
  });

  it("scrolls to a heading of the same note for [[#Section]], without leaving the note", () => {
    const { view, onNavigateToNote, onCreateNote } = setup(`[[#open questions]]\n\n${TEXT}`);
    const preview = view.container.querySelector(".editor-preview") as HTMLElement;
    const scrollTo = vi.fn();
    preview.scrollTo = scrollTo as unknown as typeof preview.scrollTo;
    fireEvent.click(screen.getByRole("button", { name: "Go to open questions" }));
    expect(scrollTo).toHaveBeenCalledOnce();
    expect(onNavigateToNote).not.toHaveBeenCalled();
    expect(onCreateNote).not.toHaveBeenCalled();
  });
});

describe("Editor — going to a heading on request (#558)", () => {
  it("puts the caret on the heading's line when only the source is shown", async () => {
    const { view, rerender, onHeadingHandled } = setup(TEXT, { mode: "edit" });
    const request = { noteId: "n1", section: "Open questions", nonce: 1 };
    rerender({ mode: "edit", headingRequest: request });
    const textarea = view.container.querySelector(".editor-textarea") as HTMLTextAreaElement;
    await waitFor(() => expect(onHeadingHandled).toHaveBeenCalledWith(request, true));
    expect(textarea.selectionStart).toBe(TEXT.indexOf("## Open questions"));
    expect(document.activeElement).toBe(textarea);
  });

  it("goes to the heading the outline names by its position, also the second of two alike", async () => {
    const { view, rerender, onHeadingHandled } = setup(TEXT, { mode: "split" });
    const preview = view.container.querySelector(".editor-preview") as HTMLElement;
    const second = preview.querySelectorAll("h2")[1];
    let scrolledFrom: Element | null = null;
    const rect = (top: number) => ({ top }) as DOMRect;
    preview.getBoundingClientRect = () => rect(0);
    second.getBoundingClientRect = () => {
      scrolledFrom = second;
      return rect(400);
    };
    const scrollTo = vi.fn();
    preview.scrollTo = scrollTo as unknown as typeof preview.scrollTo;
    const offset = TEXT.lastIndexOf("## Open questions");
    rerender({ mode: "split", headingRequest: { noteId: "n1", offset, nonce: 1 } });
    await waitFor(() => expect(onHeadingHandled).toHaveBeenCalled());
    expect(scrolledFrom).toBe(second);
    expect(scrollTo).toHaveBeenCalledWith({ top: 386 });
    // The source pane follows, but focus stays where it was.
    const textarea = view.container.querySelector(".editor-textarea") as HTMLTextAreaElement;
    expect(textarea.selectionStart).toBe(offset);
    expect(document.activeElement).not.toBe(textarea);
  });

  it("reports a section the note doesn't have", async () => {
    const { rerender, onHeadingHandled } = setup(TEXT);
    const request = { noteId: "n1", section: "Nope", nonce: 1 };
    rerender({ headingRequest: request });
    await waitFor(() => expect(onHeadingHandled).toHaveBeenCalledWith(request, false));
  });

  it("waits for the note the request is for, and handles each request once", async () => {
    const { rerender, onHeadingHandled } = setup(TEXT);
    const request = { noteId: "n2", section: "Later", nonce: 1 };
    rerender({ headingRequest: request });
    expect(onHeadingHandled).not.toHaveBeenCalled();
    rerender({ headingRequest: request, note: other });
    await waitFor(() => expect(onHeadingHandled).toHaveBeenCalledWith(request, true));
    rerender({ headingRequest: request, note: other, mode: "split" });
    expect(onHeadingHandled).toHaveBeenCalledOnce();
  });
});

describe("Editor — links to an attached file (#566)", () => {
  const file: Attachment = {
    id: "a1",
    note_id: "n1",
    filename: "Report.pdf",
    mime_type: "application/pdf",
    size_bytes: 10,
    created_at: "",
  } as Attachment;

  it("saves the file instead of offering to create a note", async () => {
    vi.mocked(attachments.list).mockResolvedValue([file]);
    const { onCreateNote } = setup("the [[report.pdf|quarterly report]]");
    const link = await screen.findByRole("button", { name: /quarterly report/ });
    expect(link.className).toBe("attachment-file");
    fireEvent.click(link);
    await waitFor(() => expect(startDownload).toHaveBeenCalledWith("blob:x", "Report.pdf"));
    expect(onCreateNote).not.toHaveBeenCalled();
  });

  it("marks a file that is not attached, and never creates a note named after it", () => {
    const { view, onCreateNote } = setup("the [[gone.pdf]]");
    const missing = view.container.querySelector(".attachment-missing") as HTMLElement;
    expect(missing.textContent).toContain("gone.pdf");
    expect(missing.title).toBe("gone.pdf is not attached to this note");
    expect(view.container.querySelector(".wikilink--unresolved")).toBeNull();
    expect(onCreateNote).not.toHaveBeenCalled();
  });

  it("still links a note whose title looks like a file name", () => {
    const { onNavigateToNote } = setup("[[notes.txt]]", {
      notes: [note("n1", "Plan", ""), note("n3", "notes.txt", "")],
    });
    fireEvent.click(screen.getByRole("button", { name: "Open notes.txt" }));
    expect(onNavigateToNote).toHaveBeenCalledWith("n3", undefined);
  });
});

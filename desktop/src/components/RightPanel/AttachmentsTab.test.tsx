import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const list = vi.fn();
const upload = vi.fn();
const remove = vi.fn();
const objectUrl = vi.fn();
const listeners = new Set<(id: string) => void>();
vi.mock("../../lib/attachmentClient", () => ({
  listAttachments: (...a: unknown[]) => list(...a),
  uploadAttachment: (...a: unknown[]) => upload(...a),
  removeAttachment: (...a: unknown[]) => remove(...a),
  attachmentObjectUrl: (...a: unknown[]) => objectUrl(...a),
  onAttachmentsChanged: (l: (id: string) => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
}));

import { AttachmentsTab } from "./AttachmentsTab";

const att = (id: string, filename: string, mime = "image/png", size = 2048) => ({
  id, note_id: "n1", vault_id: "v1", filename, mime_type: mime, size_bytes: size, created_at: "",
});
const vault = { id: "v1", encryption: "none" as const };

beforeEach(() => {
  vi.resetAllMocks();
  listeners.clear();
});

describe("AttachmentsTab (#238)", () => {
  it("lists the note's files with type and size", async () => {
    list.mockResolvedValue([att("a1", "photo.png"), att("a2", "report.pdf", "application/pdf", 3 * 1024 * 1024)]);
    render(<AttachmentsTab noteId="n1" vault={vault} canWrite />);
    expect(await screen.findByText("photo.png")).toBeTruthy();
    expect(screen.getByText(/png · 2 KB/)).toBeTruthy();
    expect(screen.getByText(/pdf · 3.0 MB/)).toBeTruthy();
  });

  it("shows an empty state", async () => {
    list.mockResolvedValue([]);
    render(<AttachmentsTab noteId="n1" vault={vault} canWrite />);
    expect(await screen.findByText(/No files attached/)).toBeTruthy();
  });

  it("reloads when the editor adds a file", async () => {
    list.mockResolvedValueOnce([]).mockResolvedValueOnce([att("a1", "new.png")]);
    render(<AttachmentsTab noteId="n1" vault={vault} canWrite />);
    await screen.findByText(/No files attached/);
    for (const l of listeners) l("n1");
    expect(await screen.findByText("new.png")).toBeTruthy();
  });

  it("deletes a file after confirming", async () => {
    list.mockResolvedValue([att("a1", "photo.png")]);
    remove.mockResolvedValue(undefined);
    render(<AttachmentsTab noteId="n1" vault={vault} canWrite />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete photo.png" }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" })));
  });

  it("offers no upload or delete without write access", async () => {
    list.mockResolvedValue([att("a1", "photo.png")]);
    render(<AttachmentsTab noteId="n1" vault={vault} canWrite={false} />);
    await screen.findByText("photo.png");
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Upload/ })).toBeNull();
  });
});

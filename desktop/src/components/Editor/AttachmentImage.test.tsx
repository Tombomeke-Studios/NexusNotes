import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { Attachment } from "../../lib/api";

const objectUrl = vi.fn<(id: string) => Promise<string>>();

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, attachments: { ...actual.attachments, objectUrl: (id: string) => objectUrl(id) } };
});

const { AttachmentImage } = await import("./AttachmentImage");

function att(filename: string, mime_type: string): Attachment {
  return {
    id: `id-${filename}`,
    note_id: "n1",
    vault_id: "v1",
    filename,
    mime_type,
    size_bytes: 10,
    created_at: "2026-01-01T00:00:00Z",
  };
}

describe("AttachmentImage", () => {
  const originalRevoke = URL.revokeObjectURL;

  beforeEach(() => {
    objectUrl.mockReset();
    objectUrl.mockResolvedValue("blob:app/1");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    cleanup();
    URL.revokeObjectURL = originalRevoke;
    vi.restoreAllMocks();
  });

  it("shows a raster image inline from an authenticated blob URL", async () => {
    render(<AttachmentImage name="cat.png" alt="" list={[att("cat.png", "image/png")]} />);

    const img = await screen.findByRole("img");
    expect(img.getAttribute("src")).toBe("blob:app/1");
    expect(objectUrl).toHaveBeenCalledWith("id-cat.png");
  });

  it("renders an SVG embed as a download link, never as an image", () => {
    // image/svg+xml is what an older server still reports for a stored SVG.
    render(<AttachmentImage name="evil.svg" alt="" list={[att("evil.svg", "image/svg+xml")]} />);

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("button", { name: /evil\.svg/ })).toBeTruthy();
    expect(objectUrl).not.toHaveBeenCalled();
  });

  it("renders any non-raster embed (opaque bytes, pdf) as a download link", () => {
    for (const [name, type] of [["evil.svg", "application/octet-stream"], ["doc.pdf", "application/pdf"]]) {
      render(<AttachmentImage name={name} alt="" list={[att(name, type)]} />);
      expect(screen.queryByRole("img")).toBeNull();
      expect(screen.getByRole("button", { name: new RegExp(name.replace(".", "\\.")) })).toBeTruthy();
      cleanup();
    }
  });

  it("downloads the file when the link is clicked", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<AttachmentImage name="evil.svg" alt="" list={[att("evil.svg", "application/octet-stream")]} />);

    fireEvent.click(screen.getByRole("button", { name: /evil\.svg/ }));

    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.getAttribute("href")).toBe("blob:app/1");
    expect(anchor.download).toBe("evil.svg");
    expect(objectUrl).toHaveBeenCalledWith("id-evil.svg");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:app/1");
  });

  it("falls back to the download link when the image cannot be decoded", async () => {
    render(<AttachmentImage name="fake.png" alt="" list={[att("fake.png", "image/png")]} />);

    fireEvent.error(await screen.findByRole("img"));

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("button", { name: /fake\.png/ })).toBeTruthy();
  });

  it("still marks an embed with no matching attachment as missing", () => {
    render(<AttachmentImage name="gone.png" alt="" list={[]} />);

    expect(screen.getByText(/gone\.png/).className).toBe("attachment-missing");
  });
});

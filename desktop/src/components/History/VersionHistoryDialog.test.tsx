import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { VersionHistoryDialog } from "./VersionHistoryDialog";
import type { Note, NoteVersionInfo } from "../../lib/types";

const now = new Date();
const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();

const note: Note = {
  id: "n1", vault_id: "v1", title: "Plan", path: "", content: "line one\nline two\nline three",
  checksum: "c-current", created_at: at(100), updated_at: at(1),
};
const versions: NoteVersionInfo[] = [
  { id: "v3", note_id: "n1", checksum: "c-current", device_id: "me", created_at: at(3), updated_at: at(1) },
  { id: "v2", note_id: "n1", checksum: "c-2", device_id: "phone", created_at: at(40), updated_at: at(38) },
  { id: "v1", note_id: "n1", checksum: "c-1", device_id: "", created_at: at(90), updated_at: at(90) },
];
const texts: Record<string, string> = {
  v3: "line one\nline two\nline three",
  v2: "line one\nold two\nline three",
  v1: "line one",
};

function setup(overrides: Partial<ComponentProps<typeof VersionHistoryDialog>> = {}) {
  const onRestore = vi.fn(async () => null);
  const onClose = vi.fn();
  const loadText = vi.fn(async (_vault: unknown, _noteId: string, id: string) => texts[id]);
  render(
    <VersionHistoryDialog
      note={note}
      vault={{ id: "v1", encryption: "none" }}
      currentText={note.content}
      canWrite
      thisDeviceId="me"
      deviceNames={new Map([["phone", "Phone"]])}
      onRestore={onRestore}
      onClose={onClose}
      listVersions={async () => versions}
      loadText={loadText}
      {...overrides}
    />,
  );
  return { onRestore, onClose, loadText };
}

const restoreButton = () => screen.getByRole("button", { name: "Restore this version" }) as HTMLButtonElement;

describe("VersionHistoryDialog", () => {
  it("lists versions with their device and marks the current one", async () => {
    setup();
    const list = await screen.findByRole("listbox", { name: "Versions" });
    const options = within(list).getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options[0].textContent).toContain("This device");
    expect(options[0].textContent).toContain("Current");
    expect(options[1].textContent).toContain("Phone");
    expect(options[2].textContent).toContain("Unknown device");
  });

  it("opens on the newest version that differs from the current text and shows the diff", async () => {
    setup();
    const list = await screen.findByRole("listbox", { name: "Versions" });
    await waitFor(() => expect(within(list).getByRole("option", { selected: true }).textContent).toContain("Phone"));
    const table = await screen.findByRole("table", { name: "Differences" });
    expect(within(table).getByText("old two").closest("td")?.getAttribute("data-changed")).toBe("mine");
    expect(within(table).getByText("line two").closest("td")?.getAttribute("data-changed")).toBe("theirs");
    expect(screen.getByText(/1 line only in this version/)).toBeTruthy();
  });

  it("switches to an inline diff", async () => {
    setup();
    await screen.findByRole("table", { name: "Differences" });
    fireEvent.click(screen.getByRole("button", { name: "Inline" }));
    const inline = screen.getByRole("list", { name: "Differences" });
    expect(within(inline).getByText("old two").closest("li")?.getAttribute("data-changed")).toBe("mine");
  });

  it("compares two versions with each other", async () => {
    setup();
    await screen.findByRole("table", { name: "Differences" });
    fireEvent.change(screen.getByLabelText("Compare with"), { target: { value: "v1" } });
    const table = await screen.findByRole("table", { name: "Differences" });
    await waitFor(() => expect(within(table).queryByText("old two")).toBeTruthy());
    expect(screen.getByText(/2 lines only in this version/)).toBeTruthy();
  });

  it("restores the selected version", async () => {
    const { onRestore, onClose } = setup();
    await screen.findByRole("table", { name: "Differences" });
    fireEvent.click(restoreButton());
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith("v2"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("keeps the dialog open with the reason when the restore fails", async () => {
    const { onClose } = setup({ onRestore: vi.fn(async () => "The note changed on another device.") });
    await screen.findByRole("table", { name: "Differences" });
    fireEvent.click(restoreButton());
    expect((await screen.findByRole("alert")).textContent).toContain("The note changed on another device.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("cannot restore the current text or without write access", async () => {
    setup({ canWrite: false });
    await screen.findByRole("table", { name: "Differences" });
    expect(restoreButton().disabled).toBe(true);
  });

  it("says when a version matches the current text", async () => {
    setup();
    await screen.findByRole("table", { name: "Differences" });
    fireEvent.click(within(screen.getByRole("listbox", { name: "Versions" })).getAllByRole("option")[0]);
    expect(await screen.findByText("This version is the same as the current text.")).toBeTruthy();
    expect(restoreButton().disabled).toBe(true);
  });

  it("shows an empty state for a note without history", async () => {
    setup({ listVersions: async () => [] });
    expect(await screen.findByText(/No saved versions yet/)).toBeTruthy();
  });
});

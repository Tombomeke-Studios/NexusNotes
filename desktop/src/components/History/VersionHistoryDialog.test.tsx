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
      listVersions={async () => ({ versions, next: null })}
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
    setup({ listVersions: async () => ({ versions: [], next: null }) });
    expect(await screen.findByText(/No saved versions yet/)).toBeTruthy();
  });
});

describe("VersionHistoryDialog paging (#555)", () => {
  // 120 versions, an hour apart, served 50 at a time like the API.
  const long: NoteVersionInfo[] = Array.from({ length: 120 }, (_, i) => ({
    id: `p${i}`, note_id: "n1", checksum: i === 0 ? "c-current" : `c${i}`, device_id: "me",
    created_at: at(i * 60), updated_at: at(i * 60),
  }));
  const pager = () =>
    vi.fn(async (_noteId: string, before: string | null) => {
      const start = before ? Number(before) : 0;
      return { versions: long.slice(start, start + 50), next: start + 50 < long.length ? String(start + 50) : null };
    });
  const options = () => within(screen.getByRole("listbox", { name: "Versions" })).getAllByRole("option");

  // jsdom has no layout: give the list a 400 px window and 30 px per row.
  const sized = () => {
    const proto = HTMLElement.prototype;
    const saved = ["scrollHeight", "clientHeight"].map((k) => [k, Object.getOwnPropertyDescriptor(proto, k)] as const);
    Object.defineProperty(proto, "scrollHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.querySelectorAll('[role="option"]').length * 30 + 40;
      },
    });
    Object.defineProperty(proto, "clientHeight", { configurable: true, get: () => 400 });
    return () => {
      for (const [k, d] of saved) {
        if (d) Object.defineProperty(proto, k, d);
        else delete (proto as unknown as Record<string, unknown>)[k];
      }
    };
  };

  it("opens on the newest page and loads older ones on scroll and on request", async () => {
    const restore = sized();
    try {
      const listVersions = pager();
      setup({ listVersions });
      await waitFor(() => expect(options()).toHaveLength(50));
      expect(listVersions).toHaveBeenCalledTimes(1);
      expect(listVersions).toHaveBeenLastCalledWith("n1", null);

      const list = screen.getByRole("listbox", { name: "Versions" });
      list.scrollTop = 1200; // near the bottom of 50 rows
      fireEvent.scroll(list);
      await waitFor(() => expect(options()).toHaveLength(100));
      expect(listVersions).toHaveBeenLastCalledWith("n1", "50");

      fireEvent.click(screen.getByRole("button", { name: "Load older versions" }));
      await waitFor(() => expect(options()).toHaveLength(120));
      expect(screen.queryByRole("button", { name: "Load older versions" })).toBeNull();
      expect(listVersions).toHaveBeenCalledTimes(3);
    } finally {
      restore();
    }
  });

  it("fills a list that does not scroll yet", async () => {
    const listVersions = pager();
    setup({ listVersions }); // no layout: the first page fills nothing
    await waitFor(() => expect(options()).toHaveLength(120));
    expect(listVersions).toHaveBeenCalledTimes(3);
  });

  it("offers a retry when an older page fails", async () => {
    const restore = sized();
    try {
      let fail = true;
      const ok = pager();
      const listVersions = vi.fn(async (noteId: string, before: string | null) => {
        if (before && fail) throw new Error("offline");
        return ok(noteId, before);
      });
      setup({ listVersions });
      await waitFor(() => expect(options()).toHaveLength(50));
      fireEvent.click(screen.getByRole("button", { name: "Load older versions" }));
      const retry = await screen.findByRole("button", { name: /Couldn't load older versions/ });
      fail = false;
      fireEvent.click(retry);
      await waitFor(() => expect(options()).toHaveLength(100));
    } finally {
      restore();
    }
  });
});

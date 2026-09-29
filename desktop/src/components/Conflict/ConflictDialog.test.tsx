import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { ConflictDialog } from "./ConflictDialog";
import { MERGE_MARKERS } from "../../lib/diff";

const MINE = "# Plan\nmine\nend";
const THEIRS = { content: "# Plan\ntheirs\nend", checksum: "c-theirs" };

function setup(overrides: Partial<ComponentProps<typeof ConflictDialog>> = {}) {
  const onResolve = vi.fn();
  const onCancel = vi.fn();
  const props: ComponentProps<typeof ConflictDialog> = {
    noteTitle: "Plan",
    mine: MINE,
    theirs: THEIRS,
    busy: false,
    error: null,
    onResolve,
    onCancel,
    ...overrides,
  };
  const view = render(<ConflictDialog {...props} />);
  const rerender = (extra: Partial<ComponentProps<typeof ConflictDialog>>) =>
    view.rerender(<ConflictDialog {...props} {...extra} />);
  return { onResolve, onCancel, rerender };
}

const saveMerged = () => screen.getByRole("button", { name: "Save merged" }) as HTMLButtonElement;

describe("ConflictDialog", () => {
  it("shows both versions side by side and marks the lines that differ", () => {
    setup();
    const table = screen.getByRole("table", { name: "Differences" });
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toContain("Your version");
    expect(headers).toContain("Other device");
    expect(within(table).getByText("mine").closest("td")?.getAttribute("data-changed")).toBe("mine");
    expect(within(table).getByText("theirs").closest("td")?.getAttribute("data-changed")).toBe("theirs");
    // Lines both versions share are not marked.
    for (const cell of within(table).getAllByText("# Plan")) {
      expect(cell.closest("td")?.hasAttribute("data-changed")).toBe(false);
    }
    expect(screen.getByText(/1 line differs/)).toBeTruthy();
  });

  it("keeps my version, on top of the version it showed", () => {
    const { onResolve } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Keep mine/ }));
    expect(onResolve).toHaveBeenCalledWith(MINE, "c-theirs");
  });

  it("takes the other device's version", () => {
    const { onResolve } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Use theirs/ }));
    expect(onResolve).toHaveBeenCalledWith(THEIRS.content, "c-theirs");
  });

  it("merges by hand, starting from both versions between conflict markers", () => {
    const { onResolve } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Merge by hand/ }));
    const editor = screen.getByRole("textbox", { name: "Merged text" }) as HTMLTextAreaElement;
    expect(editor.value).toContain(MERGE_MARKERS.mine);
    expect(editor.value).toContain(MERGE_MARKERS.theirs);

    expect(saveMerged().disabled).toBe(true);
    expect(screen.getByText(/Remove the conflict markers/)).toBeTruthy();

    fireEvent.change(editor, { target: { value: "# Plan\nmine and theirs\nend" } });
    expect(saveMerged().disabled).toBe(false);
    fireEvent.click(saveMerged());
    expect(onResolve).toHaveBeenCalledWith("# Plan\nmine and theirs\nend", "c-theirs");
  });

  it("blocks a merge that still holds the separator between the two versions", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Merge by hand/ }));
    const editor = screen.getByRole("textbox", { name: "Merged text" });
    // Both outer markers removed, the "=======" left behind (it would turn the
    // line above it into a heading).
    fireEvent.change(editor, { target: { value: "# Plan\nmine\n=======\ntheirs\nend" } });
    expect(saveMerged().disabled).toBe(true);
    expect(screen.getByText(/Remove the conflict markers/)).toBeTruthy();
  });

  it("does not mistake a heading underline that both versions have for a marker", () => {
    setup({ mine: "Title\n=======\nmine", theirs: { content: "Title\n=======\ntheirs", checksum: "c2" } });
    fireEvent.click(screen.getByRole("button", { name: /Merge by hand/ }));
    const editor = screen.getByRole("textbox", { name: "Merged text" });
    fireEvent.change(editor, { target: { value: "Title\n=======\nmine and theirs" } });
    expect(saveMerged().disabled).toBe(false);
  });

  it("says so when the other device saves again while it is open", () => {
    const { rerender, onResolve } = setup();
    rerender({ theirs: { content: "# Plan\nnewer\nend", checksum: "c-newer" } });
    expect(screen.getByRole("status").textContent).toMatch(/saved this note again while this was open/);
    fireEvent.click(screen.getByRole("button", { name: /Keep mine/ }));
    expect(onResolve).toHaveBeenCalledWith(MINE, "c-newer");
  });

  it("won't save a merge started from an older version of the other device", () => {
    const { rerender, onResolve } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Merge by hand/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Merged text" }), {
      target: { value: "# Plan\nmerged\nend" },
    });
    rerender({ theirs: { content: "# Plan\nnewer\nend", checksum: "c-newer" } });

    expect(saveMerged().disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/Back to compare/);
    fireEvent.click(saveMerged());
    expect(onResolve).not.toHaveBeenCalled();
  });

  it("goes back from merging to the comparison", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Merge by hand/ }));
    fireEvent.click(screen.getByRole("button", { name: "Back to compare" }));
    expect(screen.getByRole("table", { name: "Differences" })).toBeTruthy();
  });

  it("folds long runs of unchanged lines, which can be shown again", () => {
    const same = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    setup({
      mine: [...same, "mine"].join("\n"),
      theirs: { content: [...same, "theirs"].join("\n"), checksum: "c2" },
    });
    const table = screen.getByRole("table", { name: "Differences" });
    // Three lines of context stay around the change; the rest is folded.
    expect(within(table).queryByText("line 1")).toBeNull();
    expect(within(table).getAllByText("line 18")).toHaveLength(2);
    fireEvent.click(within(table).getByRole("button", { name: "Show 17 unchanged lines" }));
    expect(within(table).getAllByText("line 1")).toHaveLength(2);
  });

  it("says so when both versions are the same", () => {
    setup({ mine: "same", theirs: { content: "same", checksum: "c2" } });
    expect(screen.getByText(/Both versions are the same/)).toBeTruthy();
  });

  it("locks every choice while the resolution is being saved", () => {
    const { onResolve, onCancel } = setup({ busy: true });
    for (const name of [/Keep mine/, /Use theirs/, /Merge by hand/, /Cancel/]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onResolve).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("closes on Cancel and on Escape without resolving", () => {
    const { onResolve, onCancel } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onResolve).not.toHaveBeenCalled();
  });

  it("shows why the last attempt failed", () => {
    setup({ error: "This note changed again on the other device." });
    expect(screen.getByRole("alert").textContent).toContain("changed again");
  });

  it("waits for the other device's version before offering choices", () => {
    setup({ theirs: null });
    expect(screen.getByText(/Loading the other device.s version/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Keep mine/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Use theirs/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

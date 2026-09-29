import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { AnimatePresence } from "framer-motion";
import { TemplatePicker } from "./TemplatePicker";
import type { Note } from "../../lib/types";

const template = { id: "t1", title: "Daily", content: "# {{date}}" } as Note;

function Harness({ open, onPick, onClose }: { open: boolean; onPick: () => void; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && <TemplatePicker key="tpl" templates={[template]} onPick={onPick} onClose={onClose} />}
    </AnimatePresence>
  );
}

describe("TemplatePicker", () => {
  it("inserts the selected template on Enter", () => {
    const onPick = vi.fn();
    render(<Harness open onPick={onPick} onClose={() => {}} />);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(template);
  });

  it("ignores keys once it is closing", () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    const { rerender, container } = render(<Harness open onPick={onPick} onClose={onClose} />);
    rerender(<Harness open={false} onPick={onPick} onClose={onClose} />);
    // Still mounted while its exit animation runs.
    expect(container.querySelector(".tpl-picker")).not.toBeNull();

    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: "Escape" });
    const arrow = new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true });
    window.dispatchEvent(arrow);

    expect(onPick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(arrow.defaultPrevented).toBe(false);
  });
});

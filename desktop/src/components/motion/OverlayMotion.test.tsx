import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AnimatePresence } from "framer-motion";
import { OverlayMotion } from "./OverlayMotion";

describe("OverlayMotion", () => {
  it("renders its children with the given class while present", () => {
    const { container } = render(
      <AnimatePresence>
        <OverlayMotion key="p" preset="palette" className="palette">
          <span>hello</span>
        </OverlayMotion>
      </AnimatePresence>,
    );
    const el = container.querySelector(".palette") as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.textContent).toBe("hello");
    expect(el.style.pointerEvents).not.toBe("none");
    expect(el.hasAttribute("inert")).toBe(false);
  });

  it("takes no pointer or keyboard input while it animates out", () => {
    const { container, rerender } = render(
      <AnimatePresence>
        <OverlayMotion key="p" preset="dialog" className="dialog">
          <input aria-label="name" />
        </OverlayMotion>
      </AnimatePresence>,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    rerender(<AnimatePresence>{null}</AnimatePresence>);
    const exiting = container.querySelector(".dialog") as HTMLElement;
    // The exit animation keeps it mounted for a moment.
    expect(exiting).not.toBeNull();
    expect(exiting.style.pointerEvents).toBe("none");
    expect(exiting.hasAttribute("inert")).toBe(true);
    // A second Enter must not reach a field of a dialog that is closing.
    expect(document.activeElement).not.toBe(input);
  });
});

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <AnimatePresence>
        {open && (
          <OverlayMotion key="d" preset="dialog" aria-label="Test dialog">
            <button>First</button>
            <input placeholder="Middle" />
            <button onClick={() => setOpen(false)}>Last</button>
          </OverlayMotion>
        )}
      </AnimatePresence>
    </>
  );
}

// Keyboard users stay inside an open dialog and land back where they were
// when it closes (#267).
describe("OverlayMotion dialog focus", () => {
  it("moves focus in, traps Tab, and returns focus on close", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = await screen.findByRole("dialog", { name: "Test dialog" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const first = screen.getByRole("button", { name: "First" });
    const last = screen.getByRole("button", { name: "Last" });
    expect(document.activeElement).toBe(first);

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    await act(async () => {
      fireEvent.click(last);
    });
    expect(document.activeElement).toBe(opener);
  });

  it("keeps a field the dialog focuses itself", async () => {
    function AutoFocusHarness() {
      return (
        <AnimatePresence>
          <OverlayMotion key="d" preset="dialog" aria-label="Auto">
            <button>Other</button>
            <input placeholder="Name" autoFocus />
          </OverlayMotion>
        </AnimatePresence>
      );
    }
    render(<AutoFocusHarness />);
    expect(document.activeElement).toBe(screen.getByPlaceholderText("Name"));
  });
});

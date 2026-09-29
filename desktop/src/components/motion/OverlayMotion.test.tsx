import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
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

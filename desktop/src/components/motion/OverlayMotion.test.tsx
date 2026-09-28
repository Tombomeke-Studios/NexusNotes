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
  });

  it("stops catching clicks while it animates out", () => {
    const { container, rerender } = render(
      <AnimatePresence>
        <OverlayMotion key="p" preset="dialog" className="dialog" />
      </AnimatePresence>,
    );
    rerender(<AnimatePresence>{null}</AnimatePresence>);
    const exiting = container.querySelector(".dialog") as HTMLElement | null;
    // Either already gone, or still fading out without intercepting the pointer.
    if (exiting) expect(exiting.style.pointerEvents).toBe("none");
  });
});

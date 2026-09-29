import { useLayoutEffect, useRef } from "react";
import { motion, useIsPresent, type HTMLMotionProps } from "framer-motion";
import { overlayMotion } from "../../lib/motion-tokens";

type Preset = keyof typeof overlayMotion;

/** React 18 has no `inert` prop; an empty string renders the bare attribute. */
const INERT = { inert: "" } as Record<string, string>;

/**
 * A div that enters and leaves with one of the shared overlay presets
 * (lib/motion-tokens.ts). Render it as the direct child of an AnimatePresence
 * (with a key) so the exit animation plays. While it animates out it takes no
 * input: it is inert, drops focus and no longer catches the pointer, so a
 * second click or Enter never lands on something already closing.
 */
export function OverlayMotion({ preset, style, ...rest }: HTMLMotionProps<"div"> & { preset: Preset }) {
  const present = useIsPresent();
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (present) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && ref.current?.contains(focused)) focused.blur();
  }, [present]);

  return (
    <motion.div
      ref={ref}
      {...overlayMotion[preset]}
      {...rest}
      {...(present ? null : INERT)}
      style={present ? style : { ...style, pointerEvents: "none" }}
    />
  );
}

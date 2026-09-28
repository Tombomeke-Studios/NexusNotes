import { motion, useIsPresent, type HTMLMotionProps } from "framer-motion";
import { overlayMotion } from "../../lib/motion-tokens";

type Preset = keyof typeof overlayMotion;

/**
 * A div that enters and leaves with one of the shared overlay presets
 * (lib/motion-tokens.ts). Render it as the direct child of an AnimatePresence
 * (with a key) so the exit animation plays. While it animates out it no longer
 * catches the pointer, so a click never lands on something already closing.
 */
export function OverlayMotion({ preset, style, ...rest }: HTMLMotionProps<"div"> & { preset: Preset }) {
  const present = useIsPresent();
  return (
    <motion.div
      {...overlayMotion[preset]}
      {...rest}
      style={present ? style : { ...style, pointerEvents: "none" }}
    />
  );
}

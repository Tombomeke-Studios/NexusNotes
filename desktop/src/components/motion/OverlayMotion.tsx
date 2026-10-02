import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { motion, useIsPresent, type HTMLMotionProps } from "framer-motion";
import { overlayMotion } from "../../lib/motion-tokens";

type Preset = keyof typeof overlayMotion;

/** React 18 has no `inert` prop; an empty string renders the bare attribute. */
const INERT = { inert: "" } as Record<string, string>;

/** Presets that are modal: they trap focus and give it back when they close. */
const MODAL: ReadonlySet<Preset> = new Set<Preset>(["dialog", "palette"]);

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest("[inert]"));
}

/**
 * A div that enters and leaves with one of the shared overlay presets
 * (lib/motion-tokens.ts). Render it as the direct child of an AnimatePresence
 * (with a key) so the exit animation plays. While it animates out it takes no
 * input: it is inert, drops focus and no longer catches the pointer, so a
 * second click or Enter never lands on something already closing.
 *
 * Modal presets (dialog, palette) also behave as dialogs for keyboard and
 * screen-reader users (#267): role="dialog" + aria-modal by default, focus
 * moves in when they open (unless a field already took it), Tab and
 * Shift+Tab cycle inside, and focus returns to where it was when they close.
 */
export function OverlayMotion({ preset, style, onKeyDown, ...rest }: HTMLMotionProps<"div"> & { preset: Preset }) {
  const present = useIsPresent();
  const ref = useRef<HTMLDivElement>(null);
  const modal = MODAL.has(preset);
  // Captured during the first render, before anything inside takes focus.
  const [returnTo] = useState<Element | null>(() => (typeof document !== "undefined" ? document.activeElement : null));

  useLayoutEffect(() => {
    if (!modal || !present) return;
    const root = ref.current;
    if (root && !root.contains(document.activeElement)) {
      (focusables(root)[0] ?? root).focus();
    }
  }, [modal, present]);

  useLayoutEffect(() => {
    if (present) return;
    const focused = document.activeElement;
    const inside = focused instanceof HTMLElement && ref.current?.contains(focused);
    if (inside) focused.blur();
    if (modal && (inside || document.activeElement === document.body) && returnTo instanceof HTMLElement && returnTo.isConnected) {
      returnTo.focus();
    }
  }, [present, modal, returnTo]);

  const trapTab = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (!modal || e.key !== "Tab" || e.defaultPrevented || !ref.current) return;
    const items = focusables(ref.current);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !ref.current.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !ref.current.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <motion.div
      ref={ref}
      {...overlayMotion[preset]}
      {...(modal ? { role: "dialog", "aria-modal": true, tabIndex: -1 } : null)}
      {...rest}
      onKeyDown={trapTab}
      {...(present ? null : INERT)}
      style={present ? style : { ...style, pointerEvents: "none" }}
    />
  );
}

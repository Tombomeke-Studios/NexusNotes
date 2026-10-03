import { useEffect, useRef } from "react";
import { useIsPresent } from "framer-motion";
import { OverlayMotion } from "../motion/OverlayMotion";
import { SHORTCUT_GROUPS } from "../../lib/shortcuts";
import "./ShortcutsDialog.css";

/** Keyboard shortcut reference (#452), opened with `?` or the palette's Help command. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const present = useIsPresent();
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!present) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [present, onClose]);

  return (
    <OverlayMotion preset="backdrop" className="confirm-overlay" onClick={onClose}>
      <OverlayMotion
        preset="dialog"
        className="confirm-dialog shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="confirm-title shortcuts-title" id="shortcuts-title" ref={titleRef} tabIndex={-1}>
          Keyboard shortcuts
        </h2>
        <div className="shortcuts-groups">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} className="shortcuts-group" aria-labelledby={`sc-${group.title}`}>
              <h3 className="shortcuts-group-title" id={`sc-${group.title}`}>
                {group.title}
              </h3>
              <dl className="shortcuts-list">
                {group.items.map(([label, keys]) => (
                  <div key={label} className="shortcuts-row">
                    <dt>{label}</dt>
                    <dd>
                      {keys.split("+").map((k, i) => (
                        <kbd key={i} className="shortcuts-key">
                          {k}
                        </kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <div className="confirm-actions">
          <button className="confirm-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </OverlayMotion>
    </OverlayMotion>
  );
}

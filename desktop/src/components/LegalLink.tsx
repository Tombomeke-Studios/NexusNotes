import type { ReactNode } from "react";
import { isTauriWindow, openBundledPage } from "../lib/platform";

/**
 * Link to one of the policy pages bundled with the app. In a browser it is a
 * normal link that opens a tab; in the desktop app it opens its own window,
 * because a native webview does nothing with `target="_blank"`.
 */
export function LegalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      className="legal-link"
      href={href}
      target="_blank"
      rel="noopener"
      onClick={(e) => {
        if (!isTauriWindow) return;
        e.preventDefault();
        void openBundledPage(href, typeof children === "string" ? children : "NexusNotes");
      }}
    >
      {children}
    </a>
  );
}

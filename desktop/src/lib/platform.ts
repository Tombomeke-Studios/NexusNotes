/** True when running inside the native Tauri shell (not a plain browser). */
export const isTauriWindow =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Short OS name derived from a user-agent string. */
export function osFromUserAgent(ua: string): string {
  if (/Windows/i.test(ua)) return "Windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macOS";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad/i.test(ua)) return "iOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "Unknown OS";
}

/** Short browser name derived from a user-agent string (order matters). */
export function browserFromUserAgent(ua: string): string {
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "Browser";
}

/**
 * Human-readable identity this device registers itself with on the sync
 * server (#44) — e.g. name "Chrome on Windows", platform "web".
 */
export function deviceDescription(
  ua: string = typeof navigator !== "undefined" ? navigator.userAgent : "",
  tauri: boolean = isTauriWindow,
): { name: string; platform: string } {
  const os = osFromUserAgent(ua);
  return tauri
    ? { name: `NexusNotes on ${os}`, platform: "desktop" }
    : { name: `${browserFromUserAgent(ua)} on ${os}`, platform: "web" };
}

/**
 * The policy pages bundled with the app live in `public/legal/` as flat
 * `name.html` files. Returns the path when it names one of them, otherwise
 * null: nothing outside `/legal/`, no other directories, no query or fragment,
 * and no absolute or remote URL ever reaches a window or tab.
 */
const LEGAL_PAGE = /^\/legal\/[a-z0-9][a-z0-9-]*\.html$/;

export function legalPagePath(path: string): string | null {
  return typeof path === "string" && LEGAL_PAGE.test(path) ? path : null;
}

/**
 * Opens one of the bundled policy pages (see legalPagePath). A native webview
 * ignores `target="_blank"`, so the packaged app opens its own small window,
 * labelled `legal-<name>`; no capability lists those labels, so the page gets
 * no access to the app's commands. A browser opens a tab. Any other path is
 * refused and nothing opens.
 */
export async function openBundledPage(path: string, title: string, tauri: boolean = isTauriWindow): Promise<void> {
  const page = legalPagePath(path);
  if (!page) {
    console.warn("openBundledPage: not a bundled policy page", path);
    return;
  }
  if (!tauri) {
    window.open(page, "_blank", "noopener");
    return;
  }
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const label = `legal-${page.slice("/legal/".length, -".html".length)}`;
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }
  new WebviewWindow(label, { url: page, title, width: 760, height: 820, center: true });
}

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
 * Opens a page bundled with the app (the policy pages under /legal). A native
 * webview ignores `target="_blank"`, so the packaged app opens its own small
 * window; a browser opens a tab.
 */
export async function openBundledPage(path: string, title: string): Promise<void> {
  if (!isTauriWindow) {
    window.open(path, "_blank", "noopener");
    return;
  }
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const label = `legal-${path.replace(/[^a-z0-9]/gi, "-").replace(/^-+|-+$/g, "")}`;
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }
  new WebviewWindow(label, { url: path, title, width: 760, height: 820, center: true });
}

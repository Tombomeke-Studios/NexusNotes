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

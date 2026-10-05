/**
 * The server this app talks to (#500). The hosted API is the build default;
 * a saved choice (self-hosters) wins. Only an origin is ever kept: no path,
 * credentials or fragment, and plain http only for loopback dev stacks.
 */
export const SERVER_URL_KEY = "nexus_server_url";

export type ServerUrlResult = { ok: true; url: string } | { ok: false; reason: string };

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function normalizeServerUrl(input: string): ServerUrlResult {
  const raw = input.trim();
  if (!raw) return { ok: false, reason: "Enter a server address." };
  // A bare host ("api.example.com") means https; anything else with a scheme is checked as typed.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[^/]*:\d+(\/|$)/.test(raw);
  let u: URL;
  try {
    u = new URL(hasScheme ? raw : `https://${raw}`);
  } catch {
    return { ok: false, reason: "That is not a valid address." };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, reason: "Only https addresses are supported." };
  }
  if (!u.hostname) return { ok: false, reason: "That is not a valid address." };
  if (u.username || u.password) return { ok: false, reason: "Remove the username and password from the address." };
  if (u.protocol === "http:" && !LOOPBACK.has(u.hostname)) {
    return { ok: false, reason: "Use https. Plain http is only allowed for localhost." };
  }
  return { ok: true, url: u.origin };
}

/** The saved server, or `fallback` when none is saved or the saved value is not valid. */
export function loadServerUrl(fallback: string): string {
  try {
    const saved = localStorage.getItem(SERVER_URL_KEY);
    if (saved) {
      const r = normalizeServerUrl(saved);
      if (r.ok) return r.url;
    }
  } catch {
    /* storage unavailable: use the default */
  }
  return fallback;
}

/** Saves a valid server URL. Returns false (and saves nothing) for an invalid one. */
export function saveServerUrl(input: string): boolean {
  const r = normalizeServerUrl(input);
  if (!r.ok) return false;
  try {
    localStorage.setItem(SERVER_URL_KEY, r.url);
  } catch {
    return false;
  }
  return true;
}

/**
 * Where the sync service is (#399). An explicit VITE_API_URL wins (dev server,
 * CI). Otherwise the packaged desktop app talks to its own sidecar on
 * localhost:8080, and the web UI in a browser to its own origin, where nginx
 * proxies /api and /ws to the sync service. Never a hard-coded localhost in a
 * browser: that would be the user's machine, not the server.
 */
export function resolveApiBase(configured: string | undefined, isTauri: boolean, origin: string): string {
  if (configured) return configured.replace(/\/+$/, "");
  return isTauri ? "http://localhost:8080" : origin;
}

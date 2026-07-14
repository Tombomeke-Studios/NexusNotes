/**
 * Email action links (#47/#48) open the web app at /verify-email?token=… or
 * /reset-password?token=…. This parses the current location into an action the
 * app can render before the normal auth screen.
 */

export type AuthAction =
  | { kind: "verify-email"; token: string }
  | { kind: "reset-password"; token: string }
  | null;

/** Parses a pathname + query string into an auth action, or null. */
export function parseAuthAction(pathname: string, search: string): AuthAction {
  const token = new URLSearchParams(search).get("token");
  if (!token) return null;
  if (pathname.endsWith("/verify-email")) return { kind: "verify-email", token };
  if (pathname.endsWith("/reset-password")) return { kind: "reset-password", token };
  return null;
}

/** Reads the auth action from the live browser location. */
export function currentAuthAction(): AuthAction {
  if (typeof window === "undefined") return null;
  return parseAuthAction(window.location.pathname, window.location.search);
}

/** Clears the action query/path from the address bar without a reload. */
export function clearAuthActionUrl(): void {
  if (typeof window !== "undefined" && window.history?.replaceState) {
    window.history.replaceState(null, "", "/");
  }
}

import pkg from "../../package.json";

/** Release version of this app build (kept equal to the repo-root VERSION file). */
export const APP_VERSION: string = pkg.version;

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

/** Parses "x.y.z" (optional leading "v" / "-pre" suffix); null for anything else, e.g. "dev". */
export function parseVersion(v: string | undefined | null): ParsedVersion | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v ?? "");
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) } : null;
}

export interface HealthPayload {
  status?: string;
  version?: string;
}

export type ServerStatus =
  | { state: "unreachable" }
  | { state: "ok"; serverVersion?: string }
  | { state: "mismatch"; serverVersion: string; appVersion: string };

/**
 * Classifies the server from its /health payload (null = no answer).
 * Before 1.0 a minor bump may change the API, so major.minor must match;
 * patch differences are fine, and unversioned (dev) servers are assumed compatible.
 */
export function assessHealth(health: HealthPayload | null, appVersion: string): ServerStatus {
  if (!health) return { state: "unreachable" };
  const server = parseVersion(health.version);
  const app = parseVersion(appVersion);
  if (server && app && (server.major !== app.major || server.minor !== app.minor)) {
    return { state: "mismatch", serverVersion: health.version as string, appVersion };
  }
  return { state: "ok", serverVersion: health.version };
}

/** One-line version summary for the settings footer, e.g. "NexusNotes v0.5.0 · server v0.5.2". */
export function formatVersionLabel(appVersion: string, status: ServerStatus | null): string {
  const base = `NexusNotes v${appVersion}`;
  if (!status) return base;
  if (status.state === "unreachable") return `${base} · server unreachable`;
  const server = parseVersion(status.serverVersion) ? `v${status.serverVersion}` : "dev build";
  return `${base} · server ${server}`;
}

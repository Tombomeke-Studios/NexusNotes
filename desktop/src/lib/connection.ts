import type { ServerStatus } from "./version";

/** Wording shared by the login form and the connection banner. */
export function unreachableMessage(apiUrl: string): string {
  return `Can't reach the NexusNotes server at ${apiUrl}.`;
}

export interface ConnectionNotice {
  tone: "error" | "warning";
  message: string;
  hint?: string;
}

/** What to tell the user about the server, or null when everything is fine. */
export function describeServerStatus(status: ServerStatus, apiUrl: string): ConnectionNotice | null {
  switch (status.state) {
    case "ok":
      return null;
    case "unreachable":
      return {
        tone: "error",
        message: unreachableMessage(apiUrl),
        hint: "Make sure Docker Desktop is running. The app retries automatically; to start the backend yourself run scripts/dev-web.sh.",
      };
    case "mismatch":
      return {
        tone: "warning",
        message: `This app is v${status.appVersion} but the server is v${status.serverVersion}.`,
        hint: "Update the app or the server so both run the same version — mismatched versions can fail in unexpected ways.",
      };
  }
}

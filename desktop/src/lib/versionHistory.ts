import { notes as notesApi } from "./api";
import type { DiffLine } from "./diff";
import { decryptNoteForVault, type VaultLike } from "./vaultKeys";
import type { NoteVersion, NoteVersionInfo } from "./types";

/**
 * Helpers for the version history panel (#415-#417). A version is a snapshot
 * the server keeps per device every few minutes (#413); its text is loaded on
 * demand (#414) and decrypted here for e2ee vaults.
 */

/** Who saved a version, from this device's point of view. */
export function deviceLabel(deviceId: string, thisDeviceId: string, names: Map<string, string>): string {
  if (!deviceId) return "Unknown device";
  if (deviceId === thisDeviceId) return "This device";
  return names.get(deviceId) ?? "Another device";
}

export interface VersionDay {
  label: string;
  items: NoteVersionInfo[];
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Groups versions (newest first) by the local day they were last saved. */
export function groupByDay(versions: NoteVersionInfo[], now: Date = new Date()): VersionDay[] {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const groups: VersionDay[] = [];
  let lastKey = "";
  for (const version of versions) {
    const at = new Date(version.updated_at);
    const key = dayKey(at);
    if (key !== lastKey) {
      const label =
        key === dayKey(now)
          ? "Today"
          : key === dayKey(yesterday)
            ? "Yesterday"
            : at.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      groups.push({ label, items: [] });
      lastKey = key;
    }
    groups[groups.length - 1].items.push(version);
  }
  return groups;
}

/** Lines only in the left text (the version) and only in the right one. */
export function diffSummary(lines: DiffLine[]): { onlyLeft: number; onlyRight: number } {
  let onlyLeft = 0;
  let onlyRight = 0;
  for (const line of lines) {
    if (line.kind === "mine") onlyLeft++;
    else if (line.kind === "theirs") onlyRight++;
  }
  return { onlyLeft, onlyRight };
}

/** Loads one version's text, decrypted on this device for an e2ee vault. */
export async function loadVersionText(
  vault: VaultLike,
  noteId: string,
  versionId: string,
  fetch: (noteId: string, versionId: string) => Promise<NoteVersion> = notesApi.version,
): Promise<string> {
  const version = await fetch(noteId, versionId);
  return decryptNoteForVault(vault, version.content ?? "");
}

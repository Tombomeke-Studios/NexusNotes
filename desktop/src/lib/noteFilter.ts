import type { Note } from "./types";
import { extractTags } from "./tags";

export type SortBy = "updated" | "title";

/** Sentinel folder value meaning "notes at the vault root only". */
export const ROOT_FOLDER = "__root";

export function folderOf(path: string): string | null {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 1 ? parts[0] : null;
}

export function filterNotes(
  notes: Note[],
  tags: string[],
  folder: string | null,
): Note[] {
  return notes.filter((n) => {
    if (tags.length > 0 && !extractTags(n.content).some((t) => tags.includes(t))) {
      return false;
    }
    if (folder) {
      const f = folderOf(n.path);
      if (folder === ROOT_FOLDER ? f !== null : f !== folder) return false;
    }
    return true;
  });
}

export function sortNotes(notes: Note[], by: SortBy): Note[] {
  const sorted = [...notes];
  if (by === "title") {
    sorted.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }));
  } else {
    sorted.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  return sorted;
}

export interface SearchHit {
  note: Note;
  snippet: string;
}

export function searchNotes(notes: Note[], query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const n of notes) {
    const inTitle = n.title.toLowerCase().includes(q);
    const idx = n.content.toLowerCase().indexOf(q);
    if (!inTitle && idx < 0) continue;
    let snippet = idx >= 0 ? n.content.slice(Math.max(0, idx - 30), idx + 80) : n.content.slice(0, 100);
    snippet = snippet.replace(/[#>*`[\]]/g, "").replace(/\s+/g, " ").trim();
    hits.push({ note: n, snippet: (idx > 30 ? "…" : "") + snippet });
  }
  return hits;
}

export function uniqueTitle(existing: Set<string>, base: string): string {
  if (!existing.has(base)) return base;
  // Fill the lowest free number: base, base 1, base 2, …
  let i = 1;
  while (existing.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

export function topLevelFolders(notes: Note[]): string[] {
  return [...new Set(notes.map((n) => folderOf(n.path)).filter((f): f is string => !!f))].sort();
}

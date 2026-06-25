import type { Note } from "./types";

// Mirrors the backend ParseTags logic — same rules, client-side.
const TAG_RE = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_/\-]*)/gm;
const CODE_RE = /```[\s\S]*?```|`[^\n`]+`/g;

export function extractTags(content: string): string[] {
  const stripped = content.replace(CODE_RE, " ");
  const seen = new Set<string>();
  const tags: string[] = [];
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(stripped)) !== null) {
    const tag = m[1].toLowerCase();
    if (!seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

export function buildTagCounts(notes: Note[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const note of notes) {
    for (const tag of extractTags(note.content)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

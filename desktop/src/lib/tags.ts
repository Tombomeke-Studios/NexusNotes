import type { Note } from "./types";

// Mirrors the backend mergeTags logic — same rules, client-side:
// YAML front-matter tags first, then inline #tags, deduplicated, lowercased.
const TAG_RE = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_/-]*)/gm;
const CODE_RE = /```[\s\S]*?```|`[^\n`]+`/g;
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

function parseFrontmatterTags(block: string): string[] {
  const tags: string[] = [];
  let inTagsList = false;
  for (const line of block.split("\n")) {
    if (/^(\s+-\s|-\s)/.test(line)) {
      if (inTagsList) {
        const item = line.replace(/^\s*-\s*/, "").trim();
        if (item) tags.push(item);
      }
      continue;
    }
    const colon = line.indexOf(":");
    if (colon < 0) {
      inTagsList = false;
      continue;
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    inTagsList = false;
    if (key !== "tags") continue;
    if (value === "") {
      inTagsList = true;
    } else {
      const inner = value.replace(/^\[/, "").replace(/\]$/, "");
      for (const part of inner.split(",")) {
        const item = part.trim();
        if (item) tags.push(item);
      }
    }
  }
  return tags;
}

export function extractTags(content: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  const add = (raw: string) => {
    const tag = raw.trim().toLowerCase();
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  };

  const fm = content.match(FRONTMATTER_RE);
  if (fm) {
    for (const tag of parseFrontmatterTags(fm[1])) add(tag);
  }

  const stripped = content.replace(CODE_RE, " ");
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(stripped)) !== null) {
    add(m[1]);
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

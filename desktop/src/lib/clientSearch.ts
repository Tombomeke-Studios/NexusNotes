import type { Note, SearchHit } from "./types";
import { extractTags } from "./tags";

/**
 * Client-side full-text search for e2ee vaults (#200). The server only holds
 * ciphertext for these vaults, so Meilisearch cannot index their content;
 * instead we search the decrypted notes already held in memory. No external
 * index library: at personal-vault scale a linear scan is instant, and the
 * plaintext never has to be copied into a second structure.
 */

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Snippet around the first match, HTML-escaped with the hit wrapped in <em>. */
function buildSnippet(content: string, q: string): string | undefined {
  const idx = content.toLowerCase().indexOf(q);
  if (idx < 0) return undefined;
  const start = Math.max(0, idx - 30);
  const before = content.slice(start, idx).replace(/[#>*`[\]]/g, "").replace(/\s+/g, " ");
  const match = content.slice(idx, idx + q.length);
  const after = content
    .slice(idx + q.length, idx + q.length + 80)
    .replace(/[#>*`[\]]/g, "")
    .replace(/\s+/g, " ");
  return `${start > 0 ? "…" : ""}${escapeHtml(before)}<em>${escapeHtml(match)}</em>${escapeHtml(after)}`.trim();
}

/**
 * Searches decrypted notes by query and/or tag, mirroring the server search
 * result shape so the search UI renders both the same way. Title matches
 * rank before content-only matches; results are capped at `limit`.
 */
export function searchDecryptedNotes(
  notes: Note[],
  query: string,
  tag: string,
  limit = 30,
): SearchHit[] {
  const q = query.trim().toLowerCase();
  const t = tag.trim().replace(/^#/, "").toLowerCase();
  if (!q && !t) return [];

  const titleHits: SearchHit[] = [];
  const contentHits: SearchHit[] = [];

  for (const n of notes) {
    const tags = extractTags(n.content);
    if (t && !tags.some((x) => x.toLowerCase() === t)) continue;

    const inTitle = q !== "" && n.title.toLowerCase().includes(q);
    const snippet = q !== "" ? buildSnippet(n.content, q) : undefined;
    if (q && !inTitle && snippet === undefined) continue;

    const hit: SearchHit = {
      id: n.id,
      vault_id: n.vault_id,
      title: n.title,
      path: n.path,
      tags,
      updated_at: n.updated_at,
      snippet,
    };
    (inTitle ? titleHits : contentHits).push(hit);
  }

  return [...titleHits, ...contentHits].slice(0, limit);
}

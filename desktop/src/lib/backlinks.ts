import type { Note } from "./types";

export interface BacklinkCard {
  noteId: string;
  title: string;
  pre: string;
  match: string;
  post: string;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Client-side backlink context: finds the first wiki-link to the target
 * note in every other note and returns the surrounding line fragment.
 */
export function buildBacklinkCards(notes: Note[], target: Note): BacklinkCard[] {
  if (!target.title) return [];
  const re = new RegExp(
    `^(.*?)(\\[\\[${escapeRe(target.title)}(?:#[^\\]|]*)?(?:\\|[^\\]]*)?\\]\\])(.*)$`,
    "im",
  );
  const cards: BacklinkCard[] = [];
  for (const n of notes) {
    if (n.id === target.id) continue;
    const m = n.content.match(re);
    if (!m) continue;
    cards.push({
      noteId: n.id,
      title: n.title,
      pre: m[1].replace(/^[-*>\s#\d.]+/, "").slice(-42),
      match: m[2],
      post: m[3].slice(0, 42),
    });
  }
  return cards;
}

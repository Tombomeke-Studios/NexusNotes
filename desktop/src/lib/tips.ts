/**
 * One-time contextual tips (#448): each shows the first time its feature is
 * on screen, until the user dismisses it. Dismissals live in localStorage
 * (per device).
 */
export type TipId = "graph" | "palette" | "backlinks" | "tag-filter";

const KEY = "nexus_tips_seen";

function seen(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function tipSeen(id: TipId): boolean {
  return seen().has(id);
}

export function markTipSeen(id: TipId) {
  const all = seen();
  all.add(id);
  try {
    localStorage.setItem(KEY, JSON.stringify([...all]));
  } catch {
    /* blocked storage: the tip just shows again next time */
  }
}

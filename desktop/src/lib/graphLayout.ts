/**
 * Starting layout for the graph view (#439): new nodes start in a small
 * cloud at the centre and the simulation pushes them outward; nodes the view
 * has already placed keep their position, so a re-render (a save while the
 * graph is open) nudges the layout instead of starting over.
 */

export interface Point {
  x: number;
  y: number;
}

/** Radius of the cloud new nodes start in. */
const SEED_RADIUS = 36;
/** Longest wait before the last node fades in, in ms. */
export const MAX_ENTER_DELAY = 600;

// FNV-1a: a stable pseudo-random angle and distance per id, so the same graph
// always unfolds the same way.
function hash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function seedPositions<T extends { id: string }>(
  nodes: T[],
  known: Map<string, Point>,
  width: number,
  height: number,
): { nodes: Array<T & Point>; reused: number } {
  let reused = 0;
  const out = nodes.map((n) => {
    const prev = known.get(n.id);
    if (prev) {
      reused++;
      return { ...n, x: prev.x, y: prev.y };
    }
    const h = hash(n.id);
    const angle = ((h & 0xffff) / 0xffff) * Math.PI * 2;
    const dist = Math.sqrt(((h >>> 16) & 0xffff) / 0xffff) * SEED_RADIUS;
    return { ...n, x: width / 2 + Math.cos(angle) * dist, y: height / 2 + Math.sin(angle) * dist };
  });
  return { nodes: out, reused };
}

/** Fade-in delay of the index-th of `count` nodes: a stagger that never exceeds MAX_ENTER_DELAY. */
export function enterDelay(index: number, count: number): number {
  if (count <= 1) return 0;
  return Math.round(Math.min(index * 24, (index / (count - 1)) * MAX_ENTER_DELAY));
}

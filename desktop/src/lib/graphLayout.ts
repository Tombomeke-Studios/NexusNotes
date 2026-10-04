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

export const MIN_FIT_SCALE = 0.25;
export const MAX_FIT_SCALE = 1.4;

/**
 * The zoom (scale k, translation x/y) that shows every point inside a
 * width x height view with `padding` around it (#267): the graph opens
 * fitted instead of wherever the simulation left it.
 */
export function fitTransform(points: Point[], width: number, height: number, padding = 48): { k: number; x: number; y: number } {
  if (points.length === 0) return { k: 1, x: 0, y: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const w = Math.max(maxX - minX, 1);
  const h = Math.max(maxY - minY, 1);
  const k = Math.min(
    MAX_FIT_SCALE,
    Math.max(MIN_FIT_SCALE, Math.min((width - padding * 2) / w, (height - padding * 2) / h)),
  );
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { k, x: width / 2 - k * cx, y: height / 2 - k * cy };
}

/** How many folder colours the theme defines (--graph-folder-1 ... -N). */
export const FOLDER_COLOR_COUNT = 10;

/** A folder's colour slot (1-based), stable per name; null for root notes. */
export function folderColorIndex(folder: string): number | null {
  if (!folder) return null;
  let hash = 0;
  for (let i = 0; i < folder.length; i++) hash = (hash * 31 + folder.charCodeAt(i)) | 0;
  return (Math.abs(hash) % FOLDER_COLOR_COUNT) + 1;
}

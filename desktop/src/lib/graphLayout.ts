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

/** How far floating chrome reaches into the view from its top and bottom edge. */
export interface Insets {
  top: number;
  bottom: number;
}

/** Space kept between the fitted node centres and the chrome floating over
 * the graph: room for the biggest node's radius and the label under it. */
export const OVERLAY_GAP = 36;

/** The most of the view's height the chrome may claim from the fit. */
export const MAX_CHROME_SHARE = 2 / 3;

/**
 * How much of the view the floating chrome covers (#594): the lowest bottom
 * edge of the top overlays (search, toolbar, tip) and the highest top edge
 * of the bottom ones (legend, zoom bar), measured from the view's edges.
 * Empty (hidden) boxes are ignored.
 */
export function overlayInsets(
  view: { top: number; bottom: number },
  tops: { top: number; bottom: number; height: number }[],
  bottoms: { top: number; bottom: number; height: number }[],
): Insets {
  const height = view.bottom - view.top;
  const clamp = (v: number) => Math.min(Math.max(v, 0), height);
  return {
    top: tops.filter((r) => r.height > 0).reduce((m, r) => Math.max(m, clamp(r.bottom - view.top)), 0),
    bottom: bottoms.filter((r) => r.height > 0).reduce((m, r) => Math.max(m, clamp(view.bottom - r.top)), 0),
  };
}

/**
 * The zoom (scale k, translation x/y) that shows every point inside a
 * width x height view with `padding` around it (#267): the graph opens
 * fitted instead of wherever the simulation left it. With `insets` the graph
 * is fitted into the band between the top and bottom chrome (#594), keeping
 * OVERLAY_GAP clear of it, so the search box, the one-time tip and the legend
 * do not cover nodes. Chrome never claims more than MAX_CHROME_SHARE of the
 * height; beyond that the insets shrink proportionally.
 */
export function fitTransform(
  points: Point[],
  width: number,
  height: number,
  padding = 48,
  insets: Insets = { top: 0, bottom: 0 },
): { k: number; x: number; y: number } {
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
  // Each edge keeps `padding` from the view's edge, or clears the chrome on
  // it by OVERLAY_GAP, whichever is more.
  let coverTop = insets.top > 0 ? insets.top + OVERLAY_GAP : 0;
  let coverBottom = insets.bottom > 0 ? insets.bottom + OVERLAY_GAP : 0;
  if (coverTop + coverBottom > height * MAX_CHROME_SHARE) {
    const s = (height * MAX_CHROME_SHARE) / (coverTop + coverBottom);
    coverTop *= s;
    coverBottom *= s;
  }
  const top = Math.max(padding, coverTop);
  const bottom = Math.max(padding, coverBottom);
  const k = Math.min(
    MAX_FIT_SCALE,
    Math.max(MIN_FIT_SCALE, Math.min((width - padding * 2) / w, (height - top - bottom) / h)),
  );
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { k, x: width / 2 - k * cx, y: top + (height - top - bottom) / 2 - k * cy };
}

/** How many folder colours the theme defines (--graph-folder-1 ... -N). */
export const FOLDER_COLOR_COUNT = 10;

function hashSlot(folder: string): number {
  let hash = 0;
  for (let i = 0; i < folder.length; i++) hash = (hash * 31 + folder.charCodeAt(i)) | 0;
  return (Math.abs(hash) % FOLDER_COLOR_COUNT) + 1;
}

/** Distinct folder names (root "" left out), sorted case-insensitively. */
export function sortedFolders(folders: Iterable<string>): string[] {
  return [...new Set(folders)]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * A vault's colour slots (#593): its folders in sorted order get slots
 * 1..N, so no two share a colour while the palette lasts (hashing the name
 * put "Examples" and "Daily" on the same one). Folders beyond the palette
 * fall back to the name hash. Root notes ("") get no slot.
 */
export function folderColorSlots(folders: Iterable<string>): Map<string, number> {
  return new Map(sortedFolders(folders).map((folder, i) => [folder, i < FOLDER_COLOR_COUNT ? i + 1 : hashSlot(folder)]));
}

/**
 * A folder's colour slot (1-based); null for root notes. Reads `slots` from
 * folderColorSlots when given, else (or for a folder it lacks) hashes the name.
 */
export function folderColorIndex(folder: string, slots?: Map<string, number>): number | null {
  if (!folder) return null;
  return slots?.get(folder) ?? hashSlot(folder);
}

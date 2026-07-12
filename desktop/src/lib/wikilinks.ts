import type { Note } from "./types";

export interface GraphNode {
  id: string;
  title: string;
  connections: number;
  /** Top-level folder the note lives in ("" = root); used to colour nodes. */
  folder: string;
  /** Unresolved wiki-link target: the note does not exist (yet). Clicking creates it. */
  ghost?: boolean;
}

export interface GraphLink {
  source: string;
  target: string;
  /** Link into a ghost node (unresolved target); rendered dashed. */
  ghost?: boolean;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

const WIKI_LINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

export function extractLinks(content: string): string[] {
  const links: string[] = [];
  let match;
  while ((match = WIKI_LINK_RE.exec(content)) !== null) {
    const target = match[1].split("#")[0].trim();
    if (target && !links.includes(target)) {
      links.push(target);
    }
  }
  return links;
}

/**
 * Finds the graph node a search query means (#146): prefix matches beat
 * substring matches, real notes beat ghosts, better-connected nodes win ties.
 */
export function findGraphNode(nodes: GraphNode[], query: string): GraphNode | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const score = (n: GraphNode) => {
    const t = n.title.toLowerCase();
    if (!t.includes(q)) return -1;
    return (t.startsWith(q) ? 4 : 2) + (n.ghost ? 0 : 1);
  };
  let best: GraphNode | null = null;
  let bestScore = 0;
  for (const n of nodes) {
    const s = score(n);
    if (s > bestScore || (s === bestScore && s > 0 && n.connections > (best?.connections ?? -1))) {
      best = n;
      bestScore = s;
    }
  }
  return best;
}

export function buildGraphData(notes: Note[]): GraphData {
  const titleToId = new Map<string, string>();
  for (const note of notes) {
    titleToId.set(note.title.toLowerCase(), note.id);
  }

  const connectionCount = new Map<string, number>();
  const links: GraphLink[] = [];
  const seen = new Set<string>();
  // Unresolved targets become shared "ghost" nodes (#147): keyed by the
  // lowercased title, keeping the first-seen casing for create-on-click.
  const ghosts = new Map<string, string>();

  const countBoth = (a: string, b: string) => {
    connectionCount.set(a, (connectionCount.get(a) || 0) + 1);
    connectionCount.set(b, (connectionCount.get(b) || 0) + 1);
  };

  for (const note of notes) {
    const targets = extractLinks(note.content);
    for (const target of targets) {
      const targetId = titleToId.get(target.toLowerCase());
      if (targetId && targetId !== note.id) {
        const key = [note.id, targetId].sort().join("-");
        if (!seen.has(key)) {
          seen.add(key);
          links.push({ source: note.id, target: targetId });
          countBoth(note.id, targetId);
        }
      } else if (!targetId) {
        const ghostKey = target.toLowerCase();
        if (!ghosts.has(ghostKey)) ghosts.set(ghostKey, target);
        const ghostId = `ghost:${ghostKey}`;
        const key = `${note.id}-${ghostId}`;
        if (!seen.has(key)) {
          seen.add(key);
          links.push({ source: note.id, target: ghostId, ghost: true });
          countBoth(note.id, ghostId);
        }
      }
    }
  }

  const nodes: GraphNode[] = notes.map((n) => ({
    id: n.id,
    title: n.title,
    connections: connectionCount.get(n.id) || 0,
    folder: n.path ? n.path.split("/")[0] : "",
  }));

  for (const [key, title] of ghosts) {
    nodes.push({
      id: `ghost:${key}`,
      title,
      connections: connectionCount.get(`ghost:${key}`) || 0,
      folder: "",
      ghost: true,
    });
  }

  return { nodes, links };
}

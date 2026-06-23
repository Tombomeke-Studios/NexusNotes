import type { Note } from "./types";

export interface GraphNode {
  id: string;
  title: string;
  connections: number;
}

export interface GraphLink {
  source: string;
  target: string;
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

export function buildGraphData(notes: Note[]): GraphData {
  const titleToId = new Map<string, string>();
  for (const note of notes) {
    titleToId.set(note.title.toLowerCase(), note.id);
  }

  const connectionCount = new Map<string, number>();
  const links: GraphLink[] = [];
  const seen = new Set<string>();

  for (const note of notes) {
    const targets = extractLinks(note.content);
    for (const target of targets) {
      const targetId = titleToId.get(target.toLowerCase());
      if (targetId && targetId !== note.id) {
        const key = [note.id, targetId].sort().join("-");
        if (!seen.has(key)) {
          seen.add(key);
          links.push({ source: note.id, target: targetId });
          connectionCount.set(note.id, (connectionCount.get(note.id) || 0) + 1);
          connectionCount.set(targetId, (connectionCount.get(targetId) || 0) + 1);
        }
      }
    }
  }

  const nodes: GraphNode[] = notes.map((n) => ({
    id: n.id,
    title: n.title,
    connections: connectionCount.get(n.id) || 0,
  }));

  return { nodes, links };
}

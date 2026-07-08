export interface OutlineHeading {
  level: number;
  text: string;
  /** Position among all headings in document order; used for scroll targeting. */
  index: number;
}

const HEADING_RE = /^(#{1,4})\s+(.*)$/;

export function parseOutline(content: string): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  let inFence = false;
  let index = 0;
  for (const line of content.split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(HEADING_RE);
    if (m) {
      headings.push({ level: m[1].length, text: m[2].trim(), index: index++ });
    }
  }
  return headings;
}

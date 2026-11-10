export interface OutlineHeading {
  level: number;
  text: string;
  /** Position among all headings in document order; used for scroll targeting. */
  index: number;
  /** Where the heading's line starts in the text, for putting the caret on it. */
  offset: number;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * The note's headings in document order. The outline panel shows levels 1-4
 * (the default); a `[[Note#Heading]]` link may point at any level (#558).
 * Lines inside fenced code blocks (``` or ~~~) are not headings.
 */
export function parseOutline(content: string, maxLevel = 4): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  let fence = "";
  let index = 0;
  let offset = 0;
  for (const line of content.split("\n")) {
    const start = offset;
    offset += line.length + 1;
    const marker = line.match(FENCE_RE)?.[1];
    if (fence) {
      // Closed by a fence of the same character, at least as long.
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = "";
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }
    const m = line.match(HEADING_RE);
    if (m && m[1].length <= maxLevel) {
      // "## Title ##": closing hashes are not part of the text.
      const text = m[2].replace(/\s+#+\s*$/, "").trim();
      headings.push({ level: m[1].length, text, index: index++, offset: start });
    }
  }
  return headings;
}

/**
 * The anchor a heading gets, GitHub style: lower case, punctuation dropped,
 * spaces as dashes. `[jump](#my-heading)` links to "## My Heading" (#426).
 */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/**
 * The heading a link's `#section` part means (#558): the first one with that
 * text (case-insensitive), or else with the same slug, at any level. `index`
 * counts among all headings up to level 6.
 */
export function findHeading(content: string, section: string): OutlineHeading | null {
  const wanted = section.trim().toLowerCase();
  if (!wanted) return null;
  const all = parseOutline(content, 6);
  return (
    all.find((h) => h.text.toLowerCase() === wanted) ??
    all.find((h) => headingSlug(h.text) === headingSlug(wanted)) ??
    null
  );
}

/**
 * Which of the headings sharing `heading`'s slug it is (0 = the first), so
 * the rendered preview can find the same one whatever else it contains.
 */
export function slugOccurrence(headings: readonly OutlineHeading[], heading: OutlineHeading): number {
  const slug = headingSlug(heading.text);
  return headings.filter((h) => h.offset < heading.offset && headingSlug(h.text) === slug).length;
}

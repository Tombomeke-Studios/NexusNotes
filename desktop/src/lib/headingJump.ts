import { findHeading, headingSlug, parseOutline, slugOccurrence, type OutlineHeading } from "./outline";
import { measureTop } from "./textareaMeasure";

/**
 * Going to a heading of the open note: from the outline panel, a
 * `[[Note#Section]]` link or a `[[#Section]]` link (#558). The reading pane
 * scrolls to the heading; the source pane puts the caret on its line, so the
 * outline also works while only the source is shown.
 */
export interface HeadingRequest {
  noteId: string;
  /** A new nonce is a new request. */
  nonce: number;
  /** The heading's line start in the text (the outline panel)… */
  offset?: number;
  /** …or the section a link names. */
  section?: string;
}

/** Space left above a heading the panes scroll to. */
const TOP_GAP = 14;

/** The heading a request means in the given text, counted among all levels. */
export function requestedHeading(content: string, request: Pick<HeadingRequest, "offset" | "section">): OutlineHeading | null {
  if (request.section !== undefined) return findHeading(content, request.section);
  return parseOutline(content, 6).find((h) => h.offset === request.offset) ?? null;
}

/**
 * The rendered element of a heading: matched by its slug (the n-th of that
 * slug, as in the text), which holds whatever else the preview renders as a
 * heading; by position when the rendered text differs from the source.
 */
export function previewHeadingElement(preview: Element, content: string, heading: OutlineHeading): Element | null {
  const rendered = Array.from(preview.querySelectorAll("h1, h2, h3, h4, h5, h6"));
  const slug = headingSlug(heading.text);
  const nth = slugOccurrence(parseOutline(content, 6), heading);
  return rendered.filter((el) => headingSlug(el.textContent ?? "") === slug)[nth] ?? rendered[heading.index] ?? null;
}

/** Scrolls the reading pane so the element sits just below its top edge. */
export function scrollPreviewTo(preview: Element, el: Element): void {
  // No explicit behavior: the preview's CSS scroll-behavior makes it smooth,
  // or instant under reduced motion (#426).
  const top = preview.scrollTop + (el.getBoundingClientRect().top - preview.getBoundingClientRect().top) - TOP_GAP;
  if (typeof preview.scrollTo === "function") preview.scrollTo({ top });
  else preview.scrollTop = top;
}

/** Puts the caret at `offset` in the source pane and scrolls that line to the top. */
export function scrollSourceTo(ta: HTMLTextAreaElement, highlight: HTMLElement | null, offset: number): void {
  ta.setSelectionRange(offset, offset);
  ta.scrollTop = Math.max(0, measureTop(ta, offset) - TOP_GAP);
  if (highlight) highlight.scrollTop = ta.scrollTop;
}

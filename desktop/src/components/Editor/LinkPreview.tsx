import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { previewExcerpt } from "../../lib/linkPreview";
import type { Note } from "../../lib/types";

const GAP = 8;
const WIDTH = 340;

/**
 * Hover preview of a [[link]] target (#425), like Obsidian's page preview: the
 * note's title and opening text, placed under the link (or above it near the
 * bottom of the window). It fades in with a slight upward drift. Portalled to
 * the body: an animated ancestor's transform would otherwise become the
 * containing block of this fixed-position card and clip it.
 */
export function LinkPreview({ note, anchor }: { note: Note; anchor: DOMRect }) {
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [above, setAbove] = useState(false);
  const [clipped, setClipped] = useState(false);
  const excerpt = previewExcerpt(note.content, note.title);

  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 0;
    setAbove(anchor.bottom + GAP + height > window.innerHeight && anchor.top - GAP - height > 0);
    const body = bodyRef.current;
    setClipped(!!body && body.scrollHeight > body.clientHeight + 1);
  }, [anchor]);

  const left = Math.max(GAP, Math.min(anchor.left, window.innerWidth - WIDTH - GAP));
  const style = above
    ? { left, bottom: window.innerHeight - anchor.top + GAP }
    : { left, top: anchor.bottom + GAP };

  return createPortal(
    <div ref={ref} className="link-preview" role="tooltip" style={style}>
      <div className="link-preview-title">{note.title || "Untitled"}</div>
      {excerpt ? (
        <div ref={bodyRef} className={`link-preview-body${clipped ? " link-preview-body--clipped" : ""}`}>
          {excerpt}
        </div>
      ) : (
        <div className="link-preview-body link-preview-body--empty">This note is empty.</div>
      )}
    </div>,
    document.body,
  );
}

import { useEffect, useState } from "react";
import { attachments as attachmentsApi } from "../../lib/api";
import type { Attachment } from "../../lib/api";

interface AttachmentImageProps {
  /** Filename referenced by an `![[filename]]` embed. */
  name: string;
  alt: string;
  /** The current note's attachments, used to resolve the filename to an id. */
  list: Attachment[];
}

/**
 * Renders an `![[image]]` embed (#153): resolves the filename to one of the
 * note's attachments and loads its bytes with authentication as an object URL
 * (an <img src> can't send the bearer token itself).
 */
export function AttachmentImage({ name, alt, list }: AttachmentImageProps) {
  const match = list.find((a) => a.filename === name);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!match) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    attachmentsApi
      .objectUrl(match.id)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        objectUrl = u;
        setUrl(u);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [match]);

  if (!match || failed) {
    return <span className="attachment-missing">📎 {name}</span>;
  }
  if (!url) {
    return <span className="attachment-loading">Loading {name}…</span>;
  }
  return <img className="attachment-image" src={url} alt={alt || name} />;
}

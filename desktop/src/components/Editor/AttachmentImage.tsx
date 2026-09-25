import { useEffect, useState } from "react";
import { attachments as attachmentsApi, isInlineImageType } from "../../lib/api";
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
 * (an <img src> can't send the bearer token itself). Only raster images are
 * shown inline; anything else (an SVG, a PDF, opaque bytes) or an image that
 * fails to decode is shown as a download link instead of a broken image.
 */
export function AttachmentImage({ name, alt, list }: AttachmentImageProps) {
  const match = list.find((a) => a.filename === name);
  const inline = !!match && isInlineImageType(match.mime_type);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [undecodable, setUndecodable] = useState(false);

  useEffect(() => {
    if (!match || !inline) return;
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
  }, [match, inline]);

  if (!match || failed) {
    return <span className="attachment-missing">📎 {name}</span>;
  }
  if (!inline || undecodable) {
    return <AttachmentFileLink attachment={match} />;
  }
  if (!url) {
    return <span className="attachment-loading">Loading {name}…</span>;
  }
  return (
    <img className="attachment-image" src={url} alt={alt || name} onError={() => setUndecodable(true)} />
  );
}

/**
 * A non-image attachment: clicking downloads it. The blob comes from
 * attachments.objectUrl, so it is typed application/octet-stream and can only
 * ever be saved, never rendered as a document.
 */
function AttachmentFileLink({ attachment }: { attachment: Attachment }) {
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const url = await attachmentsApi.objectUrl(attachment.id);
      const a = document.createElement("a");
      a.href = url;
      a.download = attachment.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* leave the link in place so the user can retry */
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className="attachment-file"
      onClick={download}
      disabled={busy}
      title={`Download ${attachment.filename}`}
    >
      <span aria-hidden="true">📎</span> {attachment.filename}
    </button>
  );
}

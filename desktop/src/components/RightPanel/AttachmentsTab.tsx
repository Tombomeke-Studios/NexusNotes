import { useCallback, useEffect, useRef, useState } from "react";
import {
  attachmentObjectUrl,
  listAttachments,
  onAttachmentsChanged,
  removeAttachment,
  uploadAttachment,
} from "../../lib/attachmentClient";
import type { Attachment } from "../../lib/api";
import type { VaultLike } from "../../lib/vaultKeys";
import { toast } from "../../lib/toast";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const embedFor = (att: Attachment) => (att.mime_type.startsWith("image/") ? `![[${att.filename}]]` : `[[${att.filename}]]`);

/**
 * The open note's attachments in the right panel (#238): open, copy the embed,
 * upload, delete. In e2ee vaults names and bytes are decrypted on the device
 * (attachmentClient). Stays in step with uploads made in the editor.
 */
export function AttachmentsTab({ noteId, vault, canWrite }: { noteId: string; vault: VaultLike; canWrite: boolean }) {
  const [items, setItems] = useState<Attachment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    listAttachments(noteId, vault)
      .then((list) => {
        setItems(list);
        setError(null);
      })
      .catch(() => setError("Couldn't load this note's files."));
  }, [noteId, vault]);

  useEffect(() => {
    setItems(null);
    reload();
    return onAttachmentsChanged((changed) => {
      if (changed === noteId) reload();
    });
  }, [noteId, reload]);

  const open = async (att: Attachment) => {
    try {
      const url = await attachmentObjectUrl(att);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      toast(`Couldn't open ${att.filename}`, { kind: "error" });
    }
  };

  const copyEmbed = (att: Attachment) => {
    navigator.clipboard
      ?.writeText(embedFor(att))
      .then(() => toast(`Copied ${embedFor(att)}. Paste it into the note.`, { kind: "success", key: "copy-embed" }))
      .catch(() => toast("Couldn't copy the embed", { kind: "error", key: "copy-embed" }));
  };

  const upload = async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    try {
      for (const f of files) await uploadAttachment(noteId, f, vault);
      toast(`Uploaded ${files.length} file${files.length === 1 ? "" : "s"}. Copy an embed to show it in the note.`, {
        kind: "success",
      });
    } catch {
      toast("An upload failed. Check the file's type and size.", { kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (att: Attachment) => {
    setBusy(true);
    try {
      await removeAttachment(att);
      setConfirming(null);
    } catch {
      toast(`Couldn't delete ${att.filename}`, { kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="right-panel-body attachments-tab">
      <div className="attachments-head">
        <span className="right-panel-label">
          {items ? `${items.length} file${items.length === 1 ? "" : "s"}` : "Files"}
        </span>
        {canWrite && (
          <>
            <button className="attachments-upload" onClick={() => inputRef.current?.click()} disabled={busy}>
              Upload…
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                // Copied first: clearing the input empties its FileList.
                void upload(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </>
        )}
      </div>
      {error && <div className="right-panel-empty right-panel-empty--left">{error}</div>}
      {items?.length === 0 && (
        <div className="right-panel-empty right-panel-empty--left">
          No files attached. Drop or paste a file into the editor{canWrite ? ", or upload one here" : ""}.
        </div>
      )}
      <ul className="attachments-list">
        {items?.map((att) => (
          <li key={att.id} className="attachments-item">
            <button className="attachments-name" onClick={() => open(att)} title={`Open ${att.filename}`}>
              <span className="attachments-filename">{att.filename}</span>
              <span className="attachments-meta">
                {att.mime_type.split("/")[1] ?? att.mime_type} · {formatSize(att.size_bytes)}
              </span>
            </button>
            {confirming === att.id ? (
              <span className="attachments-confirm">
                <span>Delete? Embeds of it stop working.</span>
                <button className="attachments-danger" onClick={() => remove(att)} disabled={busy}>
                  Delete
                </button>
                <button onClick={() => setConfirming(null)}>Keep</button>
              </span>
            ) : (
              <span className="attachments-actions">
                <button onClick={() => copyEmbed(att)} aria-label={`Copy the embed for ${att.filename}`} title="Copy embed">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <rect x="5" y="5" width="9" height="9" rx="2" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" stroke="currentColor" strokeWidth="1.3" />
                  </svg>
                </button>
                {canWrite && (
                  <button onClick={() => setConfirming(att.id)} aria-label={`Delete ${att.filename}`} title="Delete">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.6 8.5h4.8l.6-8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

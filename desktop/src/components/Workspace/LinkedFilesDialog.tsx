import { useEffect, useRef, useState } from "react";
import { links as linksApi, type LinkedFile, type LinkedContent } from "../../lib/api";
import type { Vault } from "../../lib/types";
import "./LinkedFilesDialog.css";

interface LinkedFilesDialogProps {
  vault: Vault;
  /** True when the current user may add/remove links (owner/editor). */
  canWrite: boolean;
  onClose: () => void;
}

/**
 * Linked files panel (#60-64): references external files into a vault without
 * copying them. URL links are fetched fresh on open (read-only) and each user
 * keeps their own annotations, stored separately so re-syncing the source
 * never overwrites them (#64).
 *
 * Local-directory linking and on-disk change watching (#60/#61/#63) need
 * native filesystem access and land in the packaged desktop app.
 */
export function LinkedFilesDialog({ vault, canWrite, onClose }: LinkedFilesDialogProps) {
  const [list, setList] = useState<LinkedFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<LinkedFile | null>(null);

  const reload = () =>
    linksApi.list(vault.id).then(setList).catch(() => setError("Could not load linked files"));
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault.id]);

  const addUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    const ref = url.trim();
    if (!ref || busy) return;
    if (!/^https?:\/\//i.test(ref)) {
      setError("Enter a full http(s) URL.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await linksApi.create(vault.id, {
        display_name: name.trim() || ref,
        source_type: "url",
        source_ref: ref,
      });
      setName("");
      setUrl("");
      await reload();
    } catch {
      setError("Couldn't add that link.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (link: LinkedFile) => {
    try {
      await linksApi.remove(vault.id, link.id);
      if (open?.id === link.id) setOpen(null);
      await reload();
    } catch {
      setError("Couldn't remove that link.");
    }
  };

  return (
    <div className="confirm-overlay" onClick={onClose}>
      <div
        className="confirm-dialog links-dialog"
        role="dialog"
        aria-label={`Linked files in ${vault.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        {open ? (
          <LinkedViewer link={open} onBack={() => setOpen(null)} />
        ) : (
          <>
            <div className="confirm-title">Linked files</div>
            <p className="links-note">
              Links point at the original file — NexusNotes never copies or changes it.
            </p>

            {canWrite && (
              <form className="links-add" onSubmit={addUrl}>
                <input
                  className="enc-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name (optional)"
                  autoComplete="off"
                />
                <input
                  className="enc-input"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/page"
                  autoComplete="off"
                />
                <button className="confirm-btn confirm-btn--primary" disabled={!url.trim() || busy}>
                  Link URL
                </button>
              </form>
            )}

            {error && <div className="enc-error">{error}</div>}

            <div className="links-list">
              {list?.length === 0 && <div className="links-empty">No linked files yet.</div>}
              {list?.map((l) => (
                <div key={l.id} className="links-row">
                  <button className="links-open" onClick={() => setOpen(l)} title={l.source_ref}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <path d="M6.5 9.5l3-3M7 4.5l.8-.8a2.4 2.4 0 013.5 3.4l-.9.9M9 11.5l-.8.8a2.4 2.4 0 01-3.5-3.4l.9-.9"
                        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                    <span className="links-name">{l.display_name}</span>
                    <span className="links-type">{l.source_type === "url" ? "URL" : l.source_type}</span>
                  </button>
                  {canWrite && (
                    <button className="share-remove" title="Remove link" onClick={() => remove(l)}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="confirm-actions">
              <button className="confirm-btn" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Read-only viewer for a linked file, with the current user's annotation (#64). */
function LinkedViewer({ link, onBack }: { link: LinkedFile; onBack: () => void }) {
  const [content, setContent] = useState<LinkedContent | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [annotation, setAnnotation] = useState("");
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    setContent(null);
    setLoadErr(null);
    if (link.source_type === "url") {
      linksApi.content(link.id).then(setContent).catch(() => setLoadErr("Couldn't fetch the source."));
    } else {
      setLoadErr("This link opens in the native app.");
    }
    linksApi.getAnnotation(link.id).then((a) => setAnnotation(a.content)).catch(() => {});
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [link.id, link.source_type]);

  const onAnnotate = (value: string) => {
    setAnnotation(value);
    setSavedNote(null);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      linksApi
        .saveAnnotation(link.id, value)
        .then(() => setSavedNote("Saved"))
        .catch(() => setSavedNote("Save failed"));
    }, 600);
  };

  return (
    <div className="linkview">
      <div className="linkview-head">
        <button className="linkview-back" onClick={onBack} title="Back">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M10 3l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="linkview-title" title={link.source_ref}>{link.display_name}</span>
        <span className="linkview-ro">Linked — original not modified</span>
      </div>

      <div className="linkview-body">
        {loadErr && <div className="links-empty">{loadErr}</div>}
        {!loadErr && !content && <div className="links-empty">Loading…</div>}
        {content && <pre className="linkview-content">{content.content}</pre>}
      </div>

      <div className="linkview-annotate">
        <div className="linkview-annotate-head">
          <span>Your notes</span>
          {savedNote && <span className="linkview-saved">{savedNote}</span>}
        </div>
        <textarea
          className="linkview-annotate-input"
          value={annotation}
          onChange={(e) => onAnnotate(e.target.value)}
          placeholder="Private annotations — kept even when the source changes"
        />
      </div>
    </div>
  );
}

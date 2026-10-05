import { headingSlug } from "../../lib/outline";
import { highlightMarkdown } from "../../lib/mdHighlight";
import { LinkPreview } from "./LinkPreview";
import { useState, useRef, useEffect, useCallback, useMemo, Fragment } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import go from "highlight.js/lib/languages/go";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import css from "highlight.js/lib/languages/css";
import sql from "highlight.js/lib/languages/sql";
import yaml from "highlight.js/lib/languages/yaml";
import xml from "highlight.js/lib/languages/xml";
import markdown from "highlight.js/lib/languages/markdown";
import type { Note } from "../../lib/types";
import type { ViewMode } from "../../lib/prefs";
import { cursorPosition } from "../../lib/stats";
import { toggleTask } from "../../lib/tasks";
import { remarkWikilinks } from "../../lib/remarkWikilinks";
import { remarkTags } from "../../lib/remarkTags";
import { remarkImageEmbeds } from "../../lib/remarkImageEmbeds";
import { remarkCallouts } from "../../lib/remarkCallouts";
import { wikiUrlTransform } from "../../lib/markdownUrls";
import { ApiError, type Attachment } from "../../lib/api";
import { listAttachments, uploadAttachment, onAttachmentsChanged } from "../../lib/attachmentClient";
import { AttachmentImage } from "./AttachmentImage";
import "./Editor.css";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("go", go);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("json", json);
hljs.registerLanguage("css", css);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);

interface EditorProps {
  note: Note | null;
  notes: Note[];
  mode: ViewMode;
  fontSize?: number;
  splitPct?: number;
  onSplitPctChange?: (pct: number) => void;
  onModeChange: (mode: ViewMode) => void;
  onCursorChange?: (line: number, col: number) => void;
  onLiveChange?: (content: string) => void;
  onTagClick?: (tag: string) => void;
  onSave: (content: string) => void;
  onRename: (title: string) => void;
  onRenameCommit: (title: string) => void;
  onCreateNote: (title: string) => void;
  onNavigateToNote: (noteId: string) => void;
  /** Suspend autosave (e.g. while a close-confirmation dialog is open). */
  paused?: boolean;
  /** Bump the nonce to insert text at the cursor (template insertion, #155). */
  insertRequest?: { text: string; nonce: number } | null;
  /**
   * Bump the nonce to replace the open note's text from outside: another
   * device's version, or a resolved conflict (#324, #225). The caller already
   * holds the text, so it is not reported back through onLiveChange.
   */
  replaceRequest?: ReplaceRequest | null;
  /** The editor now shows a replacement's text. */
  onReplaceApplied?: (request: ReplaceRequest) => void;
  /** The text changed after the replacement was requested; it was not applied. */
  onReplaceRejected?: (request: ReplaceRequest) => void;
  /** Called with true when the editor mounts and false when it unmounts. */
  onPresenceChange?: (present: boolean) => void;
  /**
   * The open note's text as the app holds it, unsaved edits included. The
   * editor starts from it when it mounts and when the note changes; the note
   * object itself only carries the last loaded or saved text.
   */
  initialText?: string;
  /** Non-null when files cannot be attached in this vault; shown instead of uploading. */
  attachmentBlockReason?: string | null;
  /** The note's vault: files in an e2ee vault are encrypted on this device (#238). */
  vault?: { id: string; encryption?: "none" | "e2ee" } | null;
  /**
   * True while another note is being created (#403): the open note is about
   * to be replaced, so what is typed now must not land in it.
   */
  readOnly?: boolean;
  /** Bumped each time a save of this note completes; the title flashes (#430). */
  savedFlash?: number;
}

export interface ReplaceRequest {
  noteId: string;
  text: string;
  nonce: number;
  /**
   * The text the caller means to replace. When the editor holds anything else
   * by the time the request arrives (a keystroke in between), it keeps its
   * text and reports the request as rejected. Omitted: always replace.
   */
  expected?: string;
}

export function Editor({
  note,
  notes,
  mode,
  fontSize = 14,
  splitPct = 52,
  onSplitPctChange,
  onModeChange,
  onCursorChange,
  onLiveChange,
  onTagClick,
  onSave,
  onRename,
  onRenameCommit,
  onCreateNote,
  onNavigateToNote,
  paused = false,
  insertRequest = null,
  replaceRequest = null,
  onReplaceApplied,
  onReplaceRejected,
  onPresenceChange,
  initialText,
  attachmentBlockReason = null,
  vault = null,
  readOnly = false,
  savedFlash = 0,
}: EditorProps) {
  // A completed save flashes the title once (#430); cleared when it ends.
  const [titleFlash, setTitleFlash] = useState(false);
  useEffect(() => {
    if (savedFlash > 0) setTitleFlash(true);
  }, [savedFlash]);
  const [content, setContent] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  const [splitDragging, setSplitDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // The current note's attachments, for resolving ![[image]] embeds (#153).
  const [attachmentList, setAttachmentList] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  // Why the last drop/paste could not be attached (blocked vault or a failed upload).
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const blockReasonRef = useRef(attachmentBlockReason);
  blockReasonRef.current = attachmentBlockReason;
  const vaultRef = useRef(vault);
  vaultRef.current = vault;
  // The notice is hidden while further files upload, so its 4s only start
  // counting once the upload batch has finished.
  useEffect(() => {
    if (!uploadNotice || uploading) return;
    const t = setTimeout(() => setUploadNotice(null), 4000);
    return () => clearTimeout(t);
  }, [uploadNotice, uploading]);
  const contentRowRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const highlighted = useMemo(() => highlightMarkdown(content), [content]);
  // [[link]] hover preview (#425): opens after a short hover, like a tooltip.
  const [hoverLink, setHoverLink] = useState<{ noteId: string; rect: DOMRect } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showLinkPreview = useCallback((noteId: string, el: HTMLElement, delay: number) => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHoverLink({ noteId, rect: el.getBoundingClientRect() }), delay);
  }, []);
  const hideLinkPreview = useCallback(() => {
    clearTimeout(hoverTimer.current);
    setHoverLink(null);
  }, []);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const onSaveRef = useRef(onSave);
  const contentRef = useRef(content);
  const prevNoteIdRef = useRef<string | null>(null);

  onSaveRef.current = onSave;
  contentRef.current = content;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const noteRef = useRef(note);
  noteRef.current = note;
  const initialTextRef = useRef(initialText);
  initialTextRef.current = initialText;

  const notesByTitle = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of notes) {
      map.set(n.title.toLowerCase(), n.id);
    }
    return map;
  }, [notes]);

  useEffect(() => {
    if (note && note.id !== prevNoteIdRef.current) {
      // Drop any pending autosave for the previous note so it can't fire against
      // the newly opened one (its content is safe in its own draft).
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = undefined;
      }
      setContent(initialTextRef.current ?? note.content);
      setHasChanges(false);
      prevNoteIdRef.current = note.id;
    }
  }, [note]);

  // A request made before this editor mounted is already reflected in the
  // note it opens with (e.g. back from the graph view); never apply it again.
  const prevReplaceNonceRef = useRef(replaceRequest?.nonce ?? 0);
  const onReplaceAppliedRef = useRef(onReplaceApplied);
  onReplaceAppliedRef.current = onReplaceApplied;
  const onReplaceRejectedRef = useRef(onReplaceRejected);
  onReplaceRejectedRef.current = onReplaceRejected;
  // The caller routes outside text differently while no editor is on screen.
  const onPresenceChangeRef = useRef(onPresenceChange);
  onPresenceChangeRef.current = onPresenceChange;
  useEffect(() => {
    onPresenceChangeRef.current?.(true);
    return () => onPresenceChangeRef.current?.(false);
  }, []);
  useEffect(() => {
    if (!replaceRequest || replaceRequest.nonce === prevReplaceNonceRef.current) return;
    prevReplaceNonceRef.current = replaceRequest.nonce;
    const otherNote = noteRef.current?.id !== replaceRequest.noteId;
    if (otherNote || (replaceRequest.expected !== undefined && contentRef.current !== replaceRequest.expected)) {
      onReplaceRejectedRef.current?.(replaceRequest);
      return;
    }
    // A pending autosave holds the replaced text; it must not go out.
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
    }
    setContent(replaceRequest.text);
    contentRef.current = replaceRequest.text;
    setHasChanges(false);
    onReplaceAppliedRef.current?.(replaceRequest);
  }, [replaceRequest]);

  // Load the note's attachments so ![[image]] embeds resolve (#153).
  useEffect(() => {
    if (!note) {
      setAttachmentList([]);
      return;
    }
    if (!vaultRef.current) return;
    let active = true;
    const load = () => {
      if (!vaultRef.current) return;
      listAttachments(note.id, vaultRef.current)
        .then((list) => active && setAttachmentList(list))
        .catch(() => active && setAttachmentList([]));
    };
    load();
    // The Files panel (#238) uploads and deletes too.
    const unsubscribe = onAttachmentsChanged((noteId) => {
      if (noteId === note.id) load();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [note]);

  const reportCursor = (el: HTMLTextAreaElement) => {
    if (!onCursorChange || typeof el.selectionStart !== "number") return;
    const { line, col } = cursorPosition(el.value, el.selectionStart);
    onCursorChange(line, col);
  };

  // Uploads dropped/pasted files to the current note and inserts an embed for
  // each at the cursor: images as `![[name]]`, other files as `[[name]]` (#153).
  const uploadFiles = useCallback(async (files: File[]) => {
    const current = noteRef.current;
    if (!current || files.length === 0) return;
    if (blockReasonRef.current) {
      setUploadNotice(blockReasonRef.current);
      return;
    }
    setUploading(true);
    try {
      for (const file of files) {
        try {
          if (!vaultRef.current) throw new Error("vault not loaded");
          const att = await uploadAttachment(current.id, file, vaultRef.current);
          setAttachmentList((prev) => [...prev, att]);
          const embed = att.mime_type.startsWith("image/") ? `![[${att.filename}]]` : `[[${att.filename}]]`;
          const el = textareaRef.current;
          const value = contentRef.current;
          const at = el && typeof el.selectionStart === "number" ? el.selectionStart : value.length;
          const insert = (at > 0 && value[at - 1] !== "\n" ? "\n" : "") + embed + "\n";
          const next = value.slice(0, at) + insert + value.slice(at);
          handleChangeRef.current(next);
          requestAnimationFrame(() => {
            if (!el) return;
            const caret = at + insert.length;
            el.focus();
            el.setSelectionRange(caret, caret);
          });
        } catch (err) {
          // Keep going with the other files, but say why this one was skipped.
          setUploadNotice(
            err instanceof ApiError ? `${file.name}: ${err.message}` : `${file.name} could not be uploaded.`,
          );
        }
      }
    } finally {
      setUploading(false);
    }
  }, []);

  const handleChange = useCallback(
    (value: string) => {
      setContent(value);
      setHasChanges(true);
      onLiveChange?.(value);

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      if (pausedRef.current) return; // don't autosave while a close dialog is open
      saveTimerRef.current = setTimeout(() => {
        onSaveRef.current(value);
        setHasChanges(false);
      }, 1000);
    },
    [onLiveChange],
  );
  const handleChangeRef = useRef(handleChange);
  handleChangeRef.current = handleChange;

  // Template insertion (#155): splice the text in at the cursor (replacing a
  // selection if any) and route it through handleChange so the dirty flag,
  // live-change mirror and debounced autosave all behave like typing.
  const prevInsertNonceRef = useRef(0);
  useEffect(() => {
    if (!insertRequest || insertRequest.nonce === prevInsertNonceRef.current) return;
    prevInsertNonceRef.current = insertRequest.nonce;
    const el = textareaRef.current;
    const current = contentRef.current;
    const start = el && typeof el.selectionStart === "number" ? el.selectionStart : current.length;
    const end = el && typeof el.selectionEnd === "number" ? el.selectionEnd : start;
    handleChange(current.slice(0, start) + insertRequest.text + current.slice(end));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const caret = start + insertRequest.text.length;
      el.setSelectionRange(caret, caret);
      reportCursor(el);
    });
    // reportCursor is stable per render; handleChange covers the callbacks used.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insertRequest, handleChange]);

  // Cancel any pending autosave the moment we pause (close dialog opened), so a
  // "Close without saving" isn't undone by a save firing underneath it.
  useEffect(() => {
    if (paused && saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
    }
  }, [paused]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        onSaveRef.current(contentRef.current);
        setHasChanges(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!splitDragging) return;
    const onMove = (e: PointerEvent) => {
      const row = contentRowRef.current;
      if (!row || !onSplitPctChange) return;
      const rect = row.getBoundingClientRect();
      const pct = Math.min(75, Math.max(25, ((e.clientX - rect.left) / rect.width) * 100));
      onSplitPctChange(pct);
    };
    const onUp = () => {
      setSplitDragging(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [splitDragging, onSplitPctChange]);

  const handleTaskToggle = useCallback(
    (target: HTMLInputElement) => {
      const preview = previewRef.current;
      if (!preview) return;
      const boxes = Array.from(preview.querySelectorAll('input[type="checkbox"]'));
      const idx = boxes.indexOf(target);
      if (idx < 0) return;
      const next = toggleTask(contentRef.current, idx);
      if (next !== contentRef.current) handleChange(next);
    },
    [handleChange],
  );

  const renderCheckbox = useCallback(
    (props: React.InputHTMLAttributes<HTMLInputElement>) => {
      if (props.type !== "checkbox") return <input {...props} />;
      return (
        <input
          type="checkbox"
          checked={props.checked ?? false}
          onChange={(e) => handleTaskToggle(e.currentTarget)}
          className="task-checkbox"
        />
      );
    },
    [handleTaskToggle],
  );

  const renderCode = useCallback(
    ({ className, children, ...rest }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) => {
      const match = /language-(\w+)/.exec(className || "");
      const code = String(children).replace(/\n$/, "");
      if (match && hljs.getLanguage(match[1])) {
        const highlighted = hljs.highlight(code, { language: match[1] });
        return (
          <code
            {...rest}
            className={className}
            dangerouslySetInnerHTML={{ __html: highlighted.value }}
          />
        );
      }
      return <code {...rest} className={className}>{children}</code>;
    },
    [],
  );

  const renderPre = useCallback(
    ({ children, ...rest }: React.HTMLAttributes<HTMLPreElement> & { children?: React.ReactNode }) => {
      // Extract the fenced language from the child <code class="language-xxx">
      const child = children as { props?: { className?: string } } | undefined;
      const lang = /language-(\w+)/.exec(child?.props?.className || "")?.[1];
      return (
        <div className="code-block">
          {lang && <span className="code-lang">{lang}</span>}
          <pre {...rest}>{children}</pre>
        </div>
      );
    },
    [],
  );

  // Renders an ![[image]] embed (attachment:// url) via the authenticated
  // loader; falls back to a normal <img> for ordinary markdown images (#153).
  const renderImage = useCallback(
    ({ src, alt }: React.ImgHTMLAttributes<HTMLImageElement>) => {
      const url = typeof src === "string" ? src : "";
      if (url.startsWith("attachment://")) {
        const name = decodeURIComponent(url.slice("attachment://".length));
        return <AttachmentImage name={name} alt={alt ?? ""} list={attachmentList} />;
      }
      return <img className="attachment-image" src={url} alt={alt ?? ""} />;
    },
    [attachmentList],
  );

  const renderAnchor = useCallback(
    ({ href, children }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode }) => {
      if (href?.startsWith("tag://")) {
        const tag = decodeURIComponent(href.slice("tag://".length));
        return (
          <button
            className="preview-tag"
            onClick={() => onTagClick?.(tag)}
            title={`Filter by #${tag}`}
          >
            {children}
          </button>
        );
      }
      if (href?.startsWith("wikilink://")) {
        const raw = href.slice("wikilink://".length);
        const hashIdx = raw.indexOf("#");
        const title = decodeURIComponent(hashIdx >= 0 ? raw.slice(0, hashIdx) : raw);
        const targetId = notesByTitle.get(title.toLowerCase());
        if (targetId) {
          return (
            <button
              className="wikilink wikilink--resolved"
              onClick={() => {
                hideLinkPreview();
                onNavigateToNote(targetId);
              }}
              onMouseEnter={(e) => showLinkPreview(targetId, e.currentTarget, 350)}
              onMouseLeave={hideLinkPreview}
              onFocus={(e) => showLinkPreview(targetId, e.currentTarget, 0)}
              onBlur={hideLinkPreview}
              aria-label={`Open ${title}`}
            >
              {children}
            </button>
          );
        }
        return (
          <button
            className="wikilink wikilink--unresolved"
            onClick={() => onCreateNote(title)}
            title={`Create note: ${title}`}
          >
            {children}
          </button>
        );
      }
      if (href?.startsWith("#")) {
        // A heading in this note (#426): scroll the preview to it; the
        // preview's scroll-behavior makes that smooth unless motion is reduced.
        return (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              let slug = href.slice(1);
              try {
                slug = decodeURIComponent(slug);
              } catch {
                /* keep it as written */
              }
              const heading = Array.from(previewRef.current?.querySelectorAll("h1, h2, h3, h4, h5, h6") ?? []).find(
                (h) => headingSlug(h.textContent ?? "") === slug.toLowerCase(),
              );
              heading?.scrollIntoView({ block: "start" });
            }}
          >
            {children}
          </a>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    },
    [notesByTitle, onNavigateToNote, onCreateNote, onTagClick, showLinkPreview, hideLinkPreview],
  );

  if (!note) {
    return (
      <div className="editor-empty">
        <div className="editor-empty-icon">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect x="8" y="6" width="32" height="36" rx="3" stroke="var(--text-muted)" strokeWidth="2" />
            <path d="M16 16h16M16 22h12M16 28h8" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <p>Select a note or create a new one</p>
        <p className="editor-empty-hint">
          Ctrl+N to create &middot; Ctrl+P to search
        </p>
      </div>
    );
  }

  return (
    <div className="editor">
      <div className="editor-toolbar">
        <input
          className={`editor-title-input${titleFlash ? " editor-title-input--flash" : ""}`}
          onAnimationEnd={() => setTitleFlash(false)}
          value={note.title}
          readOnly={readOnly}
          onChange={(e) => onRename(e.target.value)}
          onBlur={(e) => onRenameCommit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          placeholder="Untitled"
        />
        <div className="editor-toolbar-right">
          {hasChanges && <span className="editor-unsaved">Edited</span>}
          <div className="editor-mode-toggle">
            <button
              className={mode === "edit" ? "active" : ""}
              onClick={() => onModeChange("edit")}
              title="Source only"
            >
              Edit
            </button>
            <button
              className={mode === "split" ? "active" : ""}
              onClick={() => onModeChange("split")}
              title="Side by side"
            >
              Split
            </button>
            <button
              className={mode === "preview" ? "active" : ""}
              onClick={() => onModeChange("preview")}
              title="Reading view"
            >
              Read
            </button>
          </div>
        </div>
      </div>
      <div
        ref={contentRowRef}
        key={note.id}
        className={`editor-content editor-content--${mode}`}
      >
        {(mode === "edit" || mode === "split") && (
          <div
            className="editor-source"
            style={{
              width: mode === "split" ? `${splitPct}%` : "100%",
              flex: mode === "split" ? "0 0 auto" : "1 1 auto",
            }}
          >
          {/* Syntax highlighting (#267): the same text, styled, behind the
              transparent textarea, scrolled along with it. */}
          {highlighted && (
            <pre ref={highlightRef} className="editor-highlight" aria-hidden="true" style={{ fontSize }}>
              {highlighted.map((line, i) => (
                <Fragment key={i}>
                  {line.map((seg, j) =>
                    seg.cls ? (
                      <span key={j} className={seg.cls}>
                        {seg.text}
                      </span>
                    ) : (
                      seg.text
                    ),
                  )}
                  {"\n"}
                </Fragment>
              ))}
              {" "}
            </pre>
          )}
          <textarea
            ref={textareaRef}
            className={`editor-textarea${highlighted ? " editor-textarea--highlighted" : ""}`}
            readOnly={readOnly}
            style={{ fontSize }}
            value={content}
            onScroll={(e) => {
              if (highlightRef.current) highlightRef.current.scrollTop = e.currentTarget.scrollTop;
            }}
            onChange={(e) => {
              handleChange(e.target.value);
              reportCursor(e.target);
            }}
            onSelect={(e) => reportCursor(e.currentTarget)}
            onClick={(e) => reportCursor(e.currentTarget)}
            onKeyUp={(e) => reportCursor(e.currentTarget)}
            onDrop={(e) => {
              const files = Array.from(e.dataTransfer.files);
              if (files.length > 0) {
                e.preventDefault();
                uploadFiles(files);
              }
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length > 0) {
                e.preventDefault();
                uploadFiles(files);
              }
            }}
            spellCheck={false}
            placeholder="Start writing..."
          />
          </div>
        )}
        {uploading && (
          <div className="editor-uploading">Uploading…</div>
        )}
        {!uploading && uploadNotice && (
          <div className="editor-uploading editor-uploading--notice" role="status">
            {uploadNotice}
          </div>
        )}
        {mode === "split" && (
          <div
            className={`editor-split-handle${splitDragging ? " editor-split-handle--dragging" : ""}`}
            onPointerDown={(e) => {
              e.preventDefault();
              document.body.style.userSelect = "none";
              document.body.style.cursor = "col-resize";
              setSplitDragging(true);
            }}
          >
            <div className="editor-split-line" />
          </div>
        )}
        {(mode === "preview" || mode === "split") && (
          <div ref={previewRef} className="editor-preview markdown-body" style={{ fontSize }} onScroll={hoverLink ? hideLinkPreview : undefined}>
            <div className="markdown-body-inner">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkImageEmbeds, remarkWikilinks, remarkTags, remarkCallouts]}
                components={{ code: renderCode, pre: renderPre, a: renderAnchor, input: renderCheckbox, img: renderImage }}
                urlTransform={wikiUrlTransform}
              >
                {content}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
      {hoverLink && (() => {
        const target = notes.find((n) => n.id === hoverLink.noteId);
        return target ? <LinkPreview key={hoverLink.noteId} note={target} anchor={hoverLink.rect} /> : null;
      })()}
    </div>
  );
}

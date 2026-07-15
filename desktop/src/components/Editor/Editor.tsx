import { useState, useRef, useEffect, useCallback, useMemo } from "react";
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
import { attachments as attachmentsApi, type Attachment } from "../../lib/api";
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
}: EditorProps) {
  const [content, setContent] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  const [splitDragging, setSplitDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // The current note's attachments, for resolving ![[image]] embeds (#153).
  const [attachmentList, setAttachmentList] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const contentRowRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
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
      setContent(note.content);
      setHasChanges(false);
      prevNoteIdRef.current = note.id;
    }
  }, [note]);

  // Load the note's attachments so ![[image]] embeds resolve (#153).
  useEffect(() => {
    if (!note) {
      setAttachmentList([]);
      return;
    }
    let active = true;
    attachmentsApi
      .list(note.id)
      .then((list) => active && setAttachmentList(list))
      .catch(() => active && setAttachmentList([]));
    return () => {
      active = false;
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
    setUploading(true);
    try {
      for (const file of files) {
        try {
          const att = await attachmentsApi.upload(current.id, file);
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
        } catch {
          /* skip a file that failed to upload */
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
              onClick={() => onNavigateToNote(targetId)}
              title={`Open: ${title}`}
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
      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    },
    [notesByTitle, onNavigateToNote, onCreateNote, onTagClick],
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
          className="editor-title-input"
          value={note.title}
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
          <textarea
            ref={textareaRef}
            className="editor-textarea"
            style={{
              fontSize,
              width: mode === "split" ? `${splitPct}%` : "100%",
              flex: mode === "split" ? "0 0 auto" : "1 1 auto",
            }}
            value={content}
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
        )}
        {uploading && (
          <div className="editor-uploading">Uploading…</div>
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
          <div ref={previewRef} className="editor-preview markdown-body" style={{ fontSize }}>
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
    </div>
  );
}

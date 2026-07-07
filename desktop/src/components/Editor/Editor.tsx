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
  onCreateNote: (title: string) => void;
  onNavigateToNote: (noteId: string) => void;
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
  onCreateNote,
  onNavigateToNote,
}: EditorProps) {
  const [content, setContent] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  const [splitDragging, setSplitDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentRowRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const onSaveRef = useRef(onSave);
  const contentRef = useRef(content);
  const prevNoteIdRef = useRef<string | null>(null);

  onSaveRef.current = onSave;
  contentRef.current = content;

  const notesByTitle = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of notes) {
      map.set(n.title.toLowerCase(), n.id);
    }
    return map;
  }, [notes]);

  useEffect(() => {
    if (note && note.id !== prevNoteIdRef.current) {
      setContent(note.content);
      setHasChanges(false);
      prevNoteIdRef.current = note.id;
    }
  }, [note]);

  const reportCursor = (el: HTMLTextAreaElement) => {
    if (!onCursorChange || typeof el.selectionStart !== "number") return;
    const { line, col } = cursorPosition(el.value, el.selectionStart);
    onCursorChange(line, col);
  };

  const handleChange = useCallback(
    (value: string) => {
      setContent(value);
      setHasChanges(true);
      onLiveChange?.(value);

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        onSaveRef.current(value);
        setHasChanges(false);
      }, 1000);
    },
    [onLiveChange],
  );

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
            spellCheck={false}
            placeholder="Start writing..."
          />
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
                remarkPlugins={[remarkGfm, remarkWikilinks, remarkTags]}
                components={{ code: renderCode, a: renderAnchor, input: renderCheckbox }}
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

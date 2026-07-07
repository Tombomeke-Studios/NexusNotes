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
import { remarkWikilinks } from "../../lib/remarkWikilinks";
import { wikiUrlTransform } from "../../lib/markdownUrls";
import { BacklinksPanel } from "./BacklinksPanel";
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
  onSave: (content: string) => void;
  onRename: (title: string) => void;
  onCreateNote: (title: string) => void;
  onNavigateToNote: (noteId: string) => void;
}

type ViewMode = "edit" | "preview" | "split";

export function Editor({
  note,
  notes,
  onSave,
  onRename,
  onCreateNote,
  onNavigateToNote,
}: EditorProps) {
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<ViewMode>("split");
  const [hasChanges, setHasChanges] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  const handleChange = (value: string) => {
    setContent(value);
    setHasChanges(true);

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      onSaveRef.current(value);
      setHasChanges(false);
    }, 1000);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        onSaveRef.current(contentRef.current);
        setHasChanges(false);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "e") {
        e.preventDefault();
        setMode((m) =>
          m === "edit" ? "preview" : m === "preview" ? "split" : "edit",
        );
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

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
    [notesByTitle, onNavigateToNote, onCreateNote],
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
          {hasChanges && <span className="editor-unsaved">Unsaved</span>}
          <div className="editor-mode-toggle">
            <button
              className={mode === "edit" ? "active" : ""}
              onClick={() => setMode("edit")}
            >
              Edit
            </button>
            <button
              className={mode === "split" ? "active" : ""}
              onClick={() => setMode("split")}
            >
              Split
            </button>
            <button
              className={mode === "preview" ? "active" : ""}
              onClick={() => setMode("preview")}
            >
              Preview
            </button>
          </div>
        </div>
      </div>
      <div className={`editor-content editor-content--${mode}`}>
        {(mode === "edit" || mode === "split") && (
          <textarea
            ref={textareaRef}
            className="editor-textarea"
            value={content}
            onChange={(e) => handleChange(e.target.value)}
            spellCheck={false}
            placeholder="Start writing..."
          />
        )}
        {(mode === "preview" || mode === "split") && (
          <div className="editor-preview markdown-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkWikilinks]}
              components={{ code: renderCode, a: renderAnchor }}
              urlTransform={wikiUrlTransform}
            >
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>
      <BacklinksPanel noteId={note.id} onNavigate={onNavigateToNote} />
    </div>
  );
}

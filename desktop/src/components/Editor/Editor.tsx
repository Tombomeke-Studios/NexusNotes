import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Note } from "../../lib/types";
import "./Editor.css";

interface EditorProps {
  note: Note | null;
  onSave: (content: string) => void;
}

type ViewMode = "edit" | "preview" | "split";

export function Editor({ note, onSave }: EditorProps) {
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

  if (!note) {
    return (
      <div className="editor-empty">
        <div className="editor-empty-icon">&#128221;</div>
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
        <span className="editor-title">{note.title}</span>
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
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

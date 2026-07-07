import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Sidebar } from "./components/Sidebar";
import { Editor } from "./components/Editor";
import { QuickSwitcher, GlobalSearch } from "./components/Search";
import { GraphView } from "./components/Graph";
import { CommandPalette } from "./components/CommandPalette";
import { StatusBar } from "./components/StatusBar";
import { Auth } from "./components/Auth";
import { vaults as vaultsApi, notes as notesApi, getToken, auth } from "./lib/api";
import { syncClient } from "./lib/sync";
import { buildTree } from "./lib/tree";
import { buildGraphData } from "./lib/wikilinks";
import { buildTagCounts, extractTags } from "./lib/tags";
import type { User, Vault, Note } from "./lib/types";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [vaultList, setVaultList] = useState<Vault[]>([]);
  const [activeVaultId, setActiveVaultId] = useState<string | null>(null);
  const [noteList, setNoteList] = useState<Note[]>([]);
  const [activeNote, setActiveNote] = useState<Note | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved" | "idle">("idle");
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const activeNoteRef = useRef(activeNote);
  activeNoteRef.current = activeNote;

  useEffect(() => {
    const handler = () => {
      setUser(null);
      setVaultList([]);
      setNoteList([]);
      setActiveNote(null);
      syncClient.disconnect();
    };
    window.addEventListener("nexus:logout", handler);
    return () => window.removeEventListener("nexus:logout", handler);
  }, []);

  const loadNotes = useCallback(async (vaultId: string) => {
    try {
      const list = await notesApi.list(vaultId);
      setNoteList(list || []);
    } catch {
      setNoteList([]);
    }
  }, []);

  const loadVaults = useCallback(async () => {
    try {
      const list = await vaultsApi.list();
      setVaultList(list);
      if (list.length > 0) {
        setActiveVaultId((prev) => {
          const id = prev ?? list[0].id;
          loadNotes(id);
          return id;
        });
      }
    } catch {
      auth.logout();
      setUser(null);
    }
  }, [loadNotes]);

  useEffect(() => {
    async function restore() {
      const token = getToken();
      if (token) {
        try {
          const u = await auth.me();
          setUser(u);
          loadVaults();
        } catch {
          auth.logout();
        }
      }
      setLoading(false);
    }
    restore();
  }, [loadVaults]);

  useEffect(() => {
    if (user) {
      syncClient.connect();
      const unsub = syncClient.onMessage((type, payload) => {
        if (type === "note:created" || type === "note:updated") {
          const note = payload as Note;
          setNoteList((prev) => {
            const idx = prev.findIndex((n) => n.id === note.id);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = note;
              return updated;
            }
            return [...prev, note];
          });
          setActiveNote((prev) => (prev?.id === note.id ? note : prev));
        } else if (type === "note:deleted") {
          const { note_id } = payload as { note_id: string };
          setNoteList((prev) => prev.filter((n) => n.id !== note_id));
          setActiveNote((prev) => (prev?.id === note_id ? null : prev));
        }
      });
      return () => {
        unsub();
        syncClient.disconnect();
      };
    }
  }, [user]);

  const handleCreateNote = useCallback(async () => {
    if (!activeVaultId) return;
    const title = "Untitled";
    const note = await notesApi.create(activeVaultId, title, "", "");
    setNoteList((prev) => [...prev, note]);
    setActiveNote(note);
    setEditorContent("");
    setSaveStatus("saved");
  }, [activeVaultId]);

  const handleCreateNoteWithTitle = useCallback(async (title: string) => {
    if (!activeVaultId) return;
    const note = await notesApi.create(activeVaultId, title, "", "");
    setNoteList((prev) => [...prev, note]);
    setActiveNote(note);
    setEditorContent("");
    setSaveStatus("saved");
  }, [activeVaultId]);

  const commands = useMemo(() => [
    { id: "new-note", label: "New Note", shortcut: "Ctrl+N", action: handleCreateNote },
    { id: "quick-switcher", label: "Quick Switcher", shortcut: "Ctrl+P", action: () => setShowQuickSwitcher(true) },
    { id: "global-search", label: "Global Search", shortcut: "Ctrl+Shift+F", action: () => setShowGlobalSearch(true) },
    { id: "graph-view", label: "Graph View", shortcut: "Ctrl+G", action: () => setShowGraph(true) },
    { id: "toggle-edit", label: "Toggle Edit Mode", shortcut: "Ctrl+E", action: () => {} },
    { id: "logout", label: "Sign Out", action: () => { auth.logout(); setUser(null); syncClient.disconnect(); } },
  ], [handleCreateNote]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "p") {
        e.preventDefault();
        setShowQuickSwitcher(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "n") {
        e.preventDefault();
        handleCreateNote();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "g") {
        e.preventDefault();
        setShowGraph((v) => !v);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "P") {
        e.preventDefault();
        setShowCommandPalette(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "F") {
        e.preventDefault();
        setShowGlobalSearch(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleCreateNote]);

  const handleAuth = useCallback(
    (u: User) => {
      setUser(u);
      loadVaults();
    },
    [loadVaults],
  );

  const handleSelectVault = useCallback(
    (id: string) => {
      setActiveVaultId(id);
      setActiveNote(null);
      setSaveStatus("idle");
      loadNotes(id);
    },
    [loadNotes],
  );

  const handleCreateVault = useCallback(async (name: string) => {
    const vault = await vaultsApi.create(name);
    setVaultList((prev) => [...prev, vault]);
    setActiveVaultId(vault.id);
    setNoteList([]);
  }, []);

  const handleSelectNote = useCallback(async (noteId: string) => {
    const note = await notesApi.get(noteId);
    setActiveNote(note);
    setEditorContent(note.content);
    setSaveStatus("saved");
  }, []);

  const handleRenameNote = useCallback((title: string) => {
    setActiveNote((prev) => (prev ? { ...prev, title } : prev));
    setNoteList((prev) =>
      prev.map((n) => {
        const current = activeNoteRef.current;
        return current && n.id === current.id ? { ...n, title } : n;
      }),
    );
    setSaveStatus("unsaved");
  }, []);

  const handleSaveNote = useCallback(async (content: string) => {
    const current = activeNoteRef.current;
    if (!current) return;
    setEditorContent(content);
    setSaveStatus("saving");
    try {
      const updated = await notesApi.update(
        current.id,
        current.title,
        current.path,
        content,
        current.checksum,
      );
      if ("checksum" in updated) {
        const note = updated as Note;
        setActiveNote(note);
        setNoteList((prev) =>
          prev.map((n) => (n.id === note.id ? note : n)),
        );
        setSaveStatus("saved");
      }
    } catch {
      setSaveStatus("unsaved");
    }
  }, []);

  const graphData = useMemo(() => buildGraphData(noteList), [noteList]);
  const tagCounts = useMemo(() => buildTagCounts(noteList), [noteList]);
  const filteredNoteList = useMemo(() => {
    if (!activeTagFilter) return noteList;
    return noteList.filter((n) => extractTags(n.content).includes(activeTagFilter));
  }, [noteList, activeTagFilter]);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
      </div>
    );
  }

  if (!user) {
    return <Auth onAuth={handleAuth} />;
  }

  const tree = buildTree(filteredNoteList);

  return (
    <div className="app-layout">
      <Sidebar
        vaults={vaultList}
        activeVaultId={activeVaultId}
        tree={tree}
        activeNoteId={activeNote?.id ?? null}
        tagCounts={tagCounts}
        activeTagFilter={activeTagFilter}
        onSelectVault={handleSelectVault}
        onSelectNote={handleSelectNote}
        onCreateNote={handleCreateNote}
        onCreateVault={handleCreateVault}
        onTagFilter={setActiveTagFilter}
      />
      <div className="main-content">
        <div className="header">
          <span className="header-title">
            {activeNote ? activeNote.title : "NexusNotes"}
          </span>
          {activeNote?.path && (
            <span className="header-breadcrumb">{activeNote.path}</span>
          )}
          <div className="header-actions">
            <button
              className={`header-btn ${showGraph ? "active" : ""}`}
              onClick={() => setShowGraph(!showGraph)}
              title="Graph view (Ctrl+G)"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="4" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
                <circle cx="12" cy="4" r="2" stroke="currentColor" strokeWidth="1.2" />
                <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.2" />
                <path d="M6 7.2L10.2 4.8M6 8.8L10.2 11.2" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              Graph
            </button>
            <button
              className="header-btn"
              onClick={() => setShowCommandPalette(true)}
              title="Command palette (Ctrl+Shift+P)"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M5 3l6 5-6 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
        <div className="editor-area">
          <Editor
            note={activeNote}
            notes={noteList}
            onSave={handleSaveNote}
            onRename={handleRenameNote}
            onCreateNote={handleCreateNoteWithTitle}
            onNavigateToNote={handleSelectNote}
          />
        </div>
        <StatusBar
          content={editorContent}
          saveStatus={activeNote ? saveStatus : "idle"}
          noteTitle={activeNote?.title ?? null}
          onTagClick={setActiveTagFilter}
        />
      </div>

      {showQuickSwitcher && (
        <QuickSwitcher
          notes={noteList}
          onSelect={handleSelectNote}
          onClose={() => setShowQuickSwitcher(false)}
        />
      )}

      {showGlobalSearch && activeVaultId && (
        <GlobalSearch
          vaultId={activeVaultId}
          onSelect={(id) => { handleSelectNote(id); setShowGlobalSearch(false); }}
          onClose={() => setShowGlobalSearch(false)}
        />
      )}

      {showGraph && (
        <GraphView
          data={graphData}
          activeNoteId={activeNote?.id ?? null}
          onSelectNote={(id) => { handleSelectNote(id); setShowGraph(false); }}
          onClose={() => setShowGraph(false)}
        />
      )}

      {showCommandPalette && (
        <CommandPalette
          commands={commands}
          onClose={() => setShowCommandPalette(false)}
        />
      )}
    </div>
  );
}

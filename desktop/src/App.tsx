import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Sidebar } from "./components/Sidebar";
import { Editor } from "./components/Editor";
import { QuickSwitcher } from "./components/Search";
import { GraphView } from "./components/Graph";
import { CommandPalette } from "./components/CommandPalette";
import { StatusBar } from "./components/StatusBar";
import { Auth } from "./components/Auth";
import { TopBar } from "./components/Workspace/TopBar";
import { Rail } from "./components/Workspace/Rail";
import { vaults as vaultsApi, notes as notesApi, getToken, auth } from "./lib/api";
import { syncClient } from "./lib/sync";
import { buildTree } from "./lib/tree";
import { buildGraphData } from "./lib/wikilinks";
import { buildTagCounts, extractTags } from "./lib/tags";
import { loadPrefs, savePrefs, PREF_LIMITS, clamp } from "./lib/prefs";
import type { ViewMode } from "./lib/prefs";
import { relativeTimeLabel } from "./lib/stats";
import type { User, Vault, Note } from "./lib/types";

const VIEW_CYCLE: ViewMode[] = ["edit", "split", "preview"];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [vaultList, setVaultList] = useState<Vault[]>([]);
  const [activeVaultId, setActiveVaultId] = useState<string | null>(null);
  const [noteList, setNoteList] = useState<Note[]>([]);
  const [activeNote, setActiveNote] = useState<Note | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved" | "idle">("idle");
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [prefs, setPrefs] = useState(() => loadPrefs());
  const [dragging, setDragging] = useState<{ type: "left"; startX: number; startW: number } | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });

  const activeNoteRef = useRef(activeNote);
  activeNoteRef.current = activeNote;

  const updatePrefs = useCallback((partial: Partial<typeof prefs>) => {
    setPrefs(savePrefs(partial));
  }, []);

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
          setLastSyncAt(new Date());
        } else if (type === "note:deleted") {
          const { note_id } = payload as { note_id: string };
          setNoteList((prev) => prev.filter((n) => n.id !== note_id));
          setActiveNote((prev) => (prev?.id === note_id ? null : prev));
          setLastSyncAt(new Date());
        }
      });
      return () => {
        unsub();
        syncClient.disconnect();
      };
    }
  }, [user]);

  // Left panel resize drag
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const [min, max] = PREF_LIMITS.leftWidth;
      const width = clamp(dragging.startW + (e.clientX - dragging.startX), min, max);
      setPrefs((p) => ({ ...p, leftWidth: width }));
    };
    const onUp = () => {
      setDragging(null);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setPrefs((p) => savePrefs({ leftWidth: p.leftWidth }));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging]);

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

  const cycleView = useCallback(() => {
    setPrefs((p) => {
      const next = VIEW_CYCLE[(VIEW_CYCLE.indexOf(p.viewMode) + 1) % VIEW_CYCLE.length];
      return savePrefs({ viewMode: next });
    });
  }, []);

  const toggleFocusMode = useCallback(() => {
    setPrefs((p) => {
      const entering = p.leftOpen || p.rightOpen || p.showStatusBar;
      return savePrefs({
        leftOpen: !entering,
        rightOpen: !entering,
        showStatusBar: !entering,
      });
    });
  }, []);

  const commands = useMemo(() => [
    { id: "new-note", label: "New Note", shortcut: "Ctrl+N", action: handleCreateNote },
    { id: "quick-switcher", label: "Quick Switcher", shortcut: "Ctrl+P", action: () => setShowQuickSwitcher(true) },
    { id: "graph-view", label: "Graph View", shortcut: "Ctrl+G", action: () => setShowGraph(true) },
    { id: "toggle-sidebar", label: "Toggle Sidebar", shortcut: "Ctrl+B", action: () => updatePrefs({ leftOpen: !loadPrefs().leftOpen }) },
    { id: "cycle-view", label: "Cycle View Mode", shortcut: "Ctrl+E", action: cycleView },
    { id: "focus-mode", label: "Toggle Focus Mode", shortcut: "Ctrl+Shift+F", action: toggleFocusMode },
    { id: "logout", label: "Sign Out", action: () => { auth.logout(); setUser(null); syncClient.disconnect(); } },
  ], [handleCreateNote, cycleView, toggleFocusMode, updatePrefs]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setShowCommandPalette(true);
        return;
      }
      if (meta && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        toggleFocusMode();
        return;
      }
      if (meta && e.key === "p") {
        e.preventDefault();
        setShowQuickSwitcher(true);
      }
      if (meta && e.key === "n") {
        e.preventDefault();
        handleCreateNote();
      }
      if (meta && e.key === "g") {
        e.preventDefault();
        setShowGraph((v) => !v);
      }
      if (meta && e.key === "e") {
        e.preventDefault();
        cycleView();
      }
      if (meta && e.key === "b") {
        e.preventDefault();
        setPrefs((p) => savePrefs({ leftOpen: !p.leftOpen }));
      }
      if (meta && e.key === ".") {
        e.preventDefault();
        setPrefs((p) => savePrefs({ rightOpen: !p.rightOpen }));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleCreateNote, cycleView, toggleFocusMode]);

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
    setCursor({ line: 1, col: 1 });
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
        setLastSyncAt(new Date());
      }
    } catch {
      setSaveStatus("unsaved");
    }
  }, []);

  const handleCursorChange = useCallback((line: number, col: number) => {
    setCursor((prev) => (prev.line === line && prev.col === col ? prev : { line, col }));
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
  const activeVault = vaultList.find((v) => v.id === activeVaultId);

  return (
    <div className="workspace" data-rm={prefs.reduceMotion ? "1" : "0"}>
      <TopBar
        vaultName={activeVault?.name ?? "NexusNotes"}
        noteTitle={activeNote?.title ?? null}
        syncStatus={saveStatus}
        leftOpen={prefs.leftOpen}
        rightOpen={prefs.rightOpen}
        onOpenPalette={() => setShowQuickSwitcher(true)}
        onToggleLeft={() => updatePrefs({ leftOpen: !prefs.leftOpen })}
        onToggleRight={() => updatePrefs({ rightOpen: !prefs.rightOpen })}
      />
      <div className="workspace-body">
        <Rail
          activeView={prefs.leftOpen ? "files" : null}
          graphActive={showGraph}
          onFiles={() => updatePrefs({ leftOpen: !prefs.leftOpen })}
          onGraph={() => setShowGraph((v) => !v)}
        />
        <div
          className={`panel-left${prefs.leftOpen ? "" : " panel-left--closed"}${dragging ? " panel-left--dragging" : ""}`}
          style={{ width: prefs.leftOpen ? prefs.leftWidth : 0 }}
        >
          <div className="panel-left-inner" style={{ width: prefs.leftWidth }}>
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
          </div>
        </div>
        <div
          className={`panel-handle${dragging ? " panel-handle--dragging" : ""}`}
          onPointerDown={(e) => {
            if (!prefs.leftOpen) return;
            e.preventDefault();
            document.body.style.userSelect = "none";
            document.body.style.cursor = "col-resize";
            setDragging({ type: "left", startX: e.clientX, startW: prefs.leftWidth });
          }}
        />
        <div className="center-column">
          <Editor
            note={activeNote}
            notes={noteList}
            mode={prefs.viewMode}
            onModeChange={(m) => updatePrefs({ viewMode: m })}
            onCursorChange={handleCursorChange}
            onSave={handleSaveNote}
            onRename={handleRenameNote}
            onCreateNote={handleCreateNoteWithTitle}
            onNavigateToNote={handleSelectNote}
          />
        </div>
      </div>
      {prefs.showStatusBar && (
        <StatusBar
          content={editorContent}
          saveStatus={activeNote ? saveStatus : "idle"}
          hasNote={!!activeNote}
          lastSyncLabel={lastSyncAt ? relativeTimeLabel(lastSyncAt) : null}
          line={cursor.line}
          col={cursor.col}
          viewMode={prefs.viewMode}
          onCycleView={cycleView}
        />
      )}

      {showQuickSwitcher && (
        <QuickSwitcher
          notes={noteList}
          onSelect={handleSelectNote}
          onClose={() => setShowQuickSwitcher(false)}
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

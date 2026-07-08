import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Sidebar } from "./components/Sidebar";
import { Editor } from "./components/Editor";
import { GlobalSearch } from "./components/Search";
import { GraphView } from "./components/Graph";
import { CommandPalette } from "./components/CommandPalette";
import { StatusBar } from "./components/StatusBar";
import { Auth } from "./components/Auth";
import { TopBar } from "./components/Workspace/TopBar";
import { Rail } from "./components/Workspace/Rail";
import { TabBar } from "./components/Workspace/TabBar";
import { DailyCalendar } from "./components/Workspace/DailyCalendar";
import { ContextMenu } from "./components/Workspace/ContextMenu";
import { FirstRunVault } from "./components/Workspace/FirstRunVault";
import { Settings } from "./components/Settings/Settings";
import { RightPanel } from "./components/RightPanel/RightPanel";
import { Logo } from "./components/Logo";
import { vaults as vaultsApi, notes as notesApi, getToken, auth } from "./lib/api";
import { syncClient } from "./lib/sync";
import { buildTree, flattenTreeNoteIds } from "./lib/tree";
import { buildGraphData } from "./lib/wikilinks";
import { buildTagCounts } from "./lib/tags";
import { filterNotes, sortNotes, searchNotes, topLevelFolders, uniqueTitle } from "./lib/noteFilter";
import { loadPins, togglePin, pinnedFirst } from "./lib/pins";
import { loadFolders, addFolder, removeFolder } from "./lib/folders";
import type { SortBy } from "./lib/noteFilter";
import { toIsoDate, dailyNoteTemplate } from "./lib/daily";
import { loadPrefs, savePrefs, PREF_LIMITS, clamp } from "./lib/prefs";
import type { ViewMode } from "./lib/prefs";
import type { RailView } from "./components/Workspace/Rail";
import { relativeTimeLabel } from "./lib/stats";
import type { User, Vault, Note } from "./lib/types";

const VIEW_CYCLE: ViewMode[] = ["edit", "split", "preview"];

interface Tab {
  key: string;
  type: "note" | "graph";
}

const GRAPH_TAB_KEY = "__graph";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [vaultList, setVaultList] = useState<Vault[]>([]);
  const [activeVaultId, setActiveVaultId] = useState<string | null>(null);
  const [noteList, setNoteList] = useState<Note[]>([]);
  const [activeNote, setActiveNote] = useState<Note | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [paletteQuery, setPaletteQuery] = useState<string | null>(null);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [emptyFolders, setEmptyFolders] = useState<string[]>([]);
  const [newFolderNonce, setNewFolderNonce] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const lastClickedRef = useRef<string | null>(null);
  const flattenedNoteIdsRef = useRef<string[]>([]);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; noteId: string } | null>(null);
  const [workspaceMenu, setWorkspaceMenu] = useState<{ x: number; y: number } | null>(null);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved" | "idle">("idle");
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterFolder, setFilterFolder] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("title");
  const [railView, setRailView] = useState<RailView>("files");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabKey, setActiveTabKey] = useState<string | null>(null);
  const [prefs, setPrefs] = useState(() => loadPrefs());
  const [dragging, setDragging] = useState<{ type: "left" | "right"; startX: number; startW: number } | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });

  const activeNoteRef = useRef(activeNote);
  activeNoteRef.current = activeNote;
  const noteListRef = useRef(noteList);
  noteListRef.current = noteList;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabKeyRef = useRef(activeTabKey);
  activeTabKeyRef.current = activeTabKey;

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

  // Suppress the native browser/OS context menu (Reload, Inspect element, …)
  // app-wide; our own menus are opened by React onContextMenu handlers.
  useEffect(() => {
    const suppress = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", suppress);
    return () => document.removeEventListener("contextmenu", suppress);
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
          closeTabRef.current(note_id);
          setLastSyncAt(new Date());
        }
      });
      return () => {
        unsub();
        syncClient.disconnect();
      };
    }
  }, [user]);

  useEffect(() => {
    setPinnedIds(activeVaultId ? loadPins(activeVaultId) : []);
    setEmptyFolders(activeVaultId ? loadFolders(activeVaultId) : []);
  }, [activeVaultId]);

  // Side panel resize drag
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - dragging.startX;
      if (dragging.type === "left") {
        const [min, max] = PREF_LIMITS.leftWidth;
        const width = clamp(dragging.startW + dx, min, max);
        setPrefs((p) => ({ ...p, leftWidth: width }));
      } else {
        const [min, max] = PREF_LIMITS.rightWidth;
        const width = clamp(dragging.startW - dx, min, max);
        setPrefs((p) => ({ ...p, rightWidth: width }));
      }
    };
    const onUp = () => {
      setDragging(null);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setPrefs((p) => savePrefs({ leftWidth: p.leftWidth, rightWidth: p.rightWidth }));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging]);

  const handleCreateNoteWithTitle = useCallback(async (title: string) => {
    if (!activeVaultId) return;
    // Keep note names unique (Untitled, Untitled 1, Untitled 2, …).
    const name = uniqueTitle(new Set(noteListRef.current.map((n) => n.title)), title);
    const note = await notesApi.create(activeVaultId, name, "", "");
    setNoteList((prev) => (prev.some((n) => n.id === note.id) ? prev : [...prev, note]));
    setTabs((prev) => [...prev, { key: note.id, type: "note" }]);
    setActiveTabKey(note.id);
    setActiveNote(note);
    setEditorContent("");
    setSaveStatus("saved");
    setCursor({ line: 1, col: 1 });
  }, [activeVaultId]);

  const handleCreateNote = useCallback(
    () => handleCreateNoteWithTitle("Untitled"),
    [handleCreateNoteWithTitle],
  );

  const handleOpenDaily = useCallback(async (iso: string) => {
    setShowCalendar(false);
    const existing = noteListRef.current.find((n) => n.title === iso);
    if (existing) {
      setTabs((prev) =>
        prev.some((t) => t.key === existing.id) ? prev : [...prev, { key: existing.id, type: "note" }],
      );
      setActiveTabKey(existing.id);
      const note = await notesApi.get(existing.id);
      setActiveNote(note);
      setEditorContent(note.content);
      setSaveStatus("saved");
      setCursor({ line: 1, col: 1 });
      return;
    }
    if (!activeVaultId) return;
    // A note's path is its folder, so daily notes live in the "Daily" folder;
    // the title carries the date.
    const note = await notesApi.create(activeVaultId, iso, "Daily", dailyNoteTemplate(iso));
    setNoteList((prev) => (prev.some((n) => n.id === note.id) ? prev : [...prev, note]));
    setTabs((prev) => [...prev, { key: note.id, type: "note" }]);
    setActiveTabKey(note.id);
    setActiveNote(note);
    setEditorContent(note.content);
    setSaveStatus("saved");
    setCursor({ line: 1, col: 1 });
  }, [activeVaultId]);

  const openGraphTab = useCallback(() => {
    setTabs((prev) =>
      prev.some((t) => t.key === GRAPH_TAB_KEY) ? prev : [...prev, { key: GRAPH_TAB_KEY, type: "graph" }],
    );
    setActiveTabKey(GRAPH_TAB_KEY);
  }, []);

  const toggleGraphTab = useCallback(() => {
    if (activeTabKeyRef.current === GRAPH_TAB_KEY) {
      closeTabRef.current(GRAPH_TAB_KEY);
    } else {
      openGraphTab();
    }
  }, [openGraphTab]);

  const handleSignOut = useCallback(() => {
    auth.logout();
    setUser(null);
    syncClient.disconnect();
  }, []);

  const handleTogglePin = useCallback((noteId: string) => {
    if (!activeVaultId) return;
    setPinnedIds(togglePin(activeVaultId, noteId));
  }, [activeVaultId]);

  const handleCreateFolder = useCallback((name: string) => {
    if (!activeVaultId) return;
    setEmptyFolders(addFolder(activeVaultId, name));
  }, [activeVaultId]);

  // Pop open the sidebar's new-folder input (from the workspace right-click).
  const requestNewFolder = useCallback(() => {
    setRailView("files");
    updatePrefs({ leftOpen: true });
    setNewFolderNonce((n) => n + 1);
  }, [updatePrefs]);

  // Move a note into a folder ("" = root). A note's path IS its folder, so this
  // is just a path change persisted via the normal update endpoint.
  const moveOne = useCallback(async (noteId: string, folderPath: string) => {
    const note = noteListRef.current.find((n) => n.id === noteId);
    if (!note || note.path === folderPath) return;
    try {
      const updated = await notesApi.update(note.id, note.title, folderPath, note.content, note.checksum);
      if ("checksum" in updated) {
        const u = updated as Note;
        setNoteList((prev) => prev.map((n) => (n.id === u.id ? u : n)));
        setActiveNote((prev) => (prev?.id === u.id ? u : prev));
      }
    } catch {
      /* leave the note where it was on failure */
    }
  }, []);

  // Drag entry point: dragging any note that is part of a multi-selection moves
  // the whole selection; otherwise just the dragged note.
  const handleMoveNote = useCallback(async (noteId: string, folderPath: string) => {
    const sel = selectedIdsRef.current;
    const ids = sel.has(noteId) && sel.size > 1 ? [...sel] : [noteId];
    for (const id of ids) await moveOne(id, folderPath);
    if (ids.length > 1) setSelectedIds(new Set());
  }, [moveOne]);

  const handleDeleteFolder = useCallback(async (folderPath: string) => {
    if (!activeVaultId) return;
    // Flatten: move notes in the folder (or its subfolders) back to the root,
    // then drop the folder marker.
    const inside = noteListRef.current.filter(
      (n) => n.path === folderPath || n.path.startsWith(folderPath + "/"),
    );
    for (const n of inside) {
      await moveOne(n.id, "");
    }
    setEmptyFolders(removeFolder(activeVaultId, folderPath));
  }, [activeVaultId, moveOne]);

  const handleDuplicateNote = useCallback(async (noteId: string) => {
    if (!activeVaultId) return;
    const src = noteListRef.current.find((n) => n.id === noteId);
    if (!src) return;
    const title = uniqueTitle(new Set(noteListRef.current.map((n) => n.title)), `${src.title} copy`);
    const note = await notesApi.create(activeVaultId, title, src.path, src.content);
    setNoteList((prev) => (prev.some((n) => n.id === note.id) ? prev : [...prev, note]));
    setTabs((prev) => [...prev, { key: note.id, type: "note" }]);
    setActiveTabKey(note.id);
    setActiveNote(note);
    setEditorContent(note.content);
    setSaveStatus("saved");
    setCursor({ line: 1, col: 1 });
  }, [activeVaultId]);

  const deleteOne = useCallback(async (noteId: string) => {
    if (!activeVaultId) return;
    await notesApi.delete(activeVaultId, noteId);
    setNoteList((prev) => prev.filter((n) => n.id !== noteId));
    closeTabRef.current(noteId);
  }, [activeVaultId]);
  const deleteOneRef = useRef(deleteOne);
  deleteOneRef.current = deleteOne;

  // Deletes the whole multi-selection when the target note is part of it,
  // otherwise just the one note.
  const handleDeleteNote = useCallback(async (noteId: string) => {
    const sel = selectedIdsRef.current;
    const ids = sel.has(noteId) && sel.size > 1 ? [...sel] : [noteId];
    for (const id of ids) await deleteOne(id);
    if (ids.length > 1) setSelectedIds(new Set());
  }, [deleteOne]);

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
    { id: "new-note", label: "New note", shortcut: "Ctrl+N", action: handleCreateNote },
    { id: "graph-view", label: "Open graph", shortcut: "Ctrl+G", action: openGraphTab },
    { id: "daily-note", label: "Open today's daily note", shortcut: "Ctrl+D", action: () => handleOpenDaily(toIsoDate(new Date())) },
    { id: "toggle-sidebar", label: "Toggle left sidebar", shortcut: "Ctrl+B", action: () => updatePrefs({ leftOpen: !loadPrefs().leftOpen }) },
    { id: "toggle-right", label: "Toggle right panel", shortcut: "Ctrl+.", action: () => updatePrefs({ rightOpen: !loadPrefs().rightOpen }) },
    { id: "cycle-view", label: "Cycle view mode", shortcut: "Ctrl+E", action: cycleView },
    { id: "global-search", label: "Global search", shortcut: "Ctrl+Shift+F", action: () => setShowGlobalSearch(true) },
    { id: "focus-mode", label: "Toggle focus mode", action: toggleFocusMode },
    { id: "settings", label: "Open settings", shortcut: "Ctrl+,", action: () => setShowSettings(true) },
    { id: "logout", label: "Sign out", action: handleSignOut },
  ], [handleCreateNote, handleOpenDaily, openGraphTab, cycleView, toggleFocusMode, updatePrefs, handleSignOut]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPaletteQuery(">");
        return;
      }
      if (meta && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setShowGlobalSearch(true);
        return;
      }
      if (meta && e.key === "p") {
        e.preventDefault();
        setPaletteQuery("");
      }
      if (meta && e.key === "n") {
        e.preventDefault();
        handleCreateNote();
      }
      if (meta && e.key === "g") {
        e.preventDefault();
        toggleGraphTab();
      }
      if (meta && e.key === "d") {
        e.preventDefault();
        handleOpenDaily(toIsoDate(new Date()));
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
      if (meta && e.key === ",") {
        e.preventDefault();
        setShowSettings(true);
      }
      if (e.key === "Delete" && selectedIdsRef.current.size > 0) {
        const t = e.target as HTMLElement;
        const editable = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
        if (!editable) {
          e.preventDefault();
          for (const id of [...selectedIdsRef.current]) deleteOneRef.current(id);
          setSelectedIds(new Set());
        }
      }
      if (e.key === "Escape") {
        // Dismiss lightweight popovers that don't manage their own Escape
        setShowCalendar(false);
        setCtxMenu(null);
        setWorkspaceMenu(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleCreateNote, handleOpenDaily, toggleGraphTab, cycleView, toggleFocusMode]);

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
      setTabs([]);
      setActiveTabKey(null);
      setSaveStatus("idle");
      setFilterTags([]);
      setFilterFolder(null);
      setSearchQuery("");
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
    setTabs((prev) =>
      prev.some((t) => t.key === noteId) ? prev : [...prev, { key: noteId, type: "note" }],
    );
    setActiveTabKey(noteId);
    const note = await notesApi.get(noteId);
    setActiveNote(note);
    setEditorContent(note.content);
    setSaveStatus("saved");
    setCursor({ line: 1, col: 1 });
  }, []);

  // Tree click with modifier support: Ctrl/Cmd toggles, Shift selects a range,
  // a plain click opens the note and clears the multi-selection.
  const handleNoteClick = useCallback((e: React.MouseEvent, id: string) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      // Avoid a native text selection when building a multi-selection.
      e.preventDefault();
    }
    if (e.metaKey || e.ctrlKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      lastClickedRef.current = id;
      return;
    }
    if (e.shiftKey && lastClickedRef.current && lastClickedRef.current !== id) {
      const order = flattenedNoteIdsRef.current;
      const a = order.indexOf(lastClickedRef.current);
      const b = order.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelectedIds(new Set(order.slice(lo, hi + 1)));
        return;
      }
    }
    setSelectedIds(new Set());
    lastClickedRef.current = id;
    handleSelectNote(id);
  }, [handleSelectNote]);

  const closeTab = useCallback(
    (key: string) => {
      const current = tabsRef.current;
      const idx = current.findIndex((t) => t.key === key);
      if (idx < 0) return;
      const next = current.filter((t) => t.key !== key);
      setTabs(next);
      if (activeTabKeyRef.current === key) {
        const fallback = next.length ? next[Math.max(0, idx - 1)] : null;
        if (fallback?.type === "note") {
          handleSelectNote(fallback.key);
        } else {
          setActiveTabKey(fallback?.key ?? null);
          setActiveNote(null);
          setEditorContent("");
          setSaveStatus("idle");
        }
      }
    },
    [handleSelectNote],
  );
  const closeTabRef = useRef(closeTab);
  closeTabRef.current = closeTab;

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
  const folders = useMemo(() => topLevelFolders(noteList), [noteList]);
  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);
  const filteredNoteList = useMemo(
    () => pinnedFirst(sortNotes(filterNotes(noteList, filterTags, filterFolder), sortBy), pinnedSet),
    [noteList, filterTags, filterFolder, sortBy, pinnedSet],
  );
  const searchHits = useMemo(() => searchNotes(noteList, searchQuery), [noteList, searchQuery]);

  const toggleTagFilter = useCallback((tag: string) => {
    setFilterTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }, []);

  const clearFilters = useCallback(() => {
    setFilterTags([]);
    setFilterFolder(null);
  }, []);

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

  const tree = buildTree(filteredNoteList, { keepNoteOrder: true, emptyFolders });
  flattenedNoteIdsRef.current = flattenTreeNoteIds(tree);
  const activeVault = vaultList.find((v) => v.id === activeVaultId);
  const tabItems = tabs.map((t) => ({
    ...t,
    title: t.type === "graph" ? "Graph" : noteList.find((n) => n.id === t.key)?.title ?? "Untitled",
  }));
  const activeTab = tabs.find((t) => t.key === activeTabKey) ?? null;
  const graphActive = activeTab?.type === "graph";

  return (
    <div
      className="workspace"
      data-rm={prefs.reduceMotion ? "1" : "0"}
      onContextMenu={(e) => {
        // A note item (or other child) that opened its own menu will have
        // called preventDefault; only open the workspace menu otherwise.
        if (e.defaultPrevented) return;
        e.preventDefault();
        setCtxMenu(null);
        setWorkspaceMenu({
          x: Math.min(e.clientX, window.innerWidth - 210),
          y: Math.min(e.clientY, window.innerHeight - 190),
        });
      }}
    >
      <TopBar
        vaultName={activeVault?.name ?? "NexusNotes"}
        noteTitle={graphActive ? "Graph" : activeNote?.title ?? null}
        notePath={graphActive ? "" : activeNote?.path ?? ""}
        syncStatus={saveStatus}
        leftOpen={prefs.leftOpen}
        rightOpen={prefs.rightOpen}
        onOpenPalette={() => setPaletteQuery("")}
        onToggleLeft={() => updatePrefs({ leftOpen: !prefs.leftOpen })}
        onToggleRight={() => updatePrefs({ rightOpen: !prefs.rightOpen })}
      />
      <div className="workspace-body">
        <Rail
          activeView={prefs.leftOpen ? railView : null}
          graphActive={graphActive}
          onFiles={() => {
            if (prefs.leftOpen && railView === "files") {
              updatePrefs({ leftOpen: false });
            } else {
              setRailView("files");
              updatePrefs({ leftOpen: true });
            }
          }}
          onSearch={() => {
            if (prefs.leftOpen && railView === "search") {
              updatePrefs({ leftOpen: false });
            } else {
              setRailView("search");
              updatePrefs({ leftOpen: true });
            }
          }}
          onGraph={toggleGraphTab}
          calendarOpen={showCalendar}
          onDaily={() => setShowCalendar((v) => !v)}
          onSettings={() => setShowSettings(true)}
        />
        <div
          className={`panel-left${prefs.leftOpen ? "" : " panel-left--closed"}${dragging?.type === "left" ? " panel-left--dragging" : ""}`}
          style={{ width: prefs.leftOpen ? prefs.leftWidth : 0 }}
        >
          <div className="panel-left-inner" style={{ width: prefs.leftWidth }}>
            <Sidebar
              view={railView}
              vaults={vaultList}
              activeVaultId={activeVaultId}
              tree={tree}
              activeNoteId={activeNote?.id ?? null}
              tagCounts={tagCounts}
              folders={folders}
              filterTags={filterTags}
              filterFolder={filterFolder}
              sortBy={sortBy}
              searchQuery={searchQuery}
              searchHits={searchHits}
              onSelectVault={handleSelectVault}
              onSelectNote={handleSelectNote}
              onNoteClick={handleNoteClick}
              selectedIds={selectedIds}
              onCreateNote={handleCreateNote}
              onCreateFolder={handleCreateFolder}
              onMoveNote={handleMoveNote}
              onDeleteFolder={handleDeleteFolder}
              newFolderNonce={newFolderNonce}
              onCreateVault={handleCreateVault}
              onToggleTag={toggleTagFilter}
              onSetFolder={setFilterFolder}
              onSetSort={setSortBy}
              onClearFilters={clearFilters}
              onSearchChange={setSearchQuery}
              onSignOut={handleSignOut}
              pinnedIds={pinnedSet}
              onNoteContextMenu={(e, noteId) =>
                setCtxMenu({
                  x: Math.min(e.clientX, window.innerWidth - 195),
                  y: Math.min(e.clientY, window.innerHeight - 175),
                  noteId,
                })
              }
            />
          </div>
        </div>
        <div
          className={`panel-handle${dragging?.type === "left" ? " panel-handle--dragging" : ""}`}
          onPointerDown={(e) => {
            if (!prefs.leftOpen) return;
            e.preventDefault();
            document.body.style.userSelect = "none";
            document.body.style.cursor = "col-resize";
            setDragging({ type: "left", startX: e.clientX, startW: prefs.leftWidth });
          }}
        />
        <div className="center-column">
          {vaultList.length > 0 && tabs.length > 0 && (
            <TabBar
              tabs={tabItems}
              activeKey={activeTabKey}
              onSelect={(key) => {
                const tab = tabs.find((t) => t.key === key);
                if (tab?.type === "note") handleSelectNote(key);
                else setActiveTabKey(key);
              }}
              onClose={closeTab}
              onNew={handleCreateNote}
            />
          )}
          {vaultList.length === 0 ? (
            <FirstRunVault onCreate={handleCreateVault} />
          ) : tabs.length === 0 ? (
            <div className="workspace-empty">
              <div className="workspace-empty-logo">
                <Logo size={60} variant="animated" />
              </div>
              <p className="workspace-empty-title">No note is open</p>
              <div className="workspace-empty-actions">
                <button className="workspace-empty-action" onClick={() => setPaletteQuery("")}>
                  <span>Search everything</span>
                  <span className="workspace-empty-kbd">Ctrl+P</span>
                </button>
                <button className="workspace-empty-action" onClick={handleCreateNote}>
                  <span>Create a note</span>
                  <span className="workspace-empty-kbd">Ctrl+N</span>
                </button>
                <button
                  className="workspace-empty-action"
                  onClick={() => handleOpenDaily(toIsoDate(new Date()))}
                >
                  <span>Open today&rsquo;s daily note</span>
                  <span className="workspace-empty-kbd">Ctrl+D</span>
                </button>
              </div>
            </div>
          ) : graphActive ? (
            <GraphView
              data={graphData}
              activeNoteId={activeNote?.id ?? null}
              onSelectNote={handleSelectNote}
            />
          ) : (
            <Editor
              note={activeNote}
              notes={noteList}
              mode={prefs.viewMode}
              fontSize={prefs.fontSize}
              splitPct={prefs.splitPct}
              onSplitPctChange={(pct) => updatePrefs({ splitPct: pct })}
              onModeChange={(m) => updatePrefs({ viewMode: m })}
              onCursorChange={handleCursorChange}
              onLiveChange={setEditorContent}
              onTagClick={(tag) => {
                setFilterTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
                setRailView("files");
                updatePrefs({ leftOpen: true });
              }}
              onSave={handleSaveNote}
              onRename={handleRenameNote}
              onCreateNote={handleCreateNoteWithTitle}
              onNavigateToNote={handleSelectNote}
            />
          )}
        </div>
        <div
          className={`panel-handle${dragging?.type === "right" ? " panel-handle--dragging" : ""}`}
          onPointerDown={(e) => {
            if (!prefs.rightOpen) return;
            e.preventDefault();
            document.body.style.userSelect = "none";
            document.body.style.cursor = "col-resize";
            setDragging({ type: "right", startX: e.clientX, startW: prefs.rightWidth });
          }}
        />
        <div
          className={`panel-right${prefs.rightOpen ? "" : " panel-right--closed"}${dragging?.type === "right" ? " panel-right--dragging" : ""}`}
          style={{ width: prefs.rightOpen ? prefs.rightWidth : 0 }}
        >
          <div className="panel-right-inner" style={{ width: prefs.rightWidth }}>
            <RightPanel
              note={graphActive ? null : activeNote}
              content={editorContent}
              notes={noteList}
              tab={prefs.rightTab}
              onTabChange={(t) => updatePrefs({ rightTab: t })}
              onNavigateToNote={handleSelectNote}
              onTagClick={(tag) => {
                setFilterTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
                setRailView("files");
                updatePrefs({ leftOpen: true });
              }}
            />
          </div>
        </div>
      </div>
      {prefs.showStatusBar && (
        <StatusBar
          content={graphActive ? "" : editorContent}
          saveStatus={activeNote ? saveStatus : "idle"}
          hasNote={!graphActive && !!activeNote}
          lastSyncLabel={lastSyncAt ? relativeTimeLabel(lastSyncAt) : null}
          line={cursor.line}
          col={cursor.col}
          viewMode={prefs.viewMode}
          onCycleView={cycleView}
        />
      )}

      {showSettings && (
        <Settings
          prefs={prefs}
          lastSyncLabel={lastSyncAt ? relativeTimeLabel(lastSyncAt) : null}
          onUpdatePrefs={updatePrefs}
          onSignOut={handleSignOut}
          onClose={() => setShowSettings(false)}
        />
      )}

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            { key: "open", label: "Open", onClick: () => handleSelectNote(ctxMenu.noteId) },
            { key: "duplicate", label: "Duplicate", onClick: () => handleDuplicateNote(ctxMenu.noteId) },
            {
              key: "pin",
              label: pinnedSet.has(ctxMenu.noteId) ? "Unpin" : "Pin to top",
              onClick: () => handleTogglePin(ctxMenu.noteId),
            },
            {
              key: "wikilink",
              label: "Copy wikilink",
              onClick: () => {
                const n = noteList.find((x) => x.id === ctxMenu.noteId);
                if (n) navigator.clipboard?.writeText(`[[${n.title}]]`).catch(() => {});
              },
            },
            {
              key: "delete",
              label:
                selectedIds.has(ctxMenu.noteId) && selectedIds.size > 1
                  ? `Delete ${selectedIds.size} notes`
                  : "Delete note",
              danger: true,
              onClick: () => handleDeleteNote(ctxMenu.noteId),
            },
          ]}
        />
      )}

      {workspaceMenu && (
        <ContextMenu
          x={workspaceMenu.x}
          y={workspaceMenu.y}
          onClose={() => setWorkspaceMenu(null)}
          items={[
            { key: "new-note", label: "New note", onClick: handleCreateNote },
            { key: "new-folder", label: "New folder", onClick: requestNewFolder },
            {
              key: "daily",
              label: "Open today's daily note",
              onClick: () => handleOpenDaily(toIsoDate(new Date())),
            },
            { key: "palette", label: "Search notes and commands", onClick: () => setPaletteQuery("") },
            {
              key: "refresh",
              label: "Refresh",
              onClick: () => {
                loadVaults();
                if (activeVaultId) loadNotes(activeVaultId);
              },
            },
          ]}
        />
      )}

      {showCalendar && (
        <DailyCalendar
          noteTitles={new Set(noteList.map((n) => n.title))}
          onPickDay={handleOpenDaily}
          onOpenToday={() => handleOpenDaily(toIsoDate(new Date()))}
          onClose={() => setShowCalendar(false)}
        />
      )}

      {showGlobalSearch && activeVaultId && (
        <GlobalSearch
          vaultId={activeVaultId}
          onSelect={handleSelectNote}
          onClose={() => setShowGlobalSearch(false)}
        />
      )}

      {paletteQuery !== null && (
        <CommandPalette
          notes={noteList}
          commands={commands}
          initialQuery={paletteQuery}
          onSelectNote={handleSelectNote}
          onClose={() => setPaletteQuery(null)}
        />
      )}

    </div>
  );
}

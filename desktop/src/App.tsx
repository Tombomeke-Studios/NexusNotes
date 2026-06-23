import { useState, useEffect, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { Editor } from "./components/Editor";
import { QuickSwitcher } from "./components/Search";
import { Auth } from "./components/Auth";
import { vaults as vaultsApi, notes as notesApi, getToken, auth } from "./lib/api";
import { syncClient } from "./lib/sync";
import { buildTree } from "./lib/tree";
import type { User, Vault, Note } from "./lib/types";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [vaultList, setVaultList] = useState<Vault[]>([]);
  const [activeVaultId, setActiveVaultId] = useState<string | null>(null);
  const [noteList, setNoteList] = useState<Note[]>([]);
  const [activeNote, setActiveNote] = useState<Note | null>(null);
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const [loading, setLoading] = useState(true);

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
    const token = getToken();
    if (token) {
      setUser({} as User);
      loadVaults();
    }
    setLoading(false);
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
  }, [activeVaultId]);

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
  }, []);

  const handleSaveNote = useCallback(
    async (content: string) => {
      if (!activeNote) return;
      try {
        const updated = await notesApi.update(
          activeNote.id,
          activeNote.title,
          activeNote.path,
          content,
          activeNote.checksum,
        );
        if ("checksum" in updated) {
          const note = updated as Note;
          setActiveNote(note);
          setNoteList((prev) =>
            prev.map((n) => (n.id === note.id ? note : n)),
          );
        }
      } catch {
        // conflict or error
      }
    },
    [activeNote],
  );

  if (loading) return null;

  if (!user) {
    return <Auth onAuth={handleAuth} />;
  }

  const tree = buildTree(noteList);

  return (
    <div className="app-layout">
      <Sidebar
        vaults={vaultList}
        activeVaultId={activeVaultId}
        tree={tree}
        activeNoteId={activeNote?.id ?? null}
        onSelectVault={handleSelectVault}
        onSelectNote={handleSelectNote}
        onCreateNote={handleCreateNote}
        onCreateVault={handleCreateVault}
      />
      <div className="main-content">
        <div className="header">
          <span className="header-title">
            {activeNote ? activeNote.title : "NexusNotes"}
          </span>
          {activeNote?.path && (
            <span className="header-breadcrumb">{activeNote.path}</span>
          )}
        </div>
        <div className="editor-area">
          <Editor note={activeNote} onSave={handleSaveNote} />
        </div>
      </div>

      {showQuickSwitcher && (
        <QuickSwitcher
          notes={noteList}
          onSelect={handleSelectNote}
          onClose={() => setShowQuickSwitcher(false)}
        />
      )}
    </div>
  );
}

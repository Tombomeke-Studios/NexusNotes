import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { AnimatePresence } from "framer-motion";
import { Sidebar } from "./components/Sidebar";
import { Editor, type ReplaceRequest } from "./components/Editor";
import { GlobalSearch } from "./components/Search";
import { GraphView } from "./components/Graph";
import { CommandPalette } from "./components/CommandPalette";
import { StatusBar } from "./components/StatusBar";
import { Auth } from "./components/Auth";
import { ConnectionBanner, ServerUnavailable } from "./components/ConnectionBanner";
import { AuthAction } from "./components/AuthAction";
import { TopBar } from "./components/Workspace/TopBar";
import { Rail } from "./components/Workspace/Rail";
import { TabBar } from "./components/Workspace/TabBar";
import { DailyCalendar } from "./components/Workspace/DailyCalendar";
import { ContextMenu } from "./components/Workspace/ContextMenu";
import { TemplatePicker } from "./components/Workspace/TemplatePicker";
import { RenameTagDialog } from "./components/Workspace/RenameTagDialog";
import { SharingDialog } from "./components/Workspace/SharingDialog";
import { LinkedFilesDialog } from "./components/Workspace/LinkedFilesDialog";
import { VersionHistoryDialog } from "./components/History/VersionHistoryDialog";
import { ShortcutsDialog } from "./components/Help/ShortcutsDialog";
import { isTypingTarget } from "./lib/shortcuts";
import { addedLinks, completeStep, startChecklist } from "./lib/checklist";
import { planImport } from "./lib/importNotes";
import { Toaster } from "./components/Toaster";
import { ConsentBanner } from "./components/ConsentBanner";
import { toast } from "./lib/toast";
import { SkeletonGraph, SkeletonNote } from "./components/Skeleton";
import { FirstRunVault } from "./components/Workspace/FirstRunVault";
import { Settings } from "./components/Settings/Settings";
import { RightPanel } from "./components/RightPanel/RightPanel";
import { Logo } from "./components/Logo";
import { CreateVaultDialog } from "./components/Encryption/CreateVaultDialog";
import { RecoveryCodeDialog } from "./components/Encryption/RecoveryCodeDialog";
import { UnlockVaultDialog } from "./components/Encryption/UnlockVaultDialog";
import {
  vaults as vaultsApi,
  notes as notesApi,
  stars as starsApi,
  links as linksApi,
  devices as devicesApi,
  getToken,
  getDeviceId,
  auth,
  ApiError,
} from "./lib/api";
import { restoreFailureAction } from "./lib/session";
import { sealLegacyMeta, needsMetaSeal } from "./lib/legacyMeta";
import {
  setupVaultEncryption,
  unlockVaultKey,
  recoverVaultKey,
  rewrapVaultKey,
  vaultKeySession,
  isE2eeVault,
  isVaultLocked,
  encryptNoteForVault,
  decryptNoteForVault,
  encryptFieldForVault,
  decryptFieldForVault,
  type EncryptionMeta,
} from "./lib/vaultKeys";
import { syncClient } from "./lib/sync";
import { buildTree, flattenTreeNoteIds } from "./lib/tree";
import { buildGraphData } from "./lib/wikilinks";
import { buildTagCounts, extractTags } from "./lib/tags";
import { renameTagInContent, normalizeTag, contentHasTag } from "./lib/tagRename";
import { filterNotes, sortNotes, searchNotes, topLevelFolders, uniqueTitle } from "./lib/noteFilter";
import { migrateLegacyPins } from "./lib/stars";
import { convertVaultToE2ee } from "./lib/vaultConvert";
import { clearDraft } from "./lib/drafts";
import { loadRecent, pushRecent } from "./lib/recent";
import { loadFolders, addFolder, removeFolder } from "./lib/folders";
import { PERIOD_FOLDER, periodTitle, type Period } from "./lib/periodic";
import { welcomeNotes, QUICK_START_TITLE } from "./lib/welcome";
import { useNoteSave, isDirtyStatus, type SaveStatus } from "./lib/useNoteSave";
import { useCloseGuard, type ClosePrompt } from "./lib/useCloseGuard";
import { CloseConfirmDialog } from "./components/Workspace/CloseConfirmDialog";
import { ConflictDialog, ConflictNotice } from "./components/Conflict";
import type { SortBy } from "./lib/noteFilter";
import { toIsoDate } from "./lib/daily";
import { renderTemplate, templateVars, listTemplates } from "./lib/templates";
import { stripFrontmatter, safeFilename, noteToHtmlDocument, vaultToZip, downloadFile, printNote } from "./lib/export";
import { loadPrefs, savePrefs, PREF_LIMITS, clamp } from "./lib/prefs";
import type { ViewMode } from "./lib/prefs";
import type { RailView } from "./components/Workspace/Rail";
import { relativeTimeLabel } from "./lib/stats";
import { isTauriWindow } from "./lib/platform";
import { useReducedMotion } from "./lib/motion";
import { currentAuthAction, clearAuthActionUrl } from "./lib/authAction";
import type { User, Vault, Note } from "./lib/types";
import { attachmentBlockReason } from "./lib/attachmentPolicy";

const VIEW_CYCLE: ViewMode[] = ["edit", "split", "preview"];

interface Tab {
  key: string;
  type: "note" | "graph";
}

const GRAPH_TAB_KEY = "__graph";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const userIdRef = useRef<string | null>(null);
  userIdRef.current = user?.id ?? null;
  const [vaultList, setVaultList] = useState<Vault[]>([]);
  const [activeVaultId, setActiveVaultId] = useState<string | null>(null);
  const [noteList, setNoteList] = useState<Note[]>([]);
  const [activeNote, setActiveNote] = useState<Note | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [paletteQuery, setPaletteQuery] = useState<string | null>(null);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNewVault, setShowNewVault] = useState(false);
  // One-time recovery code of a freshly encrypted vault; shown until confirmed.
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  // E2ee vault currently prompting for its passphrase.
  const [unlockVaultId, setUnlockVaultId] = useState<string | null>(null);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  // Bumped nonce asks the editor to insert text at the cursor (#155).
  const [insertRequest, setInsertRequest] = useState<{ text: string; nonce: number } | null>(null);
  const [closePrompt, setClosePrompt] = useState<ClosePrompt | null>(null);
  /** The conflict dialog (#225): which note, whether its resolution is saving, why it last failed. */
  const [conflictPrompt, setConflictPrompt] = useState<{ noteId: string; busy: boolean; error: string | null } | null>(null);
  const [starredIds, setStarredIds] = useState<string[]>([]);
  const starredIdsRef = useRef(starredIds);
  starredIdsRef.current = starredIds;
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [emptyFolders, setEmptyFolders] = useState<string[]>([]);
  const [newFolderNonce, setNewFolderNonce] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const flattenedNoteIdsRef = useRef<string[]>([]);
  const keyboardCursorRef = useRef<string | null>(null);
  const modalOpenRef = useRef(false);
  const graphActiveRef = useRef(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; noteId: string } | null>(null);
  const [workspaceMenu, setWorkspaceMenu] = useState<{ x: number; y: number } | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterFolder, setFilterFolder] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("title");
  const [railView, setRailView] = useState<RailView>("files");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [authAction, setAuthAction] = useState(() => currentAuthAction());
  // Tag being renamed via the sidebar tag panel (#154).
  const [renameTag, setRenameTag] = useState<string | null>(null);
  // Vault whose sharing panel is open (#55).
  const [shareVaultId, setShareVaultId] = useState<string | null>(null);
  const [linksVaultId, setLinksVaultId] = useState<string | null>(null);

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabKey, setActiveTabKey] = useState<string | null>(null);
  const [prefs, setPrefs] = useState(() => loadPrefs());
  // Single source of truth for reduced motion (OS + in-app setting); applied to
  // <html> so it also covers the auth screen and portalled overlays.
  const { reduced: reducedMotion, osReduced: osReducedMotion } = useReducedMotion(prefs.motion);
  const [dragging, setDragging] = useState<{ type: "left" | "right"; startX: number; startW: number } | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });

  const activeNoteRef = useRef(activeNote);
  activeNoteRef.current = activeNote;
  const noteListRef = useRef(noteList);
  noteListRef.current = noteList;
  const vaultListRef = useRef(vaultList);
  vaultListRef.current = vaultList;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabKeyRef = useRef(activeTabKey);
  activeTabKeyRef.current = activeTabKey;
  const saveStatusRef = useRef(saveStatus);
  saveStatusRef.current = saveStatus;
  // The title flashes when a save completes (#430), at most every 30 s:
  // autosave runs at every pause in typing, and a flash each time would nag.
  const [savedFlash, setSavedFlash] = useState(0);
  const flashState = useRef({ prev: saveStatus, at: 0 });
  useEffect(() => {
    const s = flashState.current;
    if (s.prev === "saving" && saveStatus === "saved" && Date.now() - s.at > 30_000) {
      s.at = Date.now();
      setSavedFlash((n) => n + 1);
    }
    s.prev = saveStatus;
  }, [saveStatus]);
  const editorContentRef = useRef(editorContent);
  editorContentRef.current = editorContent;

  const updatePrefs = useCallback((partial: Partial<typeof prefs>) => {
    setPrefs(savePrefs(partial));
  }, []);

  useEffect(() => {
    const handler = () => {
      setUser(null);
      setVaultList([]);
      setNoteList([]);
      setActiveNote(null);
      setStarredIds([]);
      vaultKeySession.clear();
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

  /**
   * E2EE boundary: everything in React state is plaintext; ciphertext exists
   * only on the wire and the server. These two helpers translate at the edge.
   */
  const vaultOf = useCallback(
    (vaultId: string) => vaultListRef.current.find((v) => v.id === vaultId),
    [],
  );

  /** Decrypts a note from the server; `readable` is false when that failed. */
  const decryptIncomingChecked = useCallback(async (note: Note): Promise<{ note: Note; readable: boolean }> => {
    const vault = vaultOf(note.vault_id);
    if (!isE2eeVault(vault)) return { note, readable: true };
    try {
      return {
        note: {
          ...note,
          title: await decryptFieldForVault(vault!, note.title),
          path: await decryptFieldForVault(vault!, note.path),
          content: await decryptNoteForVault(vault!, note.content),
        },
        readable: true,
      };
    } catch {
      // Locked vault or undecryptable payload: keep the ciphertext (unreadable
      // but harmless); a proper unlock reloads the vault.
      return { note, readable: false };
    }
  }, [vaultOf]);
  const decryptIncoming = useCallback(
    async (note: Note): Promise<Note> => (await decryptIncomingChecked(note)).note,
    [decryptIncomingChecked],
  );

  /** Text for the open note that came from outside the editor (#324). */
  const [replaceRequest, setReplaceRequest] = useState<ReplaceRequest | null>(null);
  const replaceNonce = useRef(0);
  /** Another device's version waiting for the editor to show it (#324). */
  const pendingRemote = useRef<{ nonce: number; note: Note; expected: string } | null>(null);
  /** Whether an editor is on screen (not while the graph view is). */
  const editorPresent = useRef(false);
  const replaceEditorText = useCallback((noteId: string, text: string, expected?: string, remote?: Note) => {
    replaceNonce.current += 1;
    pendingRemote.current = remote ? { nonce: replaceNonce.current, note: remote, expected: expected ?? "" } : null;
    setReplaceRequest({ noteId, text, nonce: replaceNonce.current, expected });
  }, []);

  // Fails closed: a vault that isn't in the list (e.g. after sign-out) is
  // never treated as unencrypted, so e2ee plaintext can't leave the client.
  const encryptOutgoing = useCallback(
    (vaultId: string, plaintext: string) => encryptNoteForVault(vaultOf(vaultId), plaintext),
    [vaultOf],
  );
  // Titles and folder paths go out sealed for e2ee vaults too (#362); state
  // and the UI only ever hold the plaintext.
  const sealMeta = useCallback(
    async (vaultId: string, title: string, path: string) => ({
      title: await encryptFieldForVault(vaultOf(vaultId), title),
      path: await encryptFieldForVault(vaultOf(vaultId), path),
    }),
    [vaultOf],
  );

  const {
    saveNote: handleSaveNote,
    saveAll: saveAllNotes,
    hasUnconfirmed,
    unconfirmedNoteIds,
    liveChange: handleLiveChange,
    markDirty,
    discard: discardUnsaved,
    localCopy,
    acceptRemoteUpdate,
    isOwnVersion,
    conflictVersion,
    resolveConflict,
    saveError,
  } = useNoteSave({
    activeNoteRef,
    editorContentRef,
    setActiveNote,
    setNoteList,
    setEditorContent,
    setSaveStatus,
    onSynced: () => setLastSyncAt(new Date()),
    encryptOutgoing,
    sealMeta,
    keepsDrafts: (vaultId) => !isE2eeVault(vaultOf(vaultId)),
    // The server's version in a 409 is ciphertext for e2ee vaults. An unknown
    // vault throws, so the conflict dialog never shows unreadable text.
    showEditorText: (noteId, text) => replaceEditorText(noteId, text),
    decryptServerContent: async (vaultId, content) => {
      const vault = vaultOf(vaultId);
      if (!vault) throw new Error("Unknown vault");
      return isE2eeVault(vault) ? decryptNoteForVault(vault, content) : content;
    },
    // Background saves (retries) must not persist text the user may be about
    // to discard in the close-confirmation dialog.
    paused: closePrompt !== null,
    // Every sign-out path ends with user === null; that drops pending saves.
    sessionKey: user?.id ?? null,
  });
  const handleSaveNoteRef = useRef(handleSaveNote);
  handleSaveNoteRef.current = handleSaveNote;

  // The open note moves to another device's version. The ref is updated at
  // once so a second push right after this one compares with the new text.
  const adoptRemote = useCallback((note: Note) => {
    editorContentRef.current = note.content;
    setEditorContent(note.content);
    setActiveNote((prev) => (prev?.id === note.id ? note : prev));
  }, []);

  // The editor showed another device's version.
  const handleReplaceApplied = useCallback((request: ReplaceRequest) => {
    const pending = pendingRemote.current;
    if (!pending || pending.nonce !== request.nonce) return;
    pendingRemote.current = null;
    adoptRemote(pending.note);
  }, [adoptRemote]);

  // An editor leaving the screen can no longer show a waiting version. The
  // open note takes it directly only while nothing has changed since it was
  // pushed (same note, still saved, same text); otherwise it's a conflict, or
  // it belongs to a note that is no longer open and the list already has it.
  const handleEditorPresence = useCallback((present: boolean) => {
    editorPresent.current = present;
    const pending = pendingRemote.current;
    if (present || !pending) return;
    pendingRemote.current = null;
    if (activeNoteRef.current?.id !== pending.note.id) return;
    const unchanged =
      !isDirtyStatus(saveStatusRef.current) && editorContentRef.current === pending.expected;
    if (unchanged) adoptRemote(pending.note);
    else acceptRemoteUpdate(pending.note);
  }, [adoptRemote, acceptRemoteUpdate]);

  // The user typed before the editor could show it: that is a conflict.
  const handleReplaceRejected = useCallback((request: ReplaceRequest) => {
    const pending = pendingRemote.current;
    if (!pending || pending.nonce !== request.nonce) return;
    pendingRemote.current = null;
    acceptRemoteUpdate(pending.note);
  }, [acceptRemoteUpdate]);

  const handleResolveConflict = useCallback(
    async (content: string, basedOn: string) => {
      const noteId = conflictPrompt?.noteId;
      if (!noteId) return;
      setConflictPrompt({ noteId, busy: true, error: null });
      const outcome = await resolveConflict(noteId, content, basedOn);
      // Anything but a fresh conflict is settled here: a network failure is
      // retried in the background like any other save.
      if (outcome.ok || outcome.error.kind !== "conflict") {
        setConflictPrompt(null);
        return;
      }
      setConflictPrompt({ noteId, busy: false, error: outcome.error.message });
    },
    [conflictPrompt, resolveConflict],
  );

  /** Vaults whose legacy plaintext titles are being sealed right now (#362). */
  const sealingMeta = useRef(new Set<string>());
  /** A note whose text is still being fetched after a click (#435). */
  const [loadingNoteId, setLoadingNoteId] = useState<string | null>(null);
  // True while a vault's note list is on its way (#434); only the latest load counts.
  const [notesLoading, setNotesLoading] = useState(false);
  const notesLoadSeq = useRef(0);
  const loadNotes = useCallback(async (vaultId: string) => {
    const seq = ++notesLoadSeq.current;
    setNotesLoading(true);
    try {
      const list = await notesApi.list(vaultId);
      setNoteList(await Promise.all((list || []).map(decryptIncoming)));
      const vault = vaultOf(vaultId);
      if (isE2eeVault(vault) && !isVaultLocked(vault) && list?.some(needsMetaSeal) && !sealingMeta.current.has(vaultId)) {
        sealingMeta.current.add(vaultId);
        void sealLegacyMeta(list, vault!, notesApi.update).finally(() => sealingMeta.current.delete(vaultId));
      }
    } catch {
      setNoteList([]);
    } finally {
      if (seq === notesLoadSeq.current) setNotesLoading(false);
    }
  }, [decryptIncoming, vaultOf]);

  const loadVaults = useCallback(async () => {
    try {
      const list = await vaultsApi.list();
      setVaultList(list);
      if (list.length > 0) {
        setActiveVaultId((prev) => {
          const id = prev ?? list[0].id;
          // A locked e2ee vault prompts for its passphrase instead of loading
          // notes we couldn't decrypt anyway.
          if (isVaultLocked(list.find((v) => v.id === id))) {
            setUnlockVaultId(id);
          } else {
            loadNotes(id);
          }
          return id;
        });
      }
    } catch {
      auth.logout();
      setUser(null);
    }
  }, [loadNotes]);
  const loadVaultsRef = useRef(loadVaults);
  loadVaultsRef.current = loadVaults;

  // A stored session is restored on start. If the server simply is not answering
  // (Docker still booting, backend restarting) the session is kept and a waiting
  // screen shows — only a real rejection from the server signs the user out.
  const [serverDown, setServerDown] = useState(false);
  const restore = useCallback(async () => {
    const token = getToken();
    if (token) {
      try {
        const u = await auth.me();
        setUser(u);
        setServerDown(false);
        loadVaults();
      } catch (err) {
        if (restoreFailureAction(err) === "wait") {
          setServerDown(true);
          setLoading(false);
          return;
        }
        auth.logout();
        setServerDown(false);
      }
    }
    setLoading(false);
  }, [loadVaults]);

  useEffect(() => {
    restore();
  }, [restore]);

  useEffect(() => {
    if (user) {
      syncClient.connect();
      const unsub = syncClient.onMessage((type, payload) => {
        if (type === "note:created" || type === "note:updated") {
          // E2ee payloads arrive as ciphertext; state only holds plaintext.
          decryptIncomingChecked(payload as Note).then(({ note: incoming, readable }) => {
            // Text that could not be decrypted never reaches the open note:
            // not the editor, not a conflict comparison (it would be saved
            // back as the note's content).
            if (!readable && activeNoteRef.current?.id === incoming.id) return;
            // An echo must not clobber unsaved local edits on the open note —
            // e.g. a rename typed right after Ctrl+N would silently revert
            // and the next autosave would persist the old title (#204).
            const current = activeNoteRef.current;
            const dirty =
              current?.id === incoming.id &&
              isDirtyStatus(saveStatusRef.current);
            // Only our own save's echo may be merged into unsaved text.
            // Another device's edit turns the note into a conflict instead:
            // keep the local text and base checksum untouched, so the next
            // save gets a 409 rather than silently overwriting their edit.
            if (dirty && !acceptRemoteUpdate(incoming)) return;
            const note = dirty
              ? { ...incoming, title: current!.title, content: editorContentRef.current }
              : incoming;
            // Another device changed the open, saved note: show its text, or
            // the next edit would be saved on top of it and silently undo it
            // (#324). Echoes of our own saves are already on screen. The open
            // note only moves to this version once the editor shows it; a
            // keystroke in between turns it into a conflict instead.
            const fromElsewhere =
              !dirty &&
              current?.id === incoming.id &&
              incoming.content !== editorContentRef.current &&
              !isOwnVersion(incoming.id, incoming.checksum);
            // No editor on screen (graph view): nothing can be typed over it,
            // so the open note takes the version at once.
            const replacing = fromElsewhere && editorPresent.current;
            if (replacing) replaceEditorText(incoming.id, incoming.content, editorContentRef.current, incoming);
            else if (fromElsewhere) adoptRemote(incoming);
            setNoteList((prev) => {
              const idx = prev.findIndex((n) => n.id === note.id);
              if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = note;
                return updated;
              }
              return [...prev, note];
            });
            if (!replacing) setActiveNote((prev) => (prev?.id === note.id ? note : prev));
            setLastSyncAt(new Date());
          });
        } else if (type === "sync:reconnected") {
          // Updates pushed while the socket was down are gone: reload the
          // vault list and the active vault's notes (#388).
          loadVaultsRef.current();
          setLastSyncAt(new Date());
        } else if (type === "vault:encrypted") {
          // Another device turned a vault end-to-end encrypted (#361). This
          // device holds no key for it, so drop its plaintext from memory and
          // from local drafts, and reload: the vault now asks to be unlocked.
          const { vault_id } = payload as { vault_id: string };
          if (vaultKeySession.get(vault_id)) return; // converted here
          if (activeVaultIdRef.current === vault_id) {
            for (const n of noteListRef.current) clearDraft(n.id);
            setTabs([]);
            setActiveTabKey(null);
            setActiveNote(null);
            setEditorContent("");
            setNoteList([]);
          }
          loadVaultsRef.current();
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
  }, [user, decryptIncomingChecked, acceptRemoteUpdate, isOwnVersion, replaceEditorText, adoptRemote]);

  useEffect(() => {
    setRecentIds(activeVaultId ? loadRecent(activeVaultId) : []);
    setEmptyFolders(activeVaultId ? loadFolders(activeVaultId) : []);
    // One-time migration: push this vault's legacy localStorage pins to the
    // server-backed stars (#151). Pins the server could not take yet stay for
    // the next start. Stars span vaults, so a vault switch meanwhile is fine,
    // but nothing lands in state once that user has signed out (#377).
    if (!activeVaultId) return;
    const owner = userIdRef.current;
    migrateLegacyPins(activeVaultId, starsApi.star).then((starred) => {
      if (starred.length === 0 || userIdRef.current !== owner) return;
      setStarredIds((prev) => [...prev, ...starred.filter((id) => !prev.includes(id))]);
    });
  }, [activeVaultId]);

  // Stars live server-side per user; load them once per session. Merge with
  // whatever is already in state so a legacy-pin migration that raced this
  // fetch isn't wiped by a list snapshot taken before its POSTs landed.
  // A sign-out before the list arrives must not leak it into the next session.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    starsApi
      .list()
      .then((ids) => {
        if (!cancelled) setStarredIds((prev) => [...ids, ...prev.filter((x) => !ids.includes(x))]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);
  const activeVaultIdRef = useRef(activeVaultId);
  activeVaultIdRef.current = activeVaultId;
  /** Bumped by every note selection; an older one still loading then gives way. */
  const selectionSeq = useRef(0);

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

  /**
   * Persists any unsaved local edits (title and live content) of the note the
   * editor is about to switch away from. Renames aren't covered by drafts, so
   * without this a rename typed just before a switch is silently lost (#204).
   */
  const flushPendingSave = useCallback(async () => {
    if (isDirtyStatus(saveStatusRef.current)) {
      await handleSaveNoteRef.current(editorContentRef.current);
    }
  }, []);

  // First-launch checklist (#447): the palette step, and "link two notes"
  // once a save adds a working [[link]] the note didn't have when opened.
  useEffect(() => {
    if (paletteQuery !== null) completeStep("open-palette");
  }, [paletteQuery]);
  const linkBaseline = useRef<{ id: string; text: string } | null>(null);
  useEffect(() => {
    if (!activeNote) return;
    if (linkBaseline.current?.id !== activeNote.id) {
      linkBaseline.current = { id: activeNote.id, text: editorContentRef.current };
      return;
    }
    if (saveStatus !== "saved") return;
    const titles = new Set(noteListRef.current.filter((n) => n.id !== activeNote.id).map((n) => n.title.toLowerCase()));
    if (addedLinks(linkBaseline.current.text, editorContentRef.current, titles).length > 0) completeStep("link-notes");
  }, [activeNote, saveStatus]);

  // Keyboard shortcut reference (#452).
  const [showShortcuts, setShowShortcuts] = useState(false);
  // Version history of the open note (#415-#417).
  const [historyOpen, setHistoryOpen] = useState(false);
  // Signing out (Settings → Sign out, or deleting the account) closes every
  // dialog, so the next account doesn't sign in to the previous one's.
  useEffect(() => {
    if (user) return;
    setShowSettings(false);
    setShowGlobalSearch(false);
    setShowCalendar(false);
    setShowNewVault(false);
    setShareVaultId(null);
    setLinksVaultId(null);
    setHistoryOpen(false);
  }, [user]);
  const [deviceNames, setDeviceNames] = useState<Map<string, string>>(new Map());
  const openHistory = useCallback(() => {
    if (!activeNoteRef.current) return;
    setHistoryOpen(true);
    devicesApi
      .list()
      .then((list) => setDeviceNames(new Map(list.map((d) => [d.id, d.name]))))
      .catch(() => {});
  }, []);

  // Restores a version on the server (a new version, so the replaced text is
  // kept) and shows it the way another device's save is shown. Unsaved edits
  // are saved first, so they are in the history too. Returns why it failed.
  const handleRestoreVersion = useCallback(async (versionId: string): Promise<string | null> => {
    const open = activeNoteRef.current;
    if (!open) return "No note is open.";
    if (isDirtyStatus(saveStatusRef.current)) {
      const outcome = await handleSaveNoteRef.current(editorContentRef.current);
      if (!outcome.ok) return `Your latest changes aren't saved yet: ${outcome.error.message}`;
    }
    const base = activeNoteRef.current?.id === open.id ? activeNoteRef.current.checksum : open.checksum;
    try {
      const restored = await decryptIncoming(await notesApi.restoreVersion(open.id, versionId, base));
      if (activeNoteRef.current?.id === restored.id) {
        if (editorPresent.current) replaceEditorText(restored.id, restored.content, editorContentRef.current, restored);
        else adoptRemote(restored);
      }
      setNoteList((prev) => prev.map((n) => (n.id === restored.id ? restored : n)));
      toast("Version restored. The text it replaced is still in the history.", { kind: "success" });
      return null;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        return "This note changed on another device since you opened its history. Close the history and try again.";
      }
      if (err instanceof ApiError && err.status === 403) return "You can't edit this note.";
      return "Couldn't restore this version. Check your connection and try again.";
    }
  }, [decryptIncoming, replaceEditorText, adoptRemote]);

  // True while a new note is being created: the open note is read-only until
  // the new one replaces it, so typing meant for the new note cannot land in
  // the previous one (#403).
  const [creatingNote, setCreatingNote] = useState(false);

  const createNoteWithTitle = useCallback(async (title: string) => {
    // A new note is a selection too: one still loading gives way to it.
    const selection = ++selectionSeq.current;
    // Read from the ref: a shortcut can fire before the keyboard handler of
    // the latest render is registered, and its stale closure would see no
    // vault (right after start-up) or the previous one (right after a switch).
    const vaultId = activeVaultIdRef.current;
    if (!vaultId) return;
    // Keep note names unique (Untitled, Untitled 1, Untitled 2, …).
    const name = uniqueTitle(new Set(noteListRef.current.map((n) => n.title)), title);
    const { content: payload, checksum } = await encryptOutgoing(vaultId, "");
    const sealed = await sealMeta(vaultId, name, "");
    const created = { ...(await notesApi.create(vaultId, sealed.title, sealed.path, payload, checksum)), title: name, path: "" };
    // The previous note stayed editable while the create was in flight; save
    // whatever was typed into it (e.g. a rename) before switching (#204).
    await flushPendingSave();
    // Switched vaults in the meantime: the note exists in the vault it was
    // made for, but must not open in (or join the list of) the new one.
    if (activeVaultIdRef.current !== vaultId) return;
    const note = { ...created, content: "" };
    setNoteList((prev) => (prev.some((n) => n.id === note.id) ? prev : [...prev, note]));
    // Another note was chosen while this one was created: it is listed, not opened.
    if (selection !== selectionSeq.current) return;
    setTabs((prev) => [...prev, { key: note.id, type: "note" }]);
    setActiveTabKey(note.id);
    setActiveNote(note);
    setEditorContent("");
    setSaveStatus("saved");
    setCursor({ line: 1, col: 1 });
  }, [encryptOutgoing, sealMeta, flushPendingSave]);

  const handleCreateNoteWithTitle = useCallback(async (title: string) => {
    setCreatingNote(true);
    try {
      await createNoteWithTitle(title);
      completeStep("create-note");
    } finally {
      setCreatingNote(false);
    }
  }, [createNoteWithTitle]);

  const handleCreateNote = useCallback(
    () => handleCreateNoteWithTitle("Untitled"),
    [handleCreateNoteWithTitle],
  );

  const handleCreateNoteInFolder = useCallback(
    (folderPath: string) => handleCreateNoteWithTitle(`${folderPath}/Untitled`),
    [handleCreateNoteWithTitle],
  );

  // Daily, weekly and monthly notes (#240): one per period in its own folder,
  // created from that period's template.
  const handleOpenPeriodic = useCallback(async (period: Period, iso: string) => {
    setShowCalendar(false);
    const selection = ++selectionSeq.current;
    const folder = PERIOD_FOLDER[period];
    const existing =
      noteListRef.current.find((n) => n.title === iso && n.path === folder) ??
      noteListRef.current.find((n) => n.title === iso);
    if (existing) {
      await flushPendingSave();
      if (selection !== selectionSeq.current) return;
      setTabs((prev) =>
        prev.some((t) => t.key === existing.id) ? prev : [...prev, { key: existing.id, type: "note" }],
      );
      setActiveTabKey(existing.id);
      const note = await decryptIncoming(await notesApi.get(existing.id));
      if (selection !== selectionSeq.current) return;
      setActiveNote(note);
      setEditorContent(note.content);
      setSaveStatus("saved");
      setCursor({ line: 1, col: 1 });
      return;
    }
    // From the ref, like handleCreateNoteWithTitle: Ctrl+D can fire a stale closure.
    const vaultId = activeVaultIdRef.current;
    if (!vaultId) return;
    // A note's path is its folder, so daily notes live in the "Daily" folder;
    // the title carries the date. The templates are user-configurable (#155).
    const prefsNow = loadPrefs();
    const source =
      period === "daily" ? prefsNow.dailyTemplate : period === "weekly" ? prefsNow.weeklyTemplate : prefsNow.monthlyTemplate;
    const vars = templateVars(new Date(), iso);
    const template = renderTemplate(source, period === "daily" ? { ...vars, date: iso } : vars);
    const { content: payload, checksum } = await encryptOutgoing(vaultId, template);
    const sealed = await sealMeta(vaultId, iso, folder);
    const created = { ...(await notesApi.create(vaultId, sealed.title, sealed.path, payload, checksum)), title: iso, path: folder };
    await flushPendingSave();
    if (activeVaultIdRef.current !== vaultId) return;
    const note = { ...created, content: template };
    setNoteList((prev) => (prev.some((n) => n.id === note.id) ? prev : [...prev, note]));
    if (selection !== selectionSeq.current) return;
    setTabs((prev) => [...prev, { key: note.id, type: "note" }]);
    setActiveTabKey(note.id);
    setActiveNote(note);
    setEditorContent(note.content);
    setSaveStatus("saved");
    setCursor({ line: 1, col: 1 });
  }, [decryptIncoming, encryptOutgoing, sealMeta, flushPendingSave]);
  const handleOpenDaily = useCallback((iso: string) => handleOpenPeriodic("daily", iso), [handleOpenPeriodic]);

  const openGraphTab = useCallback(() => {
    setTabs((prev) =>
      prev.some((t) => t.key === GRAPH_TAB_KEY) ? prev : [...prev, { key: GRAPH_TAB_KEY, type: "graph" }],
    );
    setActiveTabKey(GRAPH_TAB_KEY);
    completeStep("open-graph");
  }, []);

  const toggleGraphTab = useCallback(() => {
    if (activeTabKeyRef.current === GRAPH_TAB_KEY) {
      closeTabRef.current(GRAPH_TAB_KEY);
    } else {
      openGraphTab();
    }
  }, [openGraphTab]);

  // Vault export (#152): zip built client-side from in-memory notes, so e2ee
  // vaults export decrypted without their plaintext touching the server.
  // Import existing Markdown notes (#451): a folder (keeps its structure) or
  // loose files, created through the vault's encryption like any new note.
  const importFolderRef = useRef<HTMLInputElement>(null);
  const importFilesRef = useRef<HTMLInputElement>(null);
  const handleImportFiles = useCallback(async (list: FileList | null) => {
    const vault = vaultListRef.current.find((v) => v.id === activeVaultIdRef.current);
    if (!list || list.length === 0 || !vault) return;
    if (isVaultLocked(vault)) {
      toast("Unlock the vault before importing into it.", { kind: "error" });
      return;
    }
    const plan = await planImport(Array.from(list), noteListRef.current);
    const created: Note[] = [];
    for (const [i, n] of plan.notes.entries()) {
      if (i % 5 === 0) toast(`Importing ${i + 1} of ${plan.notes.length}…`, { key: "import", duration: 60_000 });
      try {
        const { content, checksum } = await encryptNoteForVault(vault, n.content);
        const title = await encryptFieldForVault(vault, n.title);
        const path = await encryptFieldForVault(vault, n.path);
        const note = await notesApi.create(vault.id, title, path, content, checksum);
        created.push({ ...note, title: n.title, path: n.path, content: n.content });
      } catch {
        /* reported in the summary below */
      }
    }
    const ids = new Set(created.map((n) => n.id));
    setNoteList((prev) => [...prev.filter((n) => !ids.has(n.id)), ...created]);
    const failed = plan.notes.length - created.length;
    const skipped = plan.skipped.existing + plan.skipped.tooLarge;
    const parts = [`Imported ${created.length} note${created.length === 1 ? "" : "s"}`];
    if (skipped > 0) parts.push(`${skipped} skipped (already there or over 5 MB)`);
    if (failed > 0) parts.push(`${failed} failed`);
    toast(parts.join(", ") + ".", { key: "import", kind: failed > 0 ? "error" : "success" });
  }, []);

  const handleExportVault = useCallback(() => {
    const vault = vaultListRef.current.find((v) => v.id === activeVaultIdRef.current);
    if (!vault || noteListRef.current.length === 0) return;
    downloadFile(`${safeFilename(vault.name)}.zip`, "application/zip", vaultToZip(noteListRef.current));
    toast(`Exported “${vault.name}” as a zip`, { kind: "success" });
  }, []);

  const signOutNow = useCallback(() => {
    auth.logout();
    setUser(null);
    vaultKeySession.clear();
    syncClient.disconnect();
  }, []);

  // Text the server doesn't have yet, in the open note or any note left
  // behind (in-memory e2ee text has no draft to fall back on).
  const hasUnsavedWork = useCallback(
    () => isDirtyStatus(saveStatusRef.current) || hasUnconfirmed(),
    [hasUnconfirmed],
  );

  // Signing out drops all unsaved text, so it asks first (same dialog as close).
  const handleSignOut = useCallback(() => {
    if (hasUnsavedWork()) setClosePrompt({ kind: "signout" });
    else signOutNow();
  }, [hasUnsavedWork, signOutNow]);

  // Optimistic star toggle; reverts when the server call fails (#151).
  const handleToggleStar = useCallback(async (noteId: string) => {
    const was = starredIdsRef.current.includes(noteId);
    setStarredIds((prev) => (was ? prev.filter((x) => x !== noteId) : [...prev, noteId]));
    try {
      if (was) await starsApi.unstar(noteId);
      else await starsApi.star(noteId);
    } catch {
      setStarredIds((prev) => (was ? [...prev, noteId] : prev.filter((x) => x !== noteId)));
    }
  }, []);

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
      // State content is plaintext, so re-encrypt for e2ee vaults on the way out.
      const { content: payload, checksum } = await encryptOutgoing(note.vault_id, note.content);
      const sealed = await sealMeta(note.vault_id, note.title, folderPath);
      const updated = await notesApi.update(note.id, sealed.title, sealed.path, payload, note.checksum, checksum);
      if ("checksum" in updated) {
        const u = { ...(updated as Note), title: note.title, path: folderPath, content: note.content };
        setNoteList((prev) => prev.map((n) => (n.id === u.id ? u : n)));
        setActiveNote((prev) => (prev?.id === u.id ? u : prev));
      }
    } catch {
      /* leave the note where it was on failure */
    }
  }, [encryptOutgoing, sealMeta]);

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
    const { content: payload, checksum } = await encryptOutgoing(activeVaultId, src.content);
    const sealed = await sealMeta(activeVaultId, title, src.path);
    const created = { ...(await notesApi.create(activeVaultId, sealed.title, sealed.path, payload, checksum)), title, path: src.path };
    await flushPendingSave();
    const note = { ...created, content: src.content };
    setNoteList((prev) => (prev.some((n) => n.id === note.id) ? prev : [...prev, note]));
    setTabs((prev) => [...prev, { key: note.id, type: "note" }]);
    setActiveTabKey(note.id);
    setActiveNote(note);
    setEditorContent(note.content);
    setSaveStatus("saved");
    setCursor({ line: 1, col: 1 });
  }, [activeVaultId, encryptOutgoing, sealMeta, flushPendingSave]);

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

  // Ctrl+T (#155): pick a Templates-folder note to insert into the open note.
  const openTemplatePicker = useCallback(() => {
    if (activeNoteRef.current && activeTabKeyRef.current !== GRAPH_TAB_KEY) {
      setShowTemplatePicker(true);
    }
  }, []);

  const handlePickTemplate = useCallback((template: Note) => {
    setShowTemplatePicker(false);
    const current = activeNoteRef.current;
    if (!current) return;
    const text = renderTemplate(template.content, templateVars(new Date(), current.title));
    setInsertRequest((prev) => ({ text, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  const commands = useMemo(() => [
    { id: "new-note", label: "New note", shortcut: "Ctrl+N", action: handleCreateNote },
    { id: "graph-view", label: "Open graph", shortcut: "Ctrl+G", action: openGraphTab },
    { id: "daily-note", label: "Open today's daily note", shortcut: "Ctrl+D", action: () => handleOpenDaily(toIsoDate(new Date())) },
    { id: "weekly-note", label: "Open this week's note", action: () => handleOpenPeriodic("weekly", periodTitle("weekly", new Date())) },
    { id: "monthly-note", label: "Open this month's note", action: () => handleOpenPeriodic("monthly", periodTitle("monthly", new Date())) },
    { id: "insert-template", label: "Insert template", shortcut: "Ctrl+T", action: openTemplatePicker },
    { id: "toggle-sidebar", label: "Toggle left sidebar", shortcut: "Ctrl+B", action: () => updatePrefs({ leftOpen: !loadPrefs().leftOpen }) },
    { id: "toggle-right", label: "Toggle right panel", shortcut: "Ctrl+.", action: () => updatePrefs({ rightOpen: !loadPrefs().rightOpen }) },
    { id: "cycle-view", label: "Cycle view mode", shortcut: "Ctrl+E", action: cycleView },
    { id: "global-search", label: "Global search", shortcut: "Ctrl+Shift+F", action: () => setShowGlobalSearch(true) },
    { id: "focus-mode", label: "Toggle focus mode", action: toggleFocusMode },
    { id: "version-history", label: "Show version history", shortcut: "Ctrl+Shift+H", action: openHistory },
    { id: "shortcuts", label: "Help: keyboard shortcuts", shortcut: "?", action: () => setShowShortcuts(true) },
    { id: "import-folder", label: "Import a folder of Markdown notes…", action: () => importFolderRef.current?.click() },
    { id: "import-files", label: "Import Markdown files…", action: () => importFilesRef.current?.click() },
    { id: "settings", label: "Open settings", shortcut: "Ctrl+,", action: () => setShowSettings(true) },
    { id: "logout", label: "Sign out", action: handleSignOut },
  ], [handleCreateNote, handleOpenDaily, handleOpenPeriodic, openGraphTab, openTemplatePicker, cycleView, toggleFocusMode, openHistory, updatePrefs, handleSignOut]);

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
      if (meta && e.shiftKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        openHistory();
        return;
      }
      if (e.key === "?" && !meta && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        setShowShortcuts(true);
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
      if (meta && e.key === "t") {
        e.preventDefault();
        openTemplatePicker();
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
  }, [handleCreateNote, handleOpenDaily, toggleGraphTab, openTemplatePicker, cycleView, toggleFocusMode, openHistory]);

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
      if (isVaultLocked(vaultListRef.current.find((v) => v.id === id))) {
        setNoteList([]);
        setUnlockVaultId(id);
      } else {
        loadNotes(id);
      }
    },
    [loadNotes],
  );

  /**
   * Change-passphrase (#199): verify the current passphrase, re-wrap the Vault
   * Key under the new one and replace the server-side key material. Notes are
   * untouched; a fresh recovery code is shown once.
   */
  const handleChangePassphrase = useCallback(async (currentPass: string, newPass: string) => {
    const vault = vaultListRef.current.find((v) => v.id === activeVaultIdRef.current);
    if (!vault || vault.encryption !== "e2ee") throw new Error("not an encrypted vault");
    const meta = vault.encryption_meta as EncryptionMeta;
    const vaultKey = await unlockVaultKey(meta, currentPass); // throws when wrong
    const { meta: newMeta, recoveryCode: code } = await rewrapVaultKey(vaultKey, newPass);
    await vaultsApi.updateEncryption(vault.id, newMeta); // ApiError on failure
    vaultKeySession.set(vault.id, vaultKey);
    setVaultList((prev) =>
      prev.map((v) => (v.id === vault.id ? { ...v, encryption_meta: newMeta } : v)),
    );
    setRecoveryCode(code);
  }, []);

  // Encrypts the active standard vault end to end (#361): every note is
  // encrypted here and swapped in at once on the server. Unsaved edits go out
  // first so they are part of it; local drafts (plaintext on disk) are removed.
  const handleEncryptVault = useCallback(async (passphrase: string) => {
    const vault = vaultListRef.current.find((v) => v.id === activeVaultIdRef.current);
    if (!vault || vault.encryption !== "none") throw new Error("not a standard vault");
    await flushPendingSave();
    const { vault: converted, vaultKey, recoveryCode: code } = await convertVaultToE2ee(vault.id, passphrase, {
      listNotes: (id) => notesApi.list(id),
      listLinks: (id) => linksApi.list(id),
      convert: (id, meta, notes, links) => vaultsApi.convertToE2ee(id, meta, notes, links),
    });
    vaultKeySession.set(converted.id, vaultKey);
    setVaultList((prev) => prev.map((v) => (v.id === converted.id ? { ...v, ...converted } : v)));
    for (const n of noteListRef.current) clearDraft(n.id);
    setRecoveryCode(code);
  }, [flushPendingSave]);

  /** Derives the key from the passphrase; rejects (dialog shows the error) when wrong. */
  const handleUnlockVault = useCallback(async (passphrase: string) => {
    const vault = vaultListRef.current.find((v) => v.id === unlockVaultId);
    if (!vault) return;
    const key = await unlockVaultKey(vault.encryption_meta as EncryptionMeta, passphrase);
    vaultKeySession.set(vault.id, key);
    setUnlockVaultId(null);
    loadNotes(vault.id);
  }, [unlockVaultId, loadNotes]);

  /**
   * Recovery (#176): the backup code unwraps the Vault Key, the vault is
   * re-wrapped under the new passphrase, and a fresh recovery code replaces
   * the used one — a recovery code is single-use by design.
   */
  const handleRecoverVault = useCallback(async (code: string, newPassphrase: string) => {
    const vault = vaultListRef.current.find((v) => v.id === unlockVaultId);
    if (!vault) return;
    const vaultKey = await recoverVaultKey(vault.encryption_meta as EncryptionMeta, code);
    const { meta: newMeta, recoveryCode: freshCode } = await rewrapVaultKey(vaultKey, newPassphrase);
    await vaultsApi.updateEncryption(vault.id, newMeta);
    vaultKeySession.set(vault.id, vaultKey);
    setVaultList((prev) =>
      prev.map((v) => (v.id === vault.id ? { ...v, encryption_meta: newMeta } : v)),
    );
    setUnlockVaultId(null);
    setRecoveryCode(freshCode);
    loadNotes(vault.id);
  }, [unlockVaultId, loadNotes]);

  const handleCreateVault = useCallback(async (name: string, passphrase?: string) => {
    const isFirstVault = vaultListRef.current.length === 0;
    let vault: Vault;
    if (passphrase) {
      // E2EE vault: all key material is produced client-side; the server only
      // ever receives the opaque meta blob (docs/encryption.md).
      const { meta, vaultKey, recoveryCode: code } = await setupVaultEncryption(passphrase);
      vault = await vaultsApi.create(name, { encryption: "e2ee", encryption_meta: meta });
      vaultKeySession.set(vault.id, vaultKey);
      setRecoveryCode(code);
    } else {
      vault = await vaultsApi.create(name);
    }
    setShowNewVault(false);
    setVaultList((prev) => [...prev, vault]);
    setActiveVaultId(vault.id);

    if (!isFirstVault) {
      setNoteList([]);
      return;
    }

    // A new account gets the first-launch checklist (#447).
    startChecklist();

    // Seed a fresh account's first vault with example notes so it isn't empty.
    // For an e2ee vault the seeds are encrypted like any other note; state
    // keeps the plaintext so the editor and graph work on readable content.
    const created: Note[] = [];
    for (const n of welcomeNotes(new Date(), loadPrefs().dailyTemplate)) {
      try {
        const { content, checksum } = await encryptNoteForVault(vault, n.content);
        const title = await encryptFieldForVault(vault, n.title);
        const path = await encryptFieldForVault(vault, n.path);
        const note = await notesApi.create(vault.id, title, path, content, checksum);
        created.push({ ...note, title: n.title, path: n.path, content: n.content });
      } catch {
        /* skip a note that failed to create */
      }
    }
    // Seeding takes a moment: keep any note the user made (or got via sync)
    // meanwhile instead of replacing the list.
    const seeded = new Set(created.map((n) => n.id));
    setNoteList((prev) => [...created, ...prev.filter((n) => !seeded.has(n.id))]);

    // The quick-start guide sits in Starred (#449).
    const guide = created.find((n) => n.title === QUICK_START_TITLE);
    if (guide) {
      starsApi
        .star(guide.id)
        .then(() => setStarredIds((prev) => (prev.includes(guide.id) ? prev : [...prev, guide.id])))
        .catch(() => {});
    }

    // Open the Welcome note so the user lands on something useful, unless
    // they already opened something while the notes were being created.
    const welcome = created.find((n) => n.title === "Welcome");
    if (welcome && tabsRef.current.length === 0 && !activeNoteRef.current) {
      setTabs([{ key: welcome.id, type: "note" }]);
      setActiveTabKey(welcome.id);
      setActiveNote(welcome);
      setEditorContent(welcome.content);
      setSaveStatus("saved");
    }
  }, []);

  const handleSelectNote = useCallback(async (noteId: string) => {
    // Only the latest selection may apply its result: a click while an
    // earlier one is still loading would otherwise leave the tab bar on one
    // note and the editor on another.
    const selection = ++selectionSeq.current;
    // Save any unsaved title/content of the outgoing note first (#204).
    if (activeNoteRef.current && activeNoteRef.current.id !== noteId) {
      await flushPendingSave();
      if (selection !== selectionSeq.current) return;
    }
    keyboardCursorRef.current = noteId;
    if (activeVaultIdRef.current) {
      setRecentIds(pushRecent(activeVaultIdRef.current, noteId));
    }
    setTabs((prev) =>
      prev.some((t) => t.key === noteId) ? prev : [...prev, { key: noteId, type: "note" }],
    );
    setActiveTabKey(noteId);
    // The open note stays as it is (e.g. back from the graph view): its text,
    // unsaved edits included, is what the editor starts from (initialText).
    if (activeNoteRef.current?.id === noteId) return;
    // A note that takes a moment to arrive shows a placeholder (#435); a quick
    // one never does, so switching notes doesn't flicker.
    const slow = setTimeout(() => {
      if (selection === selectionSeq.current) setLoadingNoteId(noteId);
    }, 150);
    let note: Note;
    try {
      note = await decryptIncoming(await notesApi.get(noteId));
    } finally {
      clearTimeout(slow);
      if (selection === selectionSeq.current) setLoadingNoteId(null);
    }
    if (selection !== selectionSeq.current) return;
    // Restore unsaved local text (a draft after an abrupt close, or for e2ee
    // vaults the in-memory text of a save the server hasn't confirmed) so work
    // isn't lost. It opens on the version it was written against, not on this
    // fresh server copy, so saving it gets a 409 if another device changed the
    // note in between instead of silently overwriting that edit.
    const local = localCopy(note);
    if (local) {
      setActiveNote({ ...note, content: local.content, checksum: local.checksum });
      setEditorContent(local.content);
      setSaveStatus("unsaved");
    } else {
      setActiveNote(note);
      setEditorContent(note.content);
      setSaveStatus("saved");
    }
    setCursor({ line: 1, col: 1 });
  }, [decryptIncoming, flushPendingSave, localCopy]);

  // Keyboard navigation of the file tree: Up/Down move a single-note highlight
  // through the visible order, Enter opens it. Ignored while typing, in the
  // graph, or when a modal/menu is open.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (modalOpenRef.current || graphActiveRef.current) return;
      const order = flattenedNoteIdsRef.current;
      if (order.length === 0) return;

      if (e.key === "Enter") {
        const cur = keyboardCursorRef.current;
        if (cur && order.includes(cur)) {
          e.preventDefault();
          handleSelectNote(cur);
        }
        return;
      }

      e.preventDefault();
      const cur = keyboardCursorRef.current ?? activeNoteRef.current?.id ?? null;
      const at = cur ? order.indexOf(cur) : -1;
      const next = e.key === "ArrowDown"
        ? Math.min(order.length - 1, at + 1)
        : Math.max(0, at < 0 ? 0 : at - 1);
      const id = order[next];
      keyboardCursorRef.current = id;
      setSelectedIds(new Set([id]));
      requestAnimationFrame(() =>
        document.querySelector(`[data-note-id="${id}"]`)?.scrollIntoView({ block: "nearest" }),
      );
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSelectNote]);

  // Tree click: Ctrl/Cmd toggles a note in the multi-selection; a plain click
  // opens the note and clears the selection. Shift is reserved for marquee
  // (drag-to-select) handled in the sidebar.
  const handleNoteClick = useCallback((e: React.MouseEvent, id: string) => {
    if (e.shiftKey) {
      e.preventDefault();
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    setSelectedIds(new Set());
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
      } else if (activeNoteRef.current?.id === key) {
        // Closing the open note's tab from behind another tab (the graph):
        // unload it too, or the graph keeps highlighting a closed note.
        setActiveNote(null);
        setEditorContent("");
        setSaveStatus("idle");
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
    markDirty();
  }, [markDirty]);

  // On commit (blur/Enter), make the title unique against the other notes so two
  // notes can't share a name — like on create (Untitled, Untitled 1, …).
  const handleRenameCommit = useCallback((title: string) => {
    const current = activeNoteRef.current;
    if (!current) return;
    const others = new Set(noteListRef.current.filter((n) => n.id !== current.id).map((n) => n.title));
    const unique = uniqueTitle(others, title.trim() || "Untitled");
    if (unique !== current.title) {
      setActiveNote((prev) => (prev ? { ...prev, title: unique } : prev));
      setNoteList((prev) => prev.map((n) => (n.id === current.id ? { ...n, title: unique } : n)));
      markDirty();
    }
    // Persist any pending rename now: per-keystroke renames only touch local
    // state and nothing else ever saves them when the content is never
    // edited (#204). The timeout lets the state updates land first.
    setTimeout(() => {
      if (saveStatusRef.current === "unsaved") {
        handleSaveNoteRef.current(editorContentRef.current);
      }
    }, 0);
  }, [markDirty]);

  // destroy() closes the window unconditionally (bypassing onCloseRequested), so
  // the app always actually closes once the user has confirmed.
  const closeWindowNow = useCallback(async () => {
    if (isTauriWindow) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().destroy();
    } else {
      window.close();
    }
  }, []);

  // Finish a confirmed close: the note tab, the session, or the whole window.
  const finishClose = useCallback(async (prompt: ClosePrompt) => {
    if (prompt.kind === "tab") {
      closeTabRef.current(prompt.key);
    } else if (prompt.kind === "signout") {
      signOutNow();
    } else {
      await closeWindowNow();
    }
  }, [closeWindowNow, signOutNow]);

  // Nothing closes over unsaved text until the server confirmed the save; a
  // failed save keeps the dialog open with the reason (#283). "Close without
  // saving" truly discards: the local draft and any pending retry are dropped
  // so the note reverts to its saved version and a later close doesn't re-prompt.
  const closeGuard = useCloseGuard({
    prompt: closePrompt,
    setPrompt: setClosePrompt,
    // Tabs only concern the open note; window close and sign-out also save
    // the unconfirmed text of notes the user has left.
    save: () =>
      closePrompt?.kind === "tab"
        ? handleSaveNote(editorContentRef.current)
        : saveAllNotes(isDirtyStatus(saveStatusRef.current)),
    discard: discardUnsaved,
    finishClose,
  });
  const { saveThenClose } = closeGuard;

  // Warn before losing unsaved work on close. In the browser, the native
  // beforeunload prompt; in the native app, intercept the close and show our own
  // Save / Don't save / Cancel dialog (like Word).
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedWork()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    let unlisten: (() => void) | undefined;
    if (isTauriWindow) {
      (async () => {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        unlisten = await win.onCloseRequested(async (event) => {
          // Fires for OS-level close (Alt+F4 / taskbar); the visible close button
          // routes through requestClose() + destroy() and does not come here.
          // Save first and close once it's confirmed; a failed or still-pending
          // save opens the close dialog with the reason instead of closing.
          // Notes the user has left count too: their failed save would
          // otherwise vanish with the window.
          if (hasUnsavedWork()) {
            event.preventDefault();
            await saveThenClose({ kind: "window" });
          }
        });
      })().catch(() => {});
    }

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      unlisten?.();
    };
  }, [saveThenClose, hasUnsavedWork]);

  // The visible window close button routes through here (a real React click) so
  // the unsaved-changes dialog renders reliably; with nothing unsaved in any
  // note it closes at once.
  const requestClose = useCallback(() => {
    if (hasUnsavedWork()) {
      setClosePrompt({ kind: "window" });
    } else {
      closeWindowNow();
    }
  }, [closeWindowNow, hasUnsavedWork]);

  // Closing a note tab warns (like Visual Studio) when that note is unsaved.
  const requestCloseTab = useCallback((key: string) => {
    const tab = tabsRef.current.find((t) => t.key === key);
    const dirty =
      key === activeTabKeyRef.current &&
      tab?.type === "note" &&
      isDirtyStatus(saveStatusRef.current);
    if (dirty) {
      setClosePrompt({ kind: "tab", key });
    } else {
      closeTabRef.current(key);
    }
  }, []);

  const handleCursorChange = useCallback((line: number, col: number) => {
    setCursor((prev) => (prev.line === line && prev.col === col ? prev : { line, col }));
  }, []);

  const graphData = useMemo(() => buildGraphData(noteList), [noteList]);
  const tagCounts = useMemo(() => buildTagCounts(noteList), [noteList]);
  const folders = useMemo(() => topLevelFolders(noteList), [noteList]);
  const starredSet = useMemo(() => new Set(starredIds), [starredIds]);
  // Starred notes of the ACTIVE vault, in star order (stars span vaults).
  const starredNotes = useMemo(
    () =>
      starredIds
        .map((id) => noteList.find((n) => n.id === id))
        .filter((n): n is Note => n !== undefined)
        .map((n) => ({ id: n.id, title: n.title })),
    [starredIds, noteList],
  );
  const recentNotes = useMemo(
    () =>
      recentIds
        .map((id) => noteList.find((n) => n.id === id))
        .filter((n): n is Note => n !== undefined)
        .map((n) => ({ id: n.id, title: n.title })),
    [recentIds, noteList],
  );
  const filteredNoteList = useMemo(
    () => sortNotes(filterNotes(noteList, filterTags, filterFolder), sortBy),
    [noteList, filterTags, filterFolder, sortBy],
  );
  const searchHits = useMemo(() => searchNotes(noteList, searchQuery), [noteList, searchQuery]);

  const toggleTagFilter = useCallback((tag: string) => {
    setFilterTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }, []);

  // Renames a tag (and its nested children) across every note that carries it
  // (#154). Runs client-side over the in-memory plaintext so it works for e2ee
  // vaults; each changed note is re-encrypted on save. Any active tag filter
  // that referenced the old tag is remapped to the new one.
  const handleRenameTag = useCallback(async (oldTag: string, rawNewTag: string) => {
    const from = normalizeTag(oldTag);
    const to = normalizeTag(rawNewTag);
    setRenameTag(null);
    if (!to || from === to) return;

    const affected = noteListRef.current.filter((n) =>
      contentHasTag(extractTags(n.content), from),
    );
    for (const note of affected) {
      const newContent = renameTagInContent(note.content, from, to);
      if (newContent === note.content) continue;
      try {
        const { content: payload, checksum } = await encryptOutgoing(note.vault_id, newContent);
        const sealed = await sealMeta(note.vault_id, note.title, note.path);
        const updated = await notesApi.update(note.id, sealed.title, sealed.path, payload, note.checksum, checksum);
        if ("checksum" in updated) {
          const u = { ...(updated as Note), title: note.title, path: note.path, content: newContent };
          setNoteList((prev) => prev.map((n) => (n.id === u.id ? u : n)));
          setActiveNote((prev) => (prev?.id === u.id ? u : prev));
          if (activeNoteRef.current?.id === u.id) setEditorContent(newContent);
        }
      } catch {
        /* skip a note that failed to save; the rest still proceed */
      }
    }
    // Remap an active filter on the renamed tag (or a descendant) onto the new name.
    setFilterTags((prev) =>
      prev.map((t) => (t === from || t.startsWith(`${from}/`) ? to + t.slice(from.length) : t)),
    );
  }, [encryptOutgoing, sealMeta]);

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

  // Email-link flows (verify-email / reset-password) render before the normal
  // auth screen since the user arrives from an email while signed out (#47/#48).
  if (authAction) {
    return (
      <AuthAction
        action={authAction}
        onDone={() => {
          clearAuthActionUrl();
          setAuthAction(null);
        }}
      />
    );
  }

  if (serverDown) {
    return <ServerUnavailable onRecovered={restore} />;
  }

  if (!user) {
    return (
      <>
        <Auth onAuth={handleAuth} reducedMotion={reducedMotion} />
        <Toaster />
      </>
    );
  }

  const tree = buildTree(filteredNoteList, { keepNoteOrder: true, emptyFolders });
  const activeVault = vaultList.find((v) => v.id === activeVaultId);
  const tabItems = tabs.map((t) => ({
    ...t,
    title: t.type === "graph" ? "Graph" : noteList.find((n) => n.id === t.key)?.title ?? "Untitled",
  }));
  const activeTab = tabs.find((t) => t.key === activeTabKey) ?? null;
  const graphActive = activeTab?.type === "graph";

  // Refs kept fresh for the keyboard-navigation handler (which runs off a stable
  // window listener).
  flattenedNoteIdsRef.current = flattenTreeNoteIds(tree);
  graphActiveRef.current = graphActive;
  const activeVaultLocked = isVaultLocked(activeVault);

  modalOpenRef.current =
    paletteQuery !== null || showGlobalSearch || showSettings || showCalendar ||
    showNewVault || recoveryCode !== null || unlockVaultId !== null ||
    showTemplatePicker || renameTag !== null || shareVaultId !== null ||
    linksVaultId !== null || ctxMenu !== null || workspaceMenu !== null;

  return (
    <div
      className="workspace"
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
      {/* First Tab stop: jump past the chrome to the editor (#267). */}
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          const editor = document.querySelector<HTMLElement>(".editor-textarea");
          (editor ?? document.getElementById("main-content"))?.focus();
        }}
      >
        Skip to editor
      </a>
      <ConnectionBanner />
      {user.deletion_scheduled_at && (
        <div className="deletion-banner" role="alert">
          This account and everything in it will be deleted on{" "}
          {new Date(user.deletion_scheduled_at).toLocaleString()}.
          <button
            className="deletion-banner-btn"
            onClick={() =>
              auth
                .keepAccount()
                .then(() => {
                  setUser((u) => (u ? { ...u, deletion_scheduled_at: undefined } : u));
                  toast("Your account is kept. The deletion is cancelled.", { kind: "success" });
                })
                .catch(() => toast("Couldn't cancel the deletion. Try again.", { kind: "error" }))
            }
          >
            Keep my account
          </button>
        </div>
      )}
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
        onRequestClose={requestClose}
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
              activeVaultLocked={activeVaultLocked}
              loading={notesLoading}
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
              onSetSelectedIds={setSelectedIds}
              onCreateNote={handleCreateNote}
              onImportNotes={() => importFolderRef.current?.click()}
              onCreateNoteInFolder={handleCreateNoteInFolder}
              onCreateFolder={handleCreateFolder}
              onMoveNote={handleMoveNote}
              onDeleteFolder={handleDeleteFolder}
              newFolderNonce={newFolderNonce}
              onRequestNewVault={() => setShowNewVault(true)}
              onShareVault={setShareVaultId}
              onOpenLinks={setLinksVaultId}
              onToggleTag={toggleTagFilter}
              onRenameTag={setRenameTag}
              onSetFolder={setFilterFolder}
              onSetSort={setSortBy}
              onClearFilters={clearFilters}
              onSearchChange={setSearchQuery}
              onSignOut={handleSignOut}
              starredIds={starredSet}
              starredNotes={starredNotes}
              recentNotes={recentNotes}
              unsavedNoteId={
                isDirtyStatus(saveStatus) ? activeNote?.id ?? null : null
              }
              onNoteContextMenu={(e, noteId) =>
                setCtxMenu({
                  x: Math.min(e.clientX, window.innerWidth - 195),
                  y: Math.min(e.clientY, window.innerHeight - 280),
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
        <div className="center-column" id="main-content" tabIndex={-1}>
          {vaultList.length > 0 && tabs.length > 0 && (
            <TabBar
              tabs={tabItems}
              activeKey={activeTabKey}
              unsavedKey={isDirtyStatus(saveStatus) ? activeTabKey : null}
              onSelect={(key) => {
                const tab = tabs.find((t) => t.key === key);
                if (tab?.type === "note") handleSelectNote(key);
                else setActiveTabKey(key);
              }}
              onClose={requestCloseTab}
              onNew={handleCreateNote}
            />
          )}
          {!graphActive && activeNote && saveStatus === "conflict" && (
            <ConflictNotice
              onResolve={
                conflictVersion(activeNote.id)
                  ? () => setConflictPrompt({ noteId: activeNote.id, busy: false, error: null })
                  : undefined
              }
            />
          )}
          {vaultList.length === 0 ? (
            <FirstRunVault onCreate={handleCreateVault} />
          ) : activeVaultLocked ? (
            <div className="workspace-empty">
              <div className="workspace-empty-logo">
                <svg width="52" height="52" viewBox="0 0 16 16" fill="none" style={{ color: "var(--accent)" }}>
                  <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.1" />
                  <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.1" />
                </svg>
              </div>
              <p className="workspace-empty-title">This vault is locked</p>
              <div className="workspace-empty-actions">
                <button
                  className="workspace-empty-action"
                  onClick={() => activeVaultId && setUnlockVaultId(activeVaultId)}
                >
                  <span>Unlock with passphrase</span>
                </button>
              </div>
            </div>
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
            notesLoading && graphData.nodes.length === 0 ? (
              <SkeletonGraph />
            ) : (
              <GraphView
                data={graphData}
                activeNoteId={activeNote?.id ?? null}
                onSelectNote={handleSelectNote}
                onCreateNote={handleCreateNoteWithTitle}
              />
            )
          ) : loadingNoteId !== null && loadingNoteId === activeTabKey ? (
            <SkeletonNote />
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
              onLiveChange={handleLiveChange}
              onTagClick={(tag) => {
                setFilterTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
                setRailView("files");
                updatePrefs({ leftOpen: true });
              }}
              onSave={handleSaveNote}
              onRename={handleRenameNote}
              onRenameCommit={handleRenameCommit}
              onCreateNote={handleCreateNoteWithTitle}
              onNavigateToNote={handleSelectNote}
              paused={closePrompt !== null}
              insertRequest={insertRequest}
              replaceRequest={replaceRequest}
              onReplaceApplied={handleReplaceApplied}
              onReplaceRejected={handleReplaceRejected}
              onPresenceChange={handleEditorPresence}
              initialText={editorContent}
              attachmentBlockReason={attachmentBlockReason(activeVault)}
              vault={activeVault}
              readOnly={creatingNote}
              savedFlash={savedFlash}
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
              onCreateNote={handleCreateNoteWithTitle}
              vault={activeNote ? vaultList.find((v) => v.id === activeNote.vault_id) ?? null : null}
              canWrite={(vaultList.find((v) => v.id === activeNote?.vault_id)?.role ?? "owner") !== "viewer"}
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
          saveError={saveError && saveError.noteId === activeNote?.id ? saveError : null}
          hasNote={!graphActive && !!activeNote}
          lastSyncLabel={lastSyncAt ? relativeTimeLabel(lastSyncAt) : null}
          line={cursor.line}
          col={cursor.col}
          viewMode={prefs.viewMode}
          onCycleView={cycleView}
        />
      )}

      <Toaster />
      <ConsentBanner />
      {/* Pickers for importing notes (#451); a folder keeps its structure. */}
      <input
        ref={importFolderRef}
        type="file"
        hidden
        multiple
        {...{ webkitdirectory: "" }}
        onChange={(e) => {
          void handleImportFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={importFilesRef}
        type="file"
        hidden
        multiple
        accept=".md,.markdown,text/markdown"
        onChange={(e) => {
          void handleImportFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <AnimatePresence>
        {showSettings && (
          <Settings
            key="settings"
            prefs={prefs}
            osReducedMotion={osReducedMotion}
            lastSyncLabel={lastSyncAt ? relativeTimeLabel(lastSyncAt) : null}
            activeVault={activeVault ?? null}
            onChangePassphrase={handleChangePassphrase}
            onEncryptVault={handleEncryptVault}
            onExportVault={handleExportVault}
            onUpdatePrefs={updatePrefs}
            onSignOut={handleSignOut}
            onClose={() => setShowSettings(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {conflictPrompt && activeNote?.id === conflictPrompt.noteId && (
          <ConflictDialog
            key="conflict"
            noteTitle={activeNote.title}
            mine={editorContent}
            theirs={conflictVersion(conflictPrompt.noteId)}
            busy={conflictPrompt.busy}
            error={conflictPrompt.error}
            onResolve={handleResolveConflict}
            onCancel={() => setConflictPrompt(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {closePrompt && (
          <CloseConfirmDialog
            key="close-confirm"
            noteTitles={(() => {
              // The failed note in the error form; otherwise every note whose
              // text "without saving" would drop (a tab concerns only its note).
              const ids = closeGuard.error
                ? [closeGuard.error.noteId]
                : [
                    ...(activeNote && isDirtyStatus(saveStatus) ? [activeNote.id] : []),
                    ...(closePrompt.kind === "tab" ? [] : unconfirmedNoteIds()),
                  ];
              return [...new Set(ids)].map(
                (id) => noteList.find((n) => n.id === id)?.title ?? (activeNote?.id === id ? activeNote.title : ""),
              );
            })()}
            kind={closePrompt.kind}
            saving={closeGuard.saving}
            error={closeGuard.error}
            onCancel={closeGuard.cancel}
            onDiscard={closeGuard.discardAndClose}
            onSave={closeGuard.saveAndClose}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {ctxMenu && (
          <ContextMenu
            key="ctx-menu"
            x={ctxMenu.x}
            y={ctxMenu.y}
            onClose={() => setCtxMenu(null)}
            items={[
              { key: "open", label: "Open", onClick: () => handleSelectNote(ctxMenu.noteId) },
              { key: "duplicate", label: "Duplicate", onClick: () => handleDuplicateNote(ctxMenu.noteId) },
              {
                key: "history",
                label: "Version history",
                onClick: () => {
                  const id = ctxMenu.noteId;
                  if (activeNoteRef.current?.id === id) openHistory();
                  else void handleSelectNote(id).then(() => activeNoteRef.current?.id === id && openHistory());
                },
              },
              {
                key: "star",
                label: starredSet.has(ctxMenu.noteId) ? "Remove star" : "Star",
                onClick: () => handleToggleStar(ctxMenu.noteId),
              },
              {
                key: "export-md",
                label: "Export as Markdown",
                onClick: () => {
                  const n = noteList.find((x) => x.id === ctxMenu.noteId);
                  if (!n) return;
                  downloadFile(`${safeFilename(n.title)}.md`, "text/markdown", stripFrontmatter(n.content));
                  toast(`Exported “${n.title}” as Markdown`, { kind: "success" });
                },
              },
              {
                key: "export-html",
                label: "Export as HTML",
                onClick: () => {
                  const n = noteList.find((x) => x.id === ctxMenu.noteId);
                  if (!n) return;
                  downloadFile(`${safeFilename(n.title)}.html`, "text/html", noteToHtmlDocument(n));
                  toast(`Exported “${n.title}” as HTML`, { kind: "success" });
                },
              },
              {
                key: "export-pdf",
                label: "Export as PDF…",
                onClick: () => {
                  const n = noteList.find((x) => x.id === ctxMenu.noteId);
                  if (n) printNote(n);
                },
              },
              {
                key: "wikilink",
                label: "Copy wikilink",
                onClick: () => {
                  const n = noteList.find((x) => x.id === ctxMenu.noteId);
                  if (!n) return;
                  navigator.clipboard
                    ?.writeText(`[[${n.title}]]`)
                    .then(() => toast(`Copied [[${n.title}]]`, { kind: "success", key: "copy-link" }))
                    .catch(() => toast("Couldn't copy the link", { kind: "error", key: "copy-link" }));
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
      </AnimatePresence>

      <AnimatePresence>
        {workspaceMenu && (
          <ContextMenu
            key="workspace-menu"
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
      </AnimatePresence>

      <AnimatePresence>
        {showNewVault && (
          <CreateVaultDialog
            key="new-vault"
            onCreate={handleCreateVault}
            onClose={() => setShowNewVault(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {recoveryCode && (
          <RecoveryCodeDialog key="recovery-code" code={recoveryCode} onDone={() => setRecoveryCode(null)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {unlockVaultId && (
          <UnlockVaultDialog
            key="unlock-vault"
            vaultName={vaultList.find((v) => v.id === unlockVaultId)?.name ?? "Vault"}
            onUnlock={handleUnlockVault}
            onRecover={handleRecoverVault}
            onCancel={() => setUnlockVaultId(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showTemplatePicker && (
          <TemplatePicker
            key="template-picker"
            templates={listTemplates(noteList)}
            onPick={handlePickTemplate}
            onClose={() => setShowTemplatePicker(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {renameTag && (
          <RenameTagDialog
            key="rename-tag"
            tag={renameTag}
            affectedCount={noteList.filter((n) => contentHasTag(extractTags(n.content), renameTag)).length}
            onRename={handleRenameTag}
            onClose={() => setRenameTag(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {shareVaultId && user && (() => {
          const v = vaultList.find((x) => x.id === shareVaultId);
          if (!v) return null;
          return (
            <SharingDialog
              key="sharing"
              vault={v}
              currentUserId={user.id}
              isOwner={(v.role ?? "owner") === "owner"}
              onClose={() => setShareVaultId(null)}
              onLeft={() => {
                setShareVaultId(null);
                setVaultList((prev) => prev.filter((x) => x.id !== v.id));
                if (activeVaultId === v.id) {
                  const next = vaultListRef.current.find((x) => x.id !== v.id);
                  if (next) handleSelectVault(next.id);
                }
              }}
            />
          );
        })()}
      </AnimatePresence>

      <AnimatePresence>
        {showShortcuts && <ShortcutsDialog key="shortcuts" onClose={() => setShowShortcuts(false)} />}
      </AnimatePresence>

      <AnimatePresence>
        {historyOpen && activeNote && (() => {
          const v = vaultList.find((x) => x.id === activeNote.vault_id);
          if (!v) return null;
          return (
            <VersionHistoryDialog
              key={`history-${activeNote.id}`}
              note={activeNote}
              vault={v}
              currentText={editorContent}
              canWrite={(v.role ?? "owner") !== "viewer"}
              thisDeviceId={getDeviceId()}
              deviceNames={deviceNames}
              onRestore={handleRestoreVersion}
              onClose={() => setHistoryOpen(false)}
            />
          );
        })()}
      </AnimatePresence>

      <AnimatePresence>
        {linksVaultId && (() => {
          const v = vaultList.find((x) => x.id === linksVaultId);
          if (!v) return null;
          return (
            <LinkedFilesDialog
              key="linked-files"
              vault={v}
              canWrite={(v.role ?? "owner") !== "viewer"}
              onClose={() => setLinksVaultId(null)}
            />
          );
        })()}
      </AnimatePresence>

      <AnimatePresence>
        {showCalendar && (
          <DailyCalendar
            key="calendar"
            noteTitles={new Set(noteList.map((n) => n.title))}
            onPickDay={handleOpenDaily}
            onOpenToday={() => handleOpenDaily(toIsoDate(new Date()))}
            onClose={() => setShowCalendar(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showGlobalSearch && activeVaultId && (
          <GlobalSearch
            key="global-search"
            vaultId={activeVaultId}
            clientNotes={isE2eeVault(activeVault) ? noteList : null}
            onSelect={handleSelectNote}
            onClose={() => setShowGlobalSearch(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {paletteQuery !== null && (
          <CommandPalette
            key="palette"
            notes={noteList}
            commands={commands}
            initialQuery={paletteQuery}
            onSelectNote={handleSelectNote}
            onClose={() => setPaletteQuery(null)}
          />
        )}
      </AnimatePresence>

    </div>
  );
}

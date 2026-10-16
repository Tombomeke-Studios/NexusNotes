import { base64ToBytes, bytesToBase64, decryptBytes, encryptBytes } from "./crypto";
import { vaultKeySession } from "./vaultKeys";

const KEY_PREFIX = "nexus_folders_";
const SEALED_PREFIX = "nexus_sealed_folders_";
const FORMAT = 1;

/** Normalize a folder path: trim segments, drop empties, forward slashes. */
export function normalizeFolderPath(path: string): string {
  return path
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean)
    .join("/");
}

/**
 * Explicitly-created (possibly empty) folders per vault, persisted client-side.
 * Folders that contain notes are derived from note paths by buildTree; this set
 * keeps empty folders — which have no note to hang off — alive across reloads.
 *
 * In an end-to-end encrypted vault the folder names are as private as the
 * note paths, so they are stored sealed under the vault key (AES-GCM, fresh
 * IV per write, the vault id as additional data). While the vault is
 * unlocked its list lives in memory (`openFolders` loads it on unlock,
 * `forgetFolders` drops it on lock); a vault whose key is in the session is
 * treated as encrypted, since standard vaults never have one.
 */

/** Decrypted folder lists of unlocked encrypted vaults. */
const opened = new Map<string, string[]>();
/** Sealed writes per vault, one after the other. */
const writes = new Map<string, Promise<void>>();

const encoder = new TextEncoder();
const additionalData = (vaultId: string) => encoder.encode(`nexusnotes:folders:v${FORMAT}:${vaultId}`);

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function readPlain(vaultId: string): string[] {
  try {
    return parseList(localStorage.getItem(KEY_PREFIX + vaultId));
  } catch {
    return [];
  }
}

async function readSealed(vaultId: string, key: Uint8Array): Promise<string[]> {
  let raw: string | null;
  try {
    raw = localStorage.getItem(SEALED_PREFIX + vaultId);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const stored = JSON.parse(raw) as { v?: unknown; data?: unknown };
    if (stored.v !== FORMAT || typeof stored.data !== "string") return [];
    const plain = await decryptBytes(base64ToBytes(stored.data), key, additionalData(vaultId));
    return parseList(new TextDecoder().decode(plain));
  } catch {
    return [];
  }
}

/** Seals the list to disk; a readable copy from before is removed once the sealed one is stored. */
function persistSealed(vaultId: string, folders: string[], key: Uint8Array): Promise<void> {
  const previous = writes.get(vaultId) ?? Promise.resolve();
  const next = previous.then(async () => {
    try {
      const sealed = await encryptBytes(encoder.encode(JSON.stringify(folders)), key, additionalData(vaultId));
      localStorage.setItem(SEALED_PREFIX + vaultId, JSON.stringify({ v: FORMAT, data: bytesToBase64(sealed) }));
      localStorage.removeItem(KEY_PREFIX + vaultId);
    } catch {
      /* storage full / unavailable: best effort, like the plain list */
    }
  });
  writes.set(vaultId, next);
  void next.then(() => {
    if (writes.get(vaultId) === next) writes.delete(vaultId);
  });
  return next;
}

function save(vaultId: string, folders: string[]) {
  const key = vaultKeySession.get(vaultId);
  if (key) {
    opened.set(vaultId, folders);
    void persistSealed(vaultId, folders, key);
    return;
  }
  localStorage.setItem(KEY_PREFIX + vaultId, JSON.stringify(folders));
}

export function loadFolders(vaultId: string): string[] {
  if (vaultKeySession.get(vaultId)) {
    // Not opened yet (a vault just encrypted here): only a readable list from
    // before can exist, and it is sealed on the next change.
    return opened.get(vaultId) ?? readPlain(vaultId);
  }
  // Locked (or never encrypted): nothing decrypted stays in memory.
  opened.delete(vaultId);
  return readPlain(vaultId);
}

/**
 * Loads an encrypted vault's folder names after it was unlocked. A readable
 * list left from before they were sealed is merged in, stored sealed and
 * removed. Resolves to the list (empty when the vault is locked again).
 */
export async function openFolders(vaultId: string): Promise<string[]> {
  const key = vaultKeySession.get(vaultId);
  if (!key) return [];
  await (writes.get(vaultId) ?? Promise.resolve());
  const sealed = await readSealed(vaultId, key);
  const legacy = readPlain(vaultId);
  const merged = [...sealed, ...legacy.filter((f) => !sealed.includes(f))];
  if (vaultKeySession.get(vaultId) !== key) return [];
  opened.set(vaultId, merged);
  if (legacy.length > 0) await persistSealed(vaultId, merged, key);
  return merged;
}

/** Drops an encrypted vault's decrypted folder names from memory (it was locked). */
export function forgetFolders(vaultId: string): void {
  opened.delete(vaultId);
}

/** Resolves once every sealed folder write under way is stored. */
export async function flushFolders(): Promise<void> {
  while (writes.size > 0) await Promise.all([...writes.values()]);
}

export function addFolder(vaultId: string, path: string): string[] {
  const clean = normalizeFolderPath(path);
  const folders = loadFolders(vaultId);
  if (!clean || folders.includes(clean)) return folders;
  const next = [...folders, clean];
  save(vaultId, next);
  return next;
}

/** Remove a folder and any of its subfolders from the set. */
export function removeFolder(vaultId: string, path: string): string[] {
  const clean = normalizeFolderPath(path);
  const next = loadFolders(vaultId).filter(
    (f) => f !== clean && !f.startsWith(clean + "/"),
  );
  save(vaultId, next);
  return next;
}

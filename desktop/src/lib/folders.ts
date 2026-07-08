const KEY_PREFIX = "nexus_folders_";

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
 */
export function loadFolders(vaultId: string): string[] {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + vaultId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function save(vaultId: string, folders: string[]) {
  localStorage.setItem(KEY_PREFIX + vaultId, JSON.stringify(folders));
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

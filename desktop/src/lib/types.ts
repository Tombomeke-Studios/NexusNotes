export interface User {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
  updated_at: string;
}

export interface Vault {
  id: string;
  user_id: string;
  name: string;
  encryption: "none" | "e2ee";
  /** Opaque client-written key material for e2ee vaults (see lib/vaultKeys). */
  encryption_meta?: unknown;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  vault_id: string;
  path: string;
  title: string;
  content: string;
  checksum: string;
  created_at: string;
  updated_at: string;
}

export interface NoteVersion {
  id: string;
  note_id: string;
  content: string;
  checksum: string;
  device_id: string;
  created_at: string;
}

export interface ConflictInfo {
  note_id: string;
  server_content: string;
  server_checksum: string;
  client_content: string;
  client_checksum: string;
}

export interface Device {
  id: string;
  user_id: string;
  name: string;
  platform: string;
  last_seen: string;
  created_at: string;
}

export interface TreeNode {
  name: string;
  path: string;
  type: "folder" | "note";
  children?: TreeNode[];
  noteId?: string;
}

export interface BacklinkNote {
  id: string;
  vault_id: string;
  path: string;
  title: string;
  updated_at: string;
}

export interface SearchHit {
  id: string;
  vault_id: string;
  title: string;
  path: string;
  tags: string[];
  updated_at: string;
  snippet?: string;
}

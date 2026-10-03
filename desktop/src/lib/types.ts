export interface User {
  id: string;
  email: string;
  display_name: string;
  email_verified: boolean;
  created_at: string;
  updated_at: string;
  /** Set while the account waits out its deletion grace period (#289). */
  deletion_scheduled_at?: string;
}

export type VaultRole = "owner" | "editor" | "viewer";

export interface Vault {
  id: string;
  user_id: string;
  name: string;
  encryption: "none" | "e2ee";
  /** Opaque client-written key material for e2ee vaults (see lib/vaultKeys). */
  encryption_meta?: unknown;
  /** The caller's role for this vault: "owner" for owned, else shared (#51). */
  role?: VaultRole;
  created_at: string;
  updated_at: string;
}

export interface VaultMember {
  vault_id: string;
  user_id: string;
  email: string;
  display_name: string;
  role: "viewer" | "editor";
  accepted_at?: string;
  created_at: string;
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

/** A stored snapshot of a note (#413); the list omits `content` (#414). */
export interface NoteVersionInfo {
  id: string;
  note_id: string;
  checksum: string;
  device_id: string;
  /** When the snapshot started. */
  created_at: string;
  /** When later saves of the same device last changed it. */
  updated_at: string;
}

export interface NoteVersion extends NoteVersionInfo {
  content: string;
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

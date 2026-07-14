package model

import (
	"encoding/json"
	"time"
)

type User struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	DisplayName  string    `json:"display_name"`
	EmailVerified bool     `json:"email_verified"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// Vault encryption modes. For e2ee vaults the server stores only ciphertext
// and opaque key material (see docs/encryption.md).
const (
	VaultEncryptionNone = "none"
	VaultEncryptionE2EE = "e2ee"
)

type Vault struct {
	ID         string `json:"id"`
	UserID     string `json:"user_id"`
	Name       string `json:"name"`
	Encryption string `json:"encryption"`
	// EncryptionMeta is written by the client (KDF salt/params, wrapped vault
	// keys) and never interpreted by the server.
	EncryptionMeta json.RawMessage `json:"encryption_meta,omitempty"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
	// Role is the caller's role for this vault when listed: "owner" for vaults
	// they own, or "viewer"/"editor" for shared ones (#51). Empty otherwise.
	Role string `json:"role,omitempty"`
}

// Vault roles. Owner is implicit (vaults.user_id); members are viewer/editor.
const (
	VaultRoleOwner  = "owner"
	VaultRoleEditor = "editor"
	VaultRoleViewer = "viewer"
)

// VaultMember is a user's membership in a shared vault (#51).
type VaultMember struct {
	VaultID     string     `json:"vault_id"`
	UserID      string     `json:"user_id"`
	Email       string     `json:"email"`
	DisplayName string     `json:"display_name"`
	Role        string     `json:"role"`
	InvitedBy   string     `json:"invited_by,omitempty"`
	AcceptedAt  *time.Time `json:"accepted_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

type Note struct {
	ID        string    `json:"id"`
	VaultID   string    `json:"vault_id"`
	Path      string    `json:"path"`
	Title     string    `json:"title"`
	Content   string    `json:"content"`
	Checksum  string    `json:"checksum"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type NoteVersion struct {
	ID        string    `json:"id"`
	NoteID    string    `json:"note_id"`
	Content   string    `json:"content"`
	Checksum  string    `json:"checksum"`
	DeviceID  string    `json:"device_id"`
	CreatedAt time.Time `json:"created_at"`
}

type Device struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Name      string    `json:"name"`
	Platform  string    `json:"platform"`
	LastSeen  time.Time `json:"last_seen"`
	CreatedAt time.Time `json:"created_at"`
}

type Attachment struct {
	ID          string    `json:"id"`
	VaultID     string    `json:"vault_id"`
	NoteID      string    `json:"note_id"`
	Filename    string    `json:"filename"`
	MimeType    string    `json:"mime_type"`
	SizeBytes   int64     `json:"size_bytes"`
	StoragePath string    `json:"storage_path"`
	CreatedAt   time.Time `json:"created_at"`
}

type NoteLink struct {
	ID           string    `json:"id"`
	VaultID      string    `json:"vault_id"`
	SourceNoteID string    `json:"source_note_id"`
	TargetTitle  string    `json:"target_title"`
	Anchor       string    `json:"anchor"`
	TargetNoteID string    `json:"target_note_id,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

// BacklinkNote is a note summary returned by the backlinks endpoint.
type BacklinkNote struct {
	ID        string    `json:"id"`
	VaultID   string    `json:"vault_id"`
	Path      string    `json:"path"`
	Title     string    `json:"title"`
	UpdatedAt time.Time `json:"updated_at"`
}

// TagCount is a tag with its occurrence count across a vault.
type TagCount struct {
	Tag   string `json:"tag"`
	Count int    `json:"count"`
}

// NoteSearchResult is a lightweight note summary returned by the search endpoint.
type NoteSearchResult struct {
	ID        string    `json:"id"`
	VaultID   string    `json:"vault_id"`
	Path      string    `json:"path"`
	Title     string    `json:"title"`
	Snippet   string    `json:"snippet"`
	Tags      []string  `json:"tags"`
	UpdatedAt time.Time `json:"updated_at"`
}

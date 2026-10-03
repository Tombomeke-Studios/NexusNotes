package model

import (
	"encoding/json"
	"time"
)

type User struct {
	ID            string    `json:"id"`
	Email         string    `json:"email"`
	PasswordHash  string    `json:"-"`
	DisplayName   string    `json:"display_name"`
	EmailVerified bool      `json:"email_verified"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
	// DeletionScheduledAt is when the account will be erased, during the
	// grace period after a deletion request (#289); nil otherwise.
	DeletionScheduledAt *time.Time `json:"deletion_scheduled_at,omitempty"`
	// When and to which version of the Terms of Service and Privacy Policy
	// the user agreed at signup (#289); nil for accounts from before.
	TermsAcceptedAt *time.Time `json:"-"`
	TermsVersion    string     `json:"-"`
}

// CurrentTermsVersion names the policy text new accounts agree to; bump it
// whenever public/legal/terms.html or privacy.html changes materially.
const CurrentTermsVersion = "2026-10-03"

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

// VersionRetention is how much note history a vault keeps (#418): the newest
// KeepCount versions of each note, minus versions older than KeepDays (0 = no
// age limit). A note's newest version is always kept.
type VersionRetention struct {
	KeepCount int `json:"keep_count"`
	KeepDays  int `json:"keep_days"`
}

// Retention limits the API accepts.
const (
	MaxVersionKeepCount = 500
	MaxVersionKeepDays  = 3650
)

// Vault roles. Owner is implicit (vaults.user_id); members are viewer/editor.
const (
	VaultRoleOwner  = "owner"
	VaultRoleEditor = "editor"
	VaultRoleViewer = "viewer"
)

// LinkedFile references an external file linked into a vault without copying
// it (URL, local path, or GitHub file) — the original stays in place.
type LinkedFile struct {
	ID          string    `json:"id"`
	VaultID     string    `json:"vault_id"`
	DisplayName string    `json:"display_name"`
	SourceType  string    `json:"source_type"` // 'url' | 'local_path' | 'github_path'
	SourceRef   string    `json:"source_ref"`
	ReadOnly    bool      `json:"read_only"`
	CreatedAt   time.Time `json:"created_at"`
}

// Linked-file source types.
const (
	LinkedSourceURL    = "url"
	LinkedSourceLocal  = "local_path"
	LinkedSourceGitHub = "github_path"
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
	Content   string    `json:"content,omitempty"` // omitted in the version list (#414)
	Checksum  string    `json:"checksum"`
	DeviceID  string    `json:"device_id"`
	CreatedAt time.Time `json:"created_at"`
	// UpdatedAt is when the snapshot last changed: saves of the same device
	// within VersionSnapshotWindow update it (#413).
	UpdatedAt time.Time `json:"updated_at"`
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
	StoragePath string    `json:"-"`
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

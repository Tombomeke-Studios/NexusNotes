package service

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

// Export assembles a zip of everything the user owns (GDPR data portability):
// every vault as a folder of markdown files plus an account.json with the
// account metadata. Content comes out exactly as stored — plain markdown —
// so the archive doubles as an Obsidian-compatible backup.
func (s *AccountService) Export(ctx context.Context, userID string) ([]byte, error) {
	user, err := s.users.GetByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("get user: %w", err)
	}
	vaults, err := s.vaults.ListByUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list vaults: %w", err)
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	meta := map[string]any{
		"exported_at": time.Now().UTC().Format(time.RFC3339),
		"user": map[string]any{
			"id":           user.ID,
			"email":        user.Email,
			"display_name": user.DisplayName,
			"created_at":   user.CreatedAt,
		},
		"vaults": vaults,
	}
	if err := writeZipJSON(zw, "account.json", meta); err != nil {
		return nil, err
	}

	for _, vault := range vaults {
		notes, err := s.notes.ListByVault(ctx, vault.ID)
		if err != nil {
			return nil, fmt.Errorf("list notes for vault %s: %w", vault.ID, err)
		}
		used := make(map[string]bool)
		for _, note := range notes {
			name := noteEntryName(vault.Name, note, used)
			w, err := zw.Create(name)
			if err != nil {
				return nil, fmt.Errorf("create zip entry %s: %w", name, err)
			}
			if _, err := w.Write([]byte(note.Content)); err != nil {
				return nil, fmt.Errorf("write zip entry %s: %w", name, err)
			}
		}
	}

	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("finalize zip: %w", err)
	}
	return buf.Bytes(), nil
}

func writeZipJSON(zw *zip.Writer, name string, v any) error {
	w, err := zw.Create(name)
	if err != nil {
		return fmt.Errorf("create zip entry %s: %w", name, err)
	}
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		return fmt.Errorf("encode %s: %w", name, err)
	}
	return nil
}

// noteEntryName builds a safe, unique zip path: <vault>/<note path>/<title>.md.
// Duplicate names get a numeric suffix instead of silently overwriting.
func noteEntryName(vaultName string, note model.Note, used map[string]bool) string {
	segments := []string{sanitizeSegment(vaultName)}
	for _, seg := range strings.Split(note.Path, "/") {
		if s := sanitizeSegment(seg); s != "" {
			segments = append(segments, s)
		}
	}
	dir := strings.Join(segments, "/")

	title := sanitizeSegment(note.Title)
	if title == "" {
		title = note.ID
	}

	name := fmt.Sprintf("%s/%s.md", dir, title)
	for n := 1; used[name]; n++ {
		name = fmt.Sprintf("%s/%s (%d).md", dir, title, n)
	}
	used[name] = true
	return name
}

// sanitizeSegment strips characters that are invalid in Windows file names and
// neutralises traversal segments like "..".
func sanitizeSegment(s string) string {
	s = strings.Map(func(r rune) rune {
		switch r {
		case '<', '>', ':', '"', '|', '?', '*', '\\', '/':
			return '-'
		}
		if r < 0x20 {
			return -1
		}
		return r
	}, s)
	s = strings.Trim(s, " .")
	return s
}

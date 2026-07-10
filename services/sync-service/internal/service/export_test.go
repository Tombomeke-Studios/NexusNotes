package service

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"strings"
	"testing"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

func exportFixture(t *testing.T) (*AccountService, *fakeAccountNoteStore) {
	t.Helper()
	users := &fakeAccountUserStore{user: &model.User{ID: "u1", Email: "a@example.com", DisplayName: "A"}}
	vaults := &fakeAccountVaultStore{vaults: []model.Vault{{ID: "v1", Name: "My Vault"}}}
	notes := &fakeAccountNoteStore{notesByVault: map[string][]model.Note{}}
	return NewAccountService(users, vaults, notes, &fakeSearchCleaner{}, &fakeSessionCloser{}), notes
}

func readZip(t *testing.T, data []byte) map[string]string {
	t.Helper()
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}
	files := make(map[string]string)
	for _, f := range r.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open %s: %v", f.Name, err)
		}
		content, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			t.Fatalf("read %s: %v", f.Name, err)
		}
		files[f.Name] = string(content)
	}
	return files
}

func TestExport_ContainsAccountMetadata(t *testing.T) {
	s, _ := exportFixture(t)

	data, err := s.Export(context.Background(), "u1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	files := readZip(t, data)

	meta, ok := files["account.json"]
	if !ok {
		t.Fatalf("zip is missing account.json; got files %v", keys(files))
	}
	var parsed struct {
		User struct {
			Email string `json:"email"`
		} `json:"user"`
	}
	if err := json.Unmarshal([]byte(meta), &parsed); err != nil {
		t.Fatalf("parse account.json: %v", err)
	}
	if parsed.User.Email != "a@example.com" {
		t.Fatalf("account.json email = %q, want a@example.com", parsed.User.Email)
	}
}

func TestExport_WritesNotesAsMarkdownInVaultFolders(t *testing.T) {
	s, notes := exportFixture(t)
	notes.notesByVault["v1"] = []model.Note{
		{ID: "n1", Title: "Welcome", Path: "", Content: "# Hello"},
		{ID: "n2", Title: "Ideas", Path: "Projects", Content: "- idea"},
	}

	data, err := s.Export(context.Background(), "u1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	files := readZip(t, data)

	if files["My Vault/Welcome.md"] != "# Hello" {
		t.Fatalf("root note missing or wrong; got files %v", keys(files))
	}
	if files["My Vault/Projects/Ideas.md"] != "- idea" {
		t.Fatalf("foldered note missing or wrong; got files %v", keys(files))
	}
}

func TestExport_DeduplicatesFileNames(t *testing.T) {
	s, notes := exportFixture(t)
	notes.notesByVault["v1"] = []model.Note{
		{ID: "n1", Title: "Note", Path: "", Content: "first"},
		{ID: "n2", Title: "Note", Path: "", Content: "second"},
	}

	data, err := s.Export(context.Background(), "u1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	files := readZip(t, data)

	mdCount := 0
	for name := range files {
		if strings.HasSuffix(name, ".md") {
			mdCount++
		}
	}
	if mdCount != 2 {
		t.Fatalf("got %d markdown files, want 2 (duplicate titles must not overwrite); files %v", mdCount, keys(files))
	}
}

func TestExport_SanitizesUnsafeNames(t *testing.T) {
	s, notes := exportFixture(t)
	notes.notesByVault["v1"] = []model.Note{
		{ID: "n1", Title: `a<b>:"c|d?*`, Path: "../escape", Content: "x"},
	}

	data, err := s.Export(context.Background(), "u1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for name := range readZip(t, data) {
		if strings.Contains(name, "..") {
			t.Fatalf("zip entry %q contains a path traversal segment", name)
		}
		if strings.ContainsAny(name, `<>:"|?*\`) {
			t.Fatalf("zip entry %q contains characters invalid on Windows", name)
		}
	}
}

func keys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

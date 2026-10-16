package handler

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt/fieldcrypttest"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/search"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/service"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/ws"
)

// request invokes fn as userID with a URL (for query strings), path values
// and an optional JSON body, bypassing the JWT middleware.
func request(fn http.HandlerFunc, method, target, userID string, pathValues map[string]string, body string) *httptest.ResponseRecorder {
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, target, rd)
	for k, v := range pathValues {
		req.SetPathValue(k, v)
	}
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, userID))
	rec := httptest.NewRecorder()
	fn(rec, req)
	return rec
}

// trashFixture adds an editor of the owner's vault to the note access fixture.
type trashFixture struct {
	*noteAccessFixture
	editor string
}

func newTrashFixture(t *testing.T) *trashFixture {
	t.Helper()
	f := &trashFixture{noteAccessFixture: newNoteAccessFixture(t)}
	f.editor = seedUser(t, f.pool)
	if err := repository.NewVaultMemberRepo(f.pool, fieldcrypttest.Cipher(t)).Add(context.Background(), f.ownerVault, f.editor, model.VaultRoleEditor, f.owner); err != nil {
		t.Fatal(err)
	}
	return f
}

func (f *trashFixture) create(t *testing.T, title, path, content string) *model.Note {
	t.Helper()
	n, err := f.svc.CreateNote(context.Background(), f.ownerVault, title, path, content, "dev", "")
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func (f *trashFixture) trash(t *testing.T, user, noteID string) *httptest.ResponseRecorder {
	t.Helper()
	return call(f.h.Trash, http.MethodPost, user, map[string]string{"noteId": noteID})
}

func noteIDs(t *testing.T, body []byte) []string {
	t.Helper()
	var items []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &items); err != nil {
		t.Fatalf("decode %s: %v", body, err)
	}
	ids := make([]string, len(items))
	for i, it := range items {
		ids[i] = it.ID
	}
	return ids
}

func contains(ids []string, id string) bool {
	for _, x := range ids {
		if x == id {
			return true
		}
	}
	return false
}

// linkTarget reads where the link from source to title resolves ("" when it
// resolves to nothing).
func linkTarget(t *testing.T, f *trashFixture, sourceID, title string) string {
	t.Helper()
	var target *string
	if err := f.pool.QueryRow(context.Background(),
		`SELECT target_note_id FROM note_links WHERE source_note_id = $1 AND target_title = $2`, sourceID, title,
	).Scan(&target); err != nil {
		t.Fatalf("read link: %v", err)
	}
	if target == nil {
		return ""
	}
	return *target
}

// Every live read leaves trashed notes out (#569): one subtest per read path.
func TestTrash_LiveReadsExcludeTrashedNotes(t *testing.T) {
	f := newTrashFixture(t)
	ctx := context.Background()
	target := f.create(t, "Target", "Projects", "apples #project, see [[Linker]]")
	linker := f.create(t, "Linker", "", "apples, see [[Target]]")
	// Save Target again so its link to Linker (created after it) resolves too.
	target, _, err := f.svc.UpdateNote(ctx, service.NoteUpdate{
		NoteID: target.ID, Title: target.Title, Path: target.Path, Content: target.Content,
		PrevChecksum: target.Checksum, DeviceID: "dev",
	})
	if err != nil {
		t.Fatal(err)
	}
	if linkTarget(t, f, linker.ID, "Target") != target.ID || linkTarget(t, f, target.ID, "Linker") != linker.ID {
		t.Fatal("links did not resolve before trashing")
	}
	versions, err := f.svc.GetVersions(ctx, target.ID)
	if err != nil || len(versions) == 0 {
		t.Fatalf("versions: %v", err)
	}
	stars := repository.NewStarRepo(f.pool)
	if err := stars.Star(ctx, f.owner, target.ID); err != nil {
		t.Fatal(err)
	}
	attachRepo := repository.NewAttachmentRepo(f.pool)
	att := &model.Attachment{NoteID: target.ID, VaultID: f.ownerVault, Filename: "a.png", MimeType: "image/png", SizeBytes: 3, StoragePath: f.ownerVault + "/a.png"}
	if err := attachRepo.Create(ctx, att); err != nil {
		t.Fatal(err)
	}

	if rec := f.trash(t, f.owner, target.ID); rec.Code != http.StatusOK {
		t.Fatalf("trash: %d %s", rec.Code, rec.Body.String())
	}

	vaultPath := map[string]string{"vaultId": f.ownerVault}
	notePath := map[string]string{"noteId": target.ID}

	t.Run("note list", func(t *testing.T) {
		rec := call(f.h.List, http.MethodGet, f.owner, vaultPath)
		if ids := noteIDs(t, rec.Body.Bytes()); contains(ids, target.ID) || !contains(ids, linker.ID) {
			t.Fatalf("list = %v", ids)
		}
	})
	t.Run("paged note list", func(t *testing.T) {
		rec := request(f.h.List, http.MethodGet, "/?limit=100", f.owner, vaultPath, "")
		if ids := noteIDs(t, rec.Body.Bytes()); contains(ids, target.ID) || !contains(ids, linker.ID) {
			t.Fatalf("page = %v", ids)
		}
	})
	t.Run("get by id", func(t *testing.T) {
		if rec := call(f.h.Get, http.MethodGet, f.owner, notePath); rec.Code != http.StatusNotFound {
			t.Fatalf("get: %d, want 404", rec.Code)
		}
	})
	t.Run("update", func(t *testing.T) {
		body := `{"title":"Target","path":"","content":"x","prev_checksum":"` + target.Checksum + `"}`
		if rec := request(f.h.Update, http.MethodPut, "/", f.owner, notePath, body); rec.Code != http.StatusNotFound {
			t.Fatalf("update: %d, want 404", rec.Code)
		}
	})
	t.Run("vault search (Postgres)", func(t *testing.T) {
		rec := request(f.h.Search, http.MethodGet, "/?q=apples", f.owner, vaultPath, "")
		if ids := noteIDs(t, rec.Body.Bytes()); contains(ids, target.ID) || !contains(ids, linker.ID) {
			t.Fatalf("search = %v", ids)
		}
	})
	t.Run("global search fallback", func(t *testing.T) {
		dead := search.NewIndexer("http://127.0.0.1:1", "")
		sh := NewSearchHandler(dead, repository.NewVaultRepo(f.pool, fieldcrypttest.Cipher(t)), repository.NewNoteRepo(f.pool, fieldcrypttest.Cipher(t)))
		rec := request(sh.Search, http.MethodGet, "/api/search?vault="+f.ownerVault+"&q=apples", f.owner, nil, "")
		if ids := noteIDs(t, rec.Body.Bytes()); contains(ids, target.ID) || !contains(ids, linker.ID) {
			t.Fatalf("fallback = %v", ids)
		}
	})
	t.Run("global search index", func(t *testing.T) {
		// An index that still holds the trashed note (its removal is queued).
		meili := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_ = json.NewEncoder(w).Encode(map[string]any{"hits": []map[string]any{
				{"id": target.ID, "vault_id": f.ownerVault, "title": "Target"},
				{"id": linker.ID, "vault_id": f.ownerVault, "title": "Linker"},
			}})
		}))
		defer meili.Close()
		sh := NewSearchHandler(search.NewIndexer(meili.URL, ""), repository.NewVaultRepo(f.pool, fieldcrypttest.Cipher(t)), repository.NewNoteRepo(f.pool, fieldcrypttest.Cipher(t)))
		rec := request(sh.Search, http.MethodGet, "/api/search?vault="+f.ownerVault+"&q=apples", f.owner, nil, "")
		if ids := noteIDs(t, rec.Body.Bytes()); contains(ids, target.ID) || !contains(ids, linker.ID) {
			t.Fatalf("index hits = %v", ids)
		}
	})
	t.Run("tags", func(t *testing.T) {
		th := NewTagHandler(f.svc, repository.NewVaultRepo(f.pool, fieldcrypttest.Cipher(t)))
		rec := call(th.ListVaultTags, http.MethodGet, f.owner, vaultPath)
		if strings.Contains(rec.Body.String(), "project") {
			t.Fatalf("tags = %s", rec.Body.String())
		}
	})
	t.Run("backlinks of the trashed note", func(t *testing.T) {
		if rec := call(f.h.Backlinks, http.MethodGet, f.owner, notePath); rec.Code != http.StatusNotFound {
			t.Fatalf("backlinks: %d, want 404", rec.Code)
		}
	})
	t.Run("backlinks from the trashed note", func(t *testing.T) {
		rec := call(f.h.Backlinks, http.MethodGet, f.owner, map[string]string{"noteId": linker.ID})
		if ids := noteIDs(t, rec.Body.Bytes()); contains(ids, target.ID) {
			t.Fatalf("backlinks of Linker = %v", ids)
		}
	})
	t.Run("graph links resolve as missing", func(t *testing.T) {
		if got := linkTarget(t, f, linker.ID, "Target"); got != "" {
			t.Fatalf("link to the trashed note resolves to %q", got)
		}
	})
	t.Run("version list", func(t *testing.T) {
		if rec := call(f.h.Versions, http.MethodGet, f.owner, notePath); rec.Code != http.StatusNotFound {
			t.Fatalf("versions: %d, want 404", rec.Code)
		}
	})
	t.Run("one version", func(t *testing.T) {
		rec := call(f.h.Version, http.MethodGet, f.owner, map[string]string{"noteId": target.ID, "versionId": versions[0].ID})
		if rec.Code != http.StatusNotFound {
			t.Fatalf("version: %d, want 404", rec.Code)
		}
	})
	t.Run("restore a version", func(t *testing.T) {
		rec := request(f.h.RestoreVersion, http.MethodPost, "/", f.owner, map[string]string{"noteId": target.ID, "versionId": versions[0].ID}, `{}`)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("restore version: %d, want 404", rec.Code)
		}
	})
	t.Run("attachment list", func(t *testing.T) {
		ah := NewAttachmentHandler(nil, attachRepo, repository.NewVaultRepo(f.pool, fieldcrypttest.Cipher(t)), f.svc)
		if rec := call(ah.List, http.MethodGet, f.owner, notePath); rec.Code != http.StatusNotFound {
			t.Fatalf("attachments: %d, want 404", rec.Code)
		}
	})
	t.Run("attachment by id", func(t *testing.T) {
		if _, err := attachRepo.GetByID(ctx, att.ID); err != repository.ErrAttachmentNotFound {
			t.Fatalf("attachment lookup: %v, want not found", err)
		}
	})
	t.Run("starred notes", func(t *testing.T) {
		sh := NewStarHandler(stars, repository.NewVaultRepo(f.pool, fieldcrypttest.Cipher(t)), f.svc)
		if rec := call(sh.List, http.MethodGet, f.owner, nil); strings.Contains(rec.Body.String(), target.ID) {
			t.Fatalf("starred = %s", rec.Body.String())
		}
	})
	t.Run("storage stats count the trash", func(t *testing.T) {
		rec := call(f.h.StorageStats, http.MethodGet, f.owner, map[string]string{"id": f.ownerVault})
		var stats model.VaultStorageStats
		if err := json.Unmarshal(rec.Body.Bytes(), &stats); err != nil {
			t.Fatal(err)
		}
		if stats.Notes != 3 || stats.TrashedNotes != 1 || stats.Attachments != 1 {
			t.Fatalf("stats = %+v", stats)
		}
	})
	t.Run("trash list", func(t *testing.T) {
		rec := call(f.h.ListTrash, http.MethodGet, f.viewer, map[string]string{"id": f.ownerVault})
		var trash []model.TrashedNote
		if err := json.Unmarshal(rec.Body.Bytes(), &trash); err != nil || len(trash) != 1 {
			t.Fatalf("trash: %d %s", rec.Code, rec.Body.String())
		}
		got := trash[0]
		if got.ID != target.ID || got.Path != "Projects" || got.DeletedAt.IsZero() || !got.PurgeAt.Equal(got.DeletedAt.Add(service.DefaultTrashRetention)) {
			t.Fatalf("trashed note = %+v", got)
		}
		if strings.Contains(rec.Body.String(), "apples") {
			t.Fatal("the trash list carries content")
		}
	})

	// Restoring brings every one of them back.
	rec := call(f.h.Restore, http.MethodPost, f.owner, notePath)
	var restored model.Note
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &restored) != nil || restored.Path != "Projects" || restored.Content != target.Content {
		t.Fatalf("restore: %d %s", rec.Code, rec.Body.String())
	}
	if rec := call(f.h.Get, http.MethodGet, f.owner, notePath); rec.Code != http.StatusOK {
		t.Fatalf("get after restore: %d", rec.Code)
	}
	if linkTarget(t, f, linker.ID, "Target") != target.ID {
		t.Fatal("restore did not bring the link back")
	}
	if rec := call(f.h.Backlinks, http.MethodGet, f.owner, notePath); !contains(noteIDs(t, rec.Body.Bytes()), linker.ID) {
		t.Fatalf("backlinks after restore: %s", rec.Body.String())
	}
	if ids, _ := stars.List(ctx, f.owner); !contains(ids, target.ID) {
		t.Fatal("the star did not come back")
	}
	if tags, _ := f.svc.GetVaultTags(ctx, f.ownerVault); len(tags) == 0 {
		t.Fatal("the tag did not come back")
	}
	if _, err := attachRepo.GetByID(ctx, att.ID); err != nil {
		t.Fatalf("attachment after restore: %v", err)
	}
}

// Editors and owners trash and restore; only the owner purges or empties;
// viewers and outsiders do none of it (#569).
func TestTrash_AccessPerRole(t *testing.T) {
	f := newTrashFixture(t)
	vault := map[string]string{"id": f.ownerVault}
	n := f.create(t, "Doomed", "", "x")
	note := map[string]string{"noteId": n.ID}

	for _, user := range []string{f.viewer, f.outsider} {
		if rec := f.trash(t, user, n.ID); rec.Code != http.StatusForbidden {
			t.Fatalf("trash by %s: %d, want 403", user, rec.Code)
		}
		if rec := request(f.h.TrashBatch, http.MethodPost, "/", user, vault, `{"note_ids":["`+n.ID+`"]}`); rec.Code != http.StatusForbidden {
			t.Fatalf("batch trash: %d, want 403", rec.Code)
		}
	}
	if rec := call(f.h.ListTrash, http.MethodGet, f.outsider, vault); rec.Code != http.StatusForbidden {
		t.Fatalf("outsider lists the trash: %d, want 403", rec.Code)
	}

	if rec := f.trash(t, f.editor, n.ID); rec.Code != http.StatusOK {
		t.Fatalf("editor trashes: %d %s", rec.Code, rec.Body.String())
	}
	for _, user := range []string{f.viewer, f.outsider} {
		if rec := call(f.h.Restore, http.MethodPost, user, note); rec.Code != http.StatusForbidden {
			t.Fatalf("restore by %s: %d, want 403", user, rec.Code)
		}
	}
	for _, user := range []string{f.editor, f.viewer, f.outsider} {
		if rec := call(f.h.Purge, http.MethodDelete, user, note); rec.Code != http.StatusForbidden {
			t.Fatalf("purge by %s: %d, want 403", user, rec.Code)
		}
		if rec := call(f.h.EmptyTrash, http.MethodPost, user, vault); rec.Code != http.StatusForbidden {
			t.Fatalf("empty by %s: %d, want 403", user, rec.Code)
		}
	}
	if rec := call(f.h.Restore, http.MethodPost, f.editor, note); rec.Code != http.StatusOK {
		t.Fatalf("editor restores: %d %s", rec.Code, rec.Body.String())
	}
	if rec := call(f.h.Restore, http.MethodPost, f.editor, note); rec.Code != http.StatusNotFound {
		t.Fatalf("restore a live note: %d, want 404", rec.Code)
	}

	if rec := f.trash(t, f.owner, n.ID); rec.Code != http.StatusOK {
		t.Fatalf("owner trashes: %d", rec.Code)
	}
	if rec := f.trash(t, f.owner, n.ID); rec.Code != http.StatusNotFound {
		t.Fatalf("trash twice: %d, want 404", rec.Code)
	}
	if rec := call(f.h.Purge, http.MethodDelete, f.owner, note); rec.Code != http.StatusNoContent {
		t.Fatalf("owner purges: %d %s", rec.Code, rec.Body.String())
	}
	if rec := call(f.h.Purge, http.MethodDelete, f.owner, note); rec.Code != http.StatusNotFound {
		t.Fatalf("purge twice: %d, want 404", rec.Code)
	}
	if rec := call(f.h.Purge, http.MethodDelete, f.owner, map[string]string{"noteId": f.note.ID}); rec.Code != http.StatusNotFound {
		t.Fatalf("purge a live note: %d, want 404", rec.Code)
	}
}

// A folder goes to the trash as one batch, and each note comes back at its
// own path (#569). Emptying the trash purges them all.
func TestTrash_BatchAndEmpty(t *testing.T) {
	f := newTrashFixture(t)
	a := f.create(t, "A", "Folder", "a")
	b := f.create(t, "B", "Folder/Sub", "b")
	body := `{"note_ids":["` + a.ID + `","` + b.ID + `","` + uuid.NewString() + `"]}`
	rec := request(f.h.TrashBatch, http.MethodPost, "/", f.editor, map[string]string{"id": f.ownerVault}, body)
	if ids := noteIDs(t, rec.Body.Bytes()); rec.Code != http.StatusOK || len(ids) != 2 {
		t.Fatalf("batch: %d %s", rec.Code, rec.Body.String())
	}
	for _, bad := range []string{`{"note_ids":[]}`, `{}`} {
		if rec := request(f.h.TrashBatch, http.MethodPost, "/", f.editor, map[string]string{"id": f.ownerVault}, bad); rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: %d, want 400", bad, rec.Code)
		}
	}
	for _, n := range []*model.Note{a, b} {
		rec := call(f.h.Restore, http.MethodPost, f.editor, map[string]string{"noteId": n.ID})
		var got model.Note
		if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &got) != nil || got.Path != n.Path {
			t.Fatalf("restore %s: %d %s", n.Title, rec.Code, rec.Body.String())
		}
	}

	request(f.h.TrashBatch, http.MethodPost, "/", f.editor, map[string]string{"id": f.ownerVault}, `{"note_ids":["`+a.ID+`","`+b.ID+`"]}`)
	rec = call(f.h.EmptyTrash, http.MethodPost, f.owner, map[string]string{"id": f.ownerVault})
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"purged":2`) {
		t.Fatalf("empty: %d %s", rec.Code, rec.Body.String())
	}
	if trash, _ := f.svc.ListTrash(context.Background(), f.ownerVault); len(trash) != 0 {
		t.Fatalf("trash after emptying: %+v", trash)
	}
}

// fakeFiles records the attachment files a handler asks to remove.
type fakeFiles struct{ removed []string }

func (f *fakeFiles) NoteFiles(context.Context, string) []string { return nil }
func (f *fakeFiles) RemoveFiles(_ context.Context, keys []string) {
	f.removed = append(f.removed, keys...)
}

// Purging deletes the versions and attachment rows in the database, and the
// files after that (#569).
func TestTrash_PurgeRemovesVersionsAndFiles(t *testing.T) {
	f := newTrashFixture(t)
	ctx := context.Background()
	files := &fakeFiles{}
	f.h.SetFileCleanup(files)
	n := f.create(t, "WithFile", "", "x")
	att := &model.Attachment{NoteID: n.ID, VaultID: f.ownerVault, Filename: "a.pdf", MimeType: "application/pdf", SizeBytes: 1, StoragePath: f.ownerVault + "/x.pdf"}
	if err := repository.NewAttachmentRepo(f.pool).Create(ctx, att); err != nil {
		t.Fatal(err)
	}
	f.trash(t, f.owner, n.ID)
	if len(files.removed) != 0 {
		t.Fatal("trashing removed files")
	}
	if rec := call(f.h.Purge, http.MethodDelete, f.owner, map[string]string{"noteId": n.ID}); rec.Code != http.StatusNoContent {
		t.Fatalf("purge: %d", rec.Code)
	}
	if len(files.removed) != 1 || files.removed[0] != att.StoragePath {
		t.Fatalf("removed files %v", files.removed)
	}
	var rows int
	_ = f.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM note_versions WHERE note_id = $1) + (SELECT count(*) FROM attachments WHERE note_id = $1) + (SELECT count(*) FROM notes WHERE id = $1)`, n.ID).Scan(&rows)
	if rows != 0 {
		t.Fatalf("%d rows left after the purge", rows)
	}
}

// listen registers a WebSocket client for user and returns a function that
// reads the message types delivered so far.
func listen(hub *ws.Hub, user string) func() []ws.Message {
	c := ws.NewClient(hub, nil, user, "device")
	hub.Register(c)
	return func() []ws.Message {
		var out []ws.Message
		for {
			select {
			case raw := <-c.Send:
				var m ws.Message
				_ = json.Unmarshal(raw, &m)
				out = append(out, m)
			case <-time.After(50 * time.Millisecond):
				return out
			}
		}
	}
}

func types(msgs []ws.Message) string {
	var s []string
	for _, m := range msgs {
		s = append(s, m.Type)
	}
	return strings.Join(s, ",")
}

// Trash sends note:trashed and, for apps from before the trash, note:deleted;
// restore sends note:restored with the note; purge sends note:deleted (#569).
func TestTrash_WebSocketEvents(t *testing.T) {
	f := newTrashFixture(t)
	n := f.create(t, "Evented", "", "x")
	owner, member := listen(f.h.hub, f.owner), listen(f.h.hub, f.viewer)

	f.trash(t, f.editor, n.ID)
	got := owner()
	if types(got) != "note:trashed,note:deleted" || types(member()) != "note:trashed,note:deleted" {
		t.Fatalf("trash events: %s", types(got))
	}
	var trashed trashedEvent
	if json.Unmarshal(got[0].Payload, &trashed) != nil || trashed.NoteID != n.ID || trashed.VaultID != f.ownerVault || trashed.DeletedAt.IsZero() {
		t.Fatalf("note:trashed payload %s", got[0].Payload)
	}
	if !strings.Contains(string(got[1].Payload), `"note_id":"`+n.ID+`"`) {
		t.Fatalf("note:deleted payload %s", got[1].Payload)
	}

	call(f.h.Restore, http.MethodPost, f.editor, map[string]string{"noteId": n.ID})
	got = owner()
	var restored model.Note
	if types(got) != "note:restored" || json.Unmarshal(got[0].Payload, &restored) != nil || restored.ID != n.ID || restored.Content != "x" {
		t.Fatalf("restore events: %s", types(got))
	}

	f.trash(t, f.owner, n.ID)
	owner()
	call(f.h.Purge, http.MethodDelete, f.owner, map[string]string{"noteId": n.ID})
	if got := owner(); types(got) != "note:deleted" {
		t.Fatalf("purge events: %s", types(got))
	}
}

// The old DELETE stays a hard delete for today's apps (#569).
func TestTrash_DeleteStaysAHardDelete(t *testing.T) {
	f := newTrashFixture(t)
	n := f.create(t, "Gone", "", "x")
	listenOwner := listen(f.h.hub, f.owner)
	rec := call(f.h.Delete, http.MethodDelete, f.owner, map[string]string{"vaultId": f.ownerVault, "noteId": n.ID})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d", rec.Code)
	}
	if got := listenOwner(); types(got) != "note:deleted" {
		t.Fatalf("delete events: %s", types(got))
	}
	var rows int
	_ = f.pool.QueryRow(context.Background(), `SELECT count(*) FROM notes WHERE id = $1`, n.ID).Scan(&rows)
	if rows != 0 {
		t.Fatal("the old DELETE kept the note")
	}
}

// An AI client's delete moves the note to the trash; it cannot trash in an
// e2ee vault, as it cannot write there (#569).
func TestTrash_MCPDeleteTrashes(t *testing.T) {
	f := newTrashFixture(t)
	ctx := context.Background()
	tokens := service.NewMCPTokenService(repository.NewMCPTokenRepo(f.pool, fieldcrypttest.Cipher(t)))
	_, raw, err := tokens.Create(ctx, f.owner, "AI", model.MCPScopeReadWrite)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	e2ee := &model.Vault{ID: uuid.NewString(), UserID: f.owner, Name: "Locked", Encryption: model.VaultEncryptionE2EE, CreatedAt: now, UpdatedAt: now}
	if err := repository.NewVaultRepo(f.pool, fieldcrypttest.Cipher(t)).Create(ctx, e2ee); err != nil {
		t.Fatal(err)
	}
	locked, err := f.svc.CreateNote(ctx, e2ee.ID, "sealed-title", "sealed-path", "ciphertext", "dev", "sum")
	if err != nil {
		t.Fatal(err)
	}

	write := http.NewServeMux()
	write.HandleFunc("DELETE /api/vaults/{vaultId}/notes/{noteId}", f.h.Delete)
	write.HandleFunc("POST /api/notes/{noteId}/trash", f.h.Trash)
	api := middleware.Auth(service.NewAuthService(nil, strings.Repeat("s", 32)), middleware.MCPAccess{Auth: tokens, Read: http.NewServeMux(), Write: write})(http.NotFoundHandler())
	do := func(method, path string) int {
		r := httptest.NewRequest(method, path, nil)
		r.Header.Set("Authorization", "Bearer "+raw)
		w := httptest.NewRecorder()
		api.ServeHTTP(w, r)
		return w.Code
	}

	n := f.create(t, "AI deletes me", "", "x")
	if code := do(http.MethodDelete, "/api/vaults/"+f.ownerVault+"/notes/"+n.ID); code != http.StatusNoContent {
		t.Fatalf("mcp delete: %d", code)
	}
	if trash, _ := f.svc.ListTrash(ctx, f.ownerVault); len(trash) != 1 || trash[0].ID != n.ID {
		t.Fatalf("mcp delete did not trash: %+v", trash)
	}
	m := f.create(t, "AI trashes me", "", "x")
	if code := do(http.MethodPost, "/api/notes/"+m.ID+"/trash"); code != http.StatusOK {
		t.Fatalf("mcp trash: %d", code)
	}
	if code := do(http.MethodPost, "/api/notes/"+locked.ID+"/trash"); code != http.StatusForbidden {
		t.Fatalf("mcp trash in an e2ee vault: %d, want 403", code)
	}
	if code := do(http.MethodDelete, "/api/vaults/"+e2ee.ID+"/notes/"+locked.ID); code != http.StatusForbidden {
		t.Fatalf("mcp delete in an e2ee vault: %d, want 403", code)
	}
}

// In an e2ee vault the trash works on ciphertext: titles stay sealed in the
// list, and restore returns exactly what was stored (#569).
func TestTrash_E2EEVaultStaysCiphertext(t *testing.T) {
	f := newTrashFixture(t)
	ctx := context.Background()
	now := time.Now().UTC()
	vault := &model.Vault{ID: uuid.NewString(), UserID: f.owner, Name: "Locked", Encryption: model.VaultEncryptionE2EE, CreatedAt: now, UpdatedAt: now}
	if err := repository.NewVaultRepo(f.pool, fieldcrypttest.Cipher(t)).Create(ctx, vault); err != nil {
		t.Fatal(err)
	}
	n, err := f.svc.CreateNote(ctx, vault.ID, "e2ee.sealed-title", "e2ee.sealed-path", "e2ee.ciphertext", "dev", "client-sum")
	if err != nil {
		t.Fatal(err)
	}
	if rec := f.trash(t, f.owner, n.ID); rec.Code != http.StatusOK {
		t.Fatalf("trash: %d", rec.Code)
	}
	rec := call(f.h.ListTrash, http.MethodGet, f.owner, map[string]string{"id": vault.ID})
	var trash []model.TrashedNote
	if json.Unmarshal(rec.Body.Bytes(), &trash) != nil || len(trash) != 1 || trash[0].Title != "e2ee.sealed-title" || trash[0].Path != "e2ee.sealed-path" {
		t.Fatalf("trash list: %s", rec.Body.String())
	}
	rec = call(f.h.Restore, http.MethodPost, f.owner, map[string]string{"noteId": n.ID})
	var restored model.Note
	if json.Unmarshal(rec.Body.Bytes(), &restored) != nil || restored.Content != "e2ee.ciphertext" || restored.Checksum != "client-sum" {
		t.Fatalf("restore: %s", rec.Body.String())
	}
}

// Converting a vault to e2ee is refused while its trash holds notes: they are
// plaintext the client cannot see to encrypt, and are never purged without the
// user asking (#569).
func TestTrash_ConvertToE2EERefusedWhileTheTrashHoldsNotes(t *testing.T) {
	f := newTrashFixture(t)
	ctx := context.Background()
	vaultID := seedVaultFor(t, f.pool, f.owner)
	live, err := f.svc.CreateNote(ctx, vaultID, "Live", "", "plain", "dev", "")
	if err != nil {
		t.Fatal(err)
	}
	binned, err := f.svc.CreateNote(ctx, vaultID, "Binned", "", "plain secret", "dev", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.TrashNotes(ctx, vaultID, []string{binned.ID}); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]any{
		"encryption_meta": map[string]int{"v": 1},
		"notes":           []service.ConvertNote{{ID: live.ID, Title: "sealed", Content: "cipher", Checksum: "c", BaseChecksum: live.Checksum}},
	})
	convert := func() *httptest.ResponseRecorder {
		return request(f.h.ConvertVault, http.MethodPost, "/", f.owner, map[string]string{"id": vaultID}, string(body))
	}

	rec := convert()
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "Restore or empty the Trash first") {
		t.Fatalf("convert with a full trash: %d %s, want 409", rec.Code, rec.Body.String())
	}
	var rows int
	_ = f.pool.QueryRow(ctx, `SELECT count(*) FROM notes WHERE id = $1`, binned.ID).Scan(&rows)
	if rows != 1 {
		t.Fatal("the refused conversion purged the trash")
	}
	if v, _ := repository.NewVaultRepo(f.pool, fieldcrypttest.Cipher(t)).GetByID(ctx, vaultID); v.Encryption == model.VaultEncryptionE2EE {
		t.Fatal("the refused conversion still encrypted the vault")
	}

	if rec := call(f.h.EmptyTrash, http.MethodPost, f.owner, map[string]string{"id": vaultID}); rec.Code != http.StatusOK {
		t.Fatalf("empty: %d", rec.Code)
	}
	if rec := convert(); rec.Code != http.StatusOK {
		t.Fatalf("convert with an empty trash: %d %s", rec.Code, rec.Body.String())
	}
}

// The account export includes the trash; an e2ee vault's trashed notes come
// out as the client ciphertext they were stored as (#569).
func TestTrash_ExportKeepsTrashedE2EENotesCiphertext(t *testing.T) {
	f := newTrashFixture(t)
	ctx := context.Background()
	now := time.Now().UTC()
	vault := &model.Vault{ID: uuid.NewString(), UserID: f.owner, Name: "Locked", Encryption: model.VaultEncryptionE2EE, CreatedAt: now, UpdatedAt: now}
	vaults := repository.NewVaultRepo(f.pool, fieldcrypttest.Cipher(t))
	if err := vaults.Create(ctx, vault); err != nil {
		t.Fatal(err)
	}
	n, err := f.svc.CreateNote(ctx, vault.ID, "e2ee.sealed-title", "", "e2ee.ciphertext-body", "dev", "client-sum")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.TrashNotes(ctx, vault.ID, []string{n.ID}); err != nil {
		t.Fatal(err)
	}
	accounts := service.NewAccountService(repository.NewUserRepo(f.pool, fieldcrypttest.Cipher(t)), vaults,
		repository.NewNoteRepo(f.pool, fieldcrypttest.Cipher(t)), search.NewIndexer("http://127.0.0.1:1", ""), ws.NewHub())
	data, err := accounts.Export(ctx, f.owner)
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, file := range zr.File {
		if !strings.Contains(file.Name, "/.trash/") {
			continue
		}
		rc, _ := file.Open()
		content, _ := io.ReadAll(rc)
		_ = rc.Close()
		if file.Name != "Locked/.trash/e2ee.sealed-title.md" || string(content) != "e2ee.ciphertext-body" {
			t.Fatalf("trashed entry %s = %q", file.Name, content)
		}
		found = true
	}
	if !found {
		t.Fatal("the export left the trash out")
	}
}

package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/service"
)

// putNote calls the Update handler as userID with a JSON body.
func putNote(h *NoteHandler, userID, noteID string, body map[string]string) *httptest.ResponseRecorder {
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPut, "/", strings.NewReader(string(raw)))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("noteId", noteID)
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, userID))
	rec := httptest.NewRecorder()
	h.Update(rec, req)
	return rec
}

// The desktop app shows the other device's version from the 409 body (#225),
// so the conflict response is a contract: the server's content and checksum,
// and nothing written.
func TestUpdate_ConflictResponse(t *testing.T) {
	f := newNoteAccessFixture(t)
	ctx := context.Background()

	current, err := f.svc.GetNote(ctx, f.note.ID)
	if err != nil {
		t.Fatalf("get note: %v", err)
	}
	stale := f.note.Checksum // the fixture saved "second draft" on top of it
	if stale == current.Checksum {
		t.Fatal("fixture should leave the first checksum stale")
	}

	t.Run("a stale previous checksum gets the server's version and writes nothing", func(t *testing.T) {
		rec := putNote(f.h, f.owner, f.note.ID, map[string]string{
			"title": "Secret", "path": "secret.md", "content": "my edit", "prev_checksum": stale,
		})
		if rec.Code != http.StatusConflict {
			t.Fatalf("status = %d, want 409 (%s)", rec.Code, rec.Body.String())
		}
		var conflict service.ConflictInfo
		if err := json.Unmarshal(rec.Body.Bytes(), &conflict); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if conflict.NoteID != f.note.ID || conflict.ServerContent != "second draft" || conflict.ServerChecksum != current.Checksum {
			t.Fatalf("conflict = %+v, want the server's second draft at %s", conflict, current.Checksum)
		}
		if conflict.ClientContent != "my edit" {
			t.Fatalf("client content = %q, want the rejected edit", conflict.ClientContent)
		}
		after, err := f.svc.GetNote(ctx, f.note.ID)
		if err != nil {
			t.Fatalf("get note: %v", err)
		}
		if after.Content != "second draft" || after.Checksum != current.Checksum {
			t.Fatalf("note changed by a rejected save: %q at %s", after.Content, after.Checksum)
		}
	})

	t.Run("users who may not write never see the content through a conflict", func(t *testing.T) {
		for name, user := range map[string]string{"outsider": f.outsider, "viewer": f.viewer} {
			rec := putNote(f.h, user, f.note.ID, map[string]string{
				"title": "Secret", "path": "secret.md", "content": "probe", "prev_checksum": stale,
			})
			if rec.Code != http.StatusForbidden {
				t.Fatalf("%s: status = %d, want 403", name, rec.Code)
			}
			if strings.Contains(rec.Body.String(), "draft") {
				t.Fatalf("%s: refused response leaked note content: %s", name, rec.Body.String())
			}
		}
	})

	t.Run("the current checksum saves normally", func(t *testing.T) {
		rec := putNote(f.h, f.owner, f.note.ID, map[string]string{
			"title": "Secret", "path": "secret.md", "content": "resolved", "prev_checksum": current.Checksum,
		})
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
		}
		after, err := f.svc.GetNote(ctx, f.note.ID)
		if err != nil {
			t.Fatalf("get note: %v", err)
		}
		if after.Content != "resolved" {
			t.Fatalf("content = %q, want the resolved text", after.Content)
		}
	})
}

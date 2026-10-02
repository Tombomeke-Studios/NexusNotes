package handler

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
)

// A missing note is 404; a database that cannot answer is 500, never 404,
// or clients would treat an outage as deleted data (#386).
func TestLookupErrors_NotFoundVersusDatabaseFailure(t *testing.T) {
	f := newNoteAccessFixture(t)

	if rec := call(f.h.Get, http.MethodGet, f.owner, map[string]string{"noteId": uuid.NewString()}); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown note: status %d, want 404", rec.Code)
	}

	f.pool.Close()
	for name, fn := range map[string]http.HandlerFunc{
		"get":       f.h.Get,
		"versions":  f.h.Versions,
		"backlinks": f.h.Backlinks,
	} {
		if rec := call(fn, http.MethodGet, f.owner, map[string]string{"noteId": f.note.ID}); rec.Code != http.StatusInternalServerError {
			t.Errorf("%s with the database down: status %d, want 500", name, rec.Code)
		}
	}
}

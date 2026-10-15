package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/service"
)

func listVersions(f *noteAccessFixture, userID string, query url.Values) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/?"+query.Encode(), nil)
	req.SetPathValue("noteId", f.note.ID)
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, userID))
	rec := httptest.NewRecorder()
	f.h.Versions(rec, req)
	return rec
}

func decodeVersions(t *testing.T, rec *httptest.ResponseRecorder) []model.NoteVersion {
	t.Helper()
	var versions []model.NoteVersion
	if err := json.Unmarshal(rec.Body.Bytes(), &versions); err != nil {
		t.Fatalf("decode %s: %v", rec.Body.String(), err)
	}
	return versions
}

// #555: the version list pages with limit and a before cursor; without
// either it is the whole history, as before.
func TestVersions_Paging(t *testing.T) {
	f := newNoteAccessFixture(t)
	ctx := context.Background()
	// Each save from another device starts a version of its own (#413).
	note, err := f.svc.GetNote(ctx, f.note.ID)
	if err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 4; i++ {
		note, _, err = f.svc.UpdateNote(ctx, service.NoteUpdate{
			NoteID: note.ID, Title: note.Title, Path: note.Path, Content: fmt.Sprintf("edit %d", i),
			PrevChecksum: note.Checksum, DeviceID: fmt.Sprintf("device-%d", i),
		})
		if err != nil {
			t.Fatal(err)
		}
	}

	all := listVersions(f, f.owner, url.Values{})
	if all.Header().Get("X-Next-Cursor") != "" {
		t.Fatal("the unpaged list sent a cursor")
	}
	full := decodeVersions(t, all)
	if len(full) != 5 {
		t.Fatalf("%d versions, want 5", len(full))
	}

	var paged []string
	query := url.Values{"limit": {"2"}}
	for pages := 1; ; pages++ {
		if pages > 5 {
			t.Fatal("paging does not end")
		}
		rec := listVersions(f, f.owner, query)
		if rec.Code != http.StatusOK {
			t.Fatalf("page %d: status %d %s", pages, rec.Code, rec.Body.String())
		}
		page := decodeVersions(t, rec)
		for _, v := range page {
			paged = append(paged, v.ID)
		}
		next := rec.Header().Get("X-Next-Cursor")
		if next == "" {
			if pages != 3 || len(page) != 1 {
				t.Fatalf("last page is page %d with %d versions, want page 3 with 1", pages, len(page))
			}
			break
		}
		if len(page) != 2 {
			t.Fatalf("page %d has %d versions, want 2", pages, len(page))
		}
		query.Set("before", next)
	}
	for i, v := range full {
		if paged[i] != v.ID {
			t.Fatalf("pages %v differ from the full list order at %d", paged, i)
		}
	}

	// A cursor alone pages with the default size.
	first := listVersions(f, f.owner, url.Values{"limit": {"1"}})
	rest := decodeVersions(t, listVersions(f, f.owner, url.Values{"before": {first.Header().Get("X-Next-Cursor")}}))
	if len(rest) != 4 || rest[0].ID != full[1].ID {
		t.Fatalf("after the first: %d versions starting %v", len(rest), rest)
	}
}

func TestVersions_PagingRejectsBadInput(t *testing.T) {
	f := newNoteAccessFixture(t)
	for _, q := range []url.Values{
		{"limit": {"0"}}, {"limit": {"501"}}, {"limit": {"many"}},
		{"before": {"not-a-cursor"}}, {"limit": {"5"}, "before": {"bm90IGEgY3Vyc29y"}},
	} {
		if rec := listVersions(f, f.owner, q); rec.Code != http.StatusBadRequest {
			t.Errorf("%v: status %d, want 400", q, rec.Code)
		}
	}
	if rec := listVersions(f, f.outsider, url.Values{"limit": {"5"}}); rec.Code != http.StatusForbidden {
		t.Errorf("outsider: status %d, want 403", rec.Code)
	}
}

package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"testing"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt/fieldcrypttest"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/search"
)

// Without Meilisearch the fallback must still apply the tag filter, also
// together with a query, and never return every note for an empty search (#385).
func TestSearchFallback_TagFilter(t *testing.T) {
	f := newNoteAccessFixture(t)
	ctx := context.Background()
	for _, n := range []struct{ title, content string }{
		{"Alpha", "plan for #work about apples"},
		{"Beta", "apples at #home"},
		{"Gamma", "nothing tagged here"},
	} {
		if _, err := f.svc.CreateNote(ctx, f.ownerVault, n.title, n.title+".md", n.content, "dev", ""); err != nil {
			t.Fatal(err)
		}
	}
	dead := search.NewIndexer("http://127.0.0.1:1", "") // forces the fallback
	h := NewSearchHandler(dead, repository.NewVaultRepo(f.pool, fieldcrypttest.Cipher(t)), repository.NewNoteRepo(f.pool, fieldcrypttest.Cipher(t)))

	titles := func(query string) []string {
		req := httptest.NewRequest(http.MethodGet, "/api/search?vault="+f.ownerVault+query, nil)
		req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, f.owner))
		rec := httptest.NewRecorder()
		h.Search(rec, req)
		var hits []search.Hit
		if err := json.Unmarshal(rec.Body.Bytes(), &hits); err != nil {
			t.Fatalf("%s: %v (%s)", query, err, rec.Body.String())
		}
		out := []string{}
		for _, hit := range hits {
			out = append(out, hit.Title)
		}
		sort.Strings(out)
		return out
	}

	if got := titles("&q=apples&tag=work"); len(got) != 1 || got[0] != "Alpha" {
		t.Fatalf("q+tag: %v, want [Alpha]", got)
	}
	if got := titles("&tag=home"); len(got) != 1 || got[0] != "Beta" {
		t.Fatalf("tag only: %v, want [Beta]", got)
	}
	if got := titles("&q=apples"); len(got) != 2 {
		t.Fatalf("q only: %v, want Alpha and Beta", got)
	}
	if got := titles(""); len(got) != 0 {
		t.Fatalf("empty search: %v, want nothing", got)
	}
}

package search

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSearch_returnsHits(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		resp := meiliSearchResponse{
			Hits: []meiliHit{
				{ID: "n1", VaultID: "v1", Title: "Alpha", Path: "alpha.md", Tags: []string{"work"}},
				{ID: "n2", VaultID: "v1", Title: "Beta", Path: "beta.md"},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	idx := newTestIndexer(srv.URL)
	hits, err := idx.Search(context.Background(), SearchParams{Query: "alpha", VaultID: "v1"})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(hits) != 2 {
		t.Fatalf("expected 2 hits, got %d", len(hits))
	}
	if hits[0].ID != "n1" || hits[0].Title != "Alpha" {
		t.Errorf("unexpected first hit: %+v", hits[0])
	}
}

func TestSearch_extractsSnippet(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := meiliSearchResponse{
			Hits: []meiliHit{
				{
					ID:    "n1",
					Title: "Note",
					Formatted: map[string]interface{}{
						"content": "some <em>highlighted</em> text",
					},
				},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	idx := newTestIndexer(srv.URL)
	hits, err := idx.Search(context.Background(), SearchParams{Query: "highlighted", VaultID: "v1"})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(hits) == 0 {
		t.Fatal("no hits")
	}
	if hits[0].Snippet != "some <em>highlighted</em> text" {
		t.Errorf("unexpected snippet: %q", hits[0].Snippet)
	}
}

func TestSearch_serviceError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	idx := newTestIndexer(srv.URL)
	_, err := idx.Search(context.Background(), SearchParams{Query: "x", VaultID: "v1"})
	if err == nil {
		t.Fatal("expected error for 503")
	}
}

func TestBuildFilter_vaultOnly(t *testing.T) {
	f := buildFilter(SearchParams{VaultID: "abc"})
	if f != `vault_id = "abc"` {
		t.Errorf("unexpected filter: %q", f)
	}
}

func TestBuildFilter_allParams(t *testing.T) {
	f := buildFilter(SearchParams{
		VaultID:  "v1",
		Tag:      "work",
		DateFrom: "2024-01-01",
		DateTo:   "2024-12-31",
	})
	expected := `vault_id = "v1" AND tags = "work" AND updated_at >= "2024-01-01" AND updated_at <= "2024-12-31"`
	if f != expected {
		t.Errorf("unexpected filter:\ngot  %q\nwant %q", f, expected)
	}
}

func TestBuildFilter_empty(t *testing.T) {
	f := buildFilter(SearchParams{})
	if f != "" {
		t.Errorf("expected empty filter, got %q", f)
	}
}

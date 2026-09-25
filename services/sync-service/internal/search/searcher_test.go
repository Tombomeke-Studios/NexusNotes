package search

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestEscapeFilterValue(t *testing.T) {
	cases := map[string]string{
		"work":      "work",
		`a"b`:       `a\"b`,
		`a\b`:       `a\\b`,
		`trailing\`: `trailing\\`,
		`\"`:        `\\\"`,
		"":          "",
	}
	for in, want := range cases {
		if got := escapeFilterValue(in); got != want {
			t.Errorf("escapeFilterValue(%q) = %q, want %q", in, got, want)
		}
	}
}

// filterSkeleton lexes a Meilisearch filter the way its parser does — inside a
// double-quoted string a backslash consumes the next character and an
// unescaped quote ends the string — and returns the filter with every string's
// contents removed. Two filters with the same skeleton have the same logical
// structure, whatever the quoted values are.
func filterSkeleton(t *testing.T, filter string) string {
	t.Helper()
	var out strings.Builder
	inString := false
	for i := 0; i < len(filter); i++ {
		c := filter[i]
		switch {
		case !inString:
			out.WriteByte(c)
			inString = c == '"'
		case c == '\\':
			i++ // escaped character, never a terminator
			if i >= len(filter) {
				t.Fatalf("filter ends inside an escape: %q", filter)
			}
		case c == '"':
			out.WriteByte(c)
			inString = false
		}
	}
	if inString {
		t.Fatalf("unterminated string in filter: %q", filter)
	}
	return out.String()
}

func TestBuildFilter_hostileValuesCannotLeaveTheirClause(t *testing.T) {
	hostile := []string{
		`x" OR vault_id != "`,
		`x\" OR vault_id != \"`,
		`x\`,
		`\\" OR vault_id EXISTS OR tags = "`,
		`" OR (vault_id = "other") OR tags = "`,
		"\" OR vault_id != \"\n",
	}
	const vault = "7b2a1b8e-4c1e-4c4f-9f0a-2d3c4b5a6e7f"
	want := `vault_id = "" AND tags = "" AND updated_at >= "" AND updated_at <= ""`

	for _, v := range hostile {
		f := buildFilter(SearchParams{VaultID: vault, Tag: v, DateFrom: v, DateTo: v})
		if got := filterSkeleton(t, f); got != want {
			t.Errorf("value %q changed the filter structure:\nfilter   %s\nskeleton %s\nwant     %s", v, f, got, want)
		}
		if !strings.HasPrefix(f, `vault_id = "`+vault+`" AND `) {
			t.Errorf("vault clause altered for value %q: %s", v, f)
		}
	}

	// The vault id itself is escaped too, as defence in depth.
	f := buildFilter(SearchParams{VaultID: `v" OR vault_id != "`})
	if got := filterSkeleton(t, f); got != `vault_id = ""` {
		t.Errorf("hostile vault id changed the filter structure: %s", f)
	}
}

func TestSearch_sendsEscapedFilter(t *testing.T) {
	var sent meiliSearchRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&sent)
		_ = json.NewEncoder(w).Encode(meiliSearchResponse{})
	}))
	defer srv.Close()

	idx := newTestIndexer(srv.URL)
	if _, err := idx.Search(context.Background(), SearchParams{VaultID: "v1", Tag: `a" OR vault_id != "b`}); err != nil {
		t.Fatalf("Search: %v", err)
	}
	if want := `vault_id = "v1" AND tags = "a\" OR vault_id != \"b"`; sent.Filter != want {
		t.Errorf("filter sent to Meilisearch:\ngot  %s\nwant %s", sent.Filter, want)
	}
}

func TestValidDate(t *testing.T) {
	cases := map[string]bool{
		"2024-01-31":                true,
		"2024-01-31T10:20:30Z":      true,
		"2024-01-31T10:20:30+02:00": true,
		"2024-01-31T10:20:30.5Z":    true,
		"2024-13-01":                false,
		"2024-1-1":                  false,
		"yesterday":                 false,
		`2024-01-01" OR "`:          false,
		"":                          false,
	}
	for in, want := range cases {
		if got := ValidDate(in); got != want {
			t.Errorf("ValidDate(%q) = %v, want %v", in, got, want)
		}
	}
}

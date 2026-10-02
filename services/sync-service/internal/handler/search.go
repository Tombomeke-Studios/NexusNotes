package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/search"
)

type SearchHandler struct {
	indexer   *search.Indexer
	vaultRepo *repository.VaultRepo
	noteRepo  *repository.NoteRepo
}

func NewSearchHandler(indexer *search.Indexer, vaultRepo *repository.VaultRepo, noteRepo *repository.NoteRepo) *SearchHandler {
	return &SearchHandler{indexer: indexer, vaultRepo: vaultRepo, noteRepo: noteRepo}
}

// Search handles GET /search?q=&vault=&tag=&date_from=&date_to=&limit=&offset=
func (h *SearchHandler) Search(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	vaultID := q.Get("vault")
	if vaultID == "" {
		http.Error(w, `{"error":"vault parameter is required"}`, http.StatusBadRequest)
		return
	}
	// Every parameter below ends up in the search filter expression; reject
	// anything that is not the expected shape before it gets that far.
	if _, err := uuid.Parse(vaultID); err != nil {
		writeError(w, http.StatusBadRequest, "vault must be a vault id")
		return
	}
	for _, name := range []string{"date_from", "date_to"} {
		if v := q.Get(name); v != "" && !search.ValidDate(v) {
			writeError(w, http.StatusBadRequest, name+" must be a date (YYYY-MM-DD) or an RFC 3339 timestamp")
			return
		}
	}

	// Verify caller may read the vault (owner or member).
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	if !canRead(r.Context(), h.vaultRepo, vaultID, userID) {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}

	limit := 20
	if l := q.Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 && v <= 100 {
			limit = v
		}
	}
	offset := 0
	if o := q.Get("offset"); o != "" {
		if v, err := strconv.Atoi(o); err == nil && v >= 0 {
			offset = v
		}
	}

	params := search.SearchParams{
		Query:    q.Get("q"),
		VaultID:  vaultID,
		Tag:      q.Get("tag"),
		DateFrom: q.Get("date_from"),
		DateTo:   q.Get("date_to"),
		Limit:    limit,
		Offset:   offset,
	}

	hits, err := h.indexer.Search(r.Context(), params)
	if err != nil {
		// Meilisearch unavailable (not configured, down, or index missing):
		// fall back to the Postgres full-text search so search still works.
		hits = h.fallbackSearch(r, params)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(hits)
}

// fallbackSearch runs a Postgres-backed search when Meilisearch is unavailable.
// It returns an empty slice (never nil) so the JSON response is always an array.
func (h *SearchHandler) fallbackSearch(r *http.Request, params search.SearchParams) []search.Hit {
	hits := []search.Hit{}
	// An empty search is not "everything" (#385).
	if h.noteRepo == nil || (params.Query == "" && params.Tag == "") {
		return hits
	}
	// An empty query matches every note; the tag filter below then narrows it.
	results, err := h.noteRepo.Search(r.Context(), params.VaultID, params.Query)
	if err != nil {
		return hits
	}
	for _, res := range results {
		if params.Tag != "" && !hasTag(res.Tags, params.Tag) {
			continue
		}
		hits = append(hits, search.Hit{
			ID:        res.ID,
			VaultID:   res.VaultID,
			Title:     res.Title,
			Path:      res.Path,
			Tags:      res.Tags,
			UpdatedAt: res.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
			Snippet:   res.Snippet,
		})
	}
	return hits
}

// hasTag reports whether tags contains tag (case-insensitive, like the
// Meilisearch tag filter the fallback stands in for).
func hasTag(tags []string, tag string) bool {
	for _, t := range tags {
		if strings.EqualFold(t, tag) {
			return true
		}
	}
	return false
}

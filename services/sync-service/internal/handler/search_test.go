package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
)

// Malformed parameters are rejected before any vault lookup or search runs,
// so these cases need neither a database nor Meilisearch.
func TestSearch_RejectsMalformedParameters(t *testing.T) {
	const vault = "7b2a1b8e-4c1e-4c4f-9f0a-2d3c4b5a6e7f"
	cases := map[string]url.Values{
		"missing vault":           {},
		"vault is not a uuid":     {"vault": {`v1" OR vault_id != "x`}},
		"date_from not a date":    {"vault": {vault}, "date_from": {`2024-01-01" OR vault_id != "x`}},
		"date_to not a date":      {"vault": {vault}, "date_to": {"yesterday"}},
		"date_from invalid month": {"vault": {vault}, "date_from": {"2024-13-01"}},
	}
	h := NewSearchHandler(nil, nil, nil)
	for name, q := range cases {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/search?"+q.Encode(), nil)
			req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, "user-1"))
			rec := httptest.NewRecorder()
			h.Search(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (%s)", rec.Code, rec.Body.String())
			}
		})
	}
}

package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
)

func callJSON(fn http.HandlerFunc, userID string, pathValues map[string]string, body any) *httptest.ResponseRecorder {
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(b))
	for k, v := range pathValues {
		req.SetPathValue(k, v)
	}
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, userID))
	rec := httptest.NewRecorder()
	fn(rec, req)
	return rec
}

// POST /api/vaults/{id}/encryption/convert (#361).
func TestConvertVault_HTTP(t *testing.T) {
	f := newNoteAccessFixture(t)
	current, err := f.svc.GetNote(context.Background(), f.note.ID)
	if err != nil {
		t.Fatal(err)
	}
	vault := map[string]string{"id": f.ownerVault}
	body := func(base string) map[string]any {
		return map[string]any{
			"encryption_meta": map[string]int{"v": 1},
			"notes": []map[string]string{
				{"id": f.note.ID, "title": "e2ee:title", "path": "", "content": "iv:cipher", "checksum": "plain-sum", "base_checksum": base},
			},
		}
	}

	if rec := callJSON(f.h.ConvertVault, f.viewer, vault, body(current.Checksum)); rec.Code != http.StatusNotFound {
		t.Fatalf("member (not owner): status %d, want 404", rec.Code)
	}
	if rec := callJSON(f.h.ConvertVault, f.owner, vault, body("stale")); rec.Code != http.StatusConflict {
		t.Fatalf("stale note: status %d, want 409", rec.Code)
	}
	if rec := callJSON(f.h.ConvertVault, f.owner, vault, map[string]any{"notes": []any{}}); rec.Code != http.StatusBadRequest {
		t.Fatalf("no key material: status %d, want 400", rec.Code)
	}

	rec := callJSON(f.h.ConvertVault, f.owner, vault, body(current.Checksum))
	if rec.Code != http.StatusOK {
		t.Fatalf("convert: status %d (%s), want 200", rec.Code, rec.Body.String())
	}
	var got struct {
		Encryption string `json:"encryption"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || got.Encryption != "e2ee" {
		t.Fatalf("response vault: %s", rec.Body.String())
	}
	if rec := callJSON(f.h.ConvertVault, f.owner, vault, body("plain-sum")); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("already e2ee: status %d, want 422", rec.Code)
	}
}

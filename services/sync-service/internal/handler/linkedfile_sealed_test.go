package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt/fieldcrypttest"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
)

// In an e2ee vault the stored source is sealed (#364): the client sends the
// URL with the request, and the server fetches it without storing it.
func TestLinkedContent_SealedSource(t *testing.T) {
	pool := newIsolatedDB(t)
	ctx := context.Background()
	vaultRepo := repository.NewVaultRepo(pool, fieldcrypttest.Cipher(t))
	repo := repository.NewLinkedFileRepo(pool, fieldcrypttest.Cipher(t))
	h := NewLinkedFileHandler(repo, vaultRepo, true) // the test source is on loopback

	owner, outsider := seedUser(t, pool), seedUser(t, pool)
	e2eeVault, plainVault := seedVaultFor(t, pool, owner), seedVaultFor(t, pool, owner)
	if _, err := pool.Exec(ctx, `UPDATE vaults SET encryption = 'e2ee', encryption_meta = '{}' WHERE id = $1`, e2eeVault); err != nil {
		t.Fatal(err)
	}
	link := func(vaultID, ref string) string {
		lf := &model.LinkedFile{ID: uuid.New().String(), VaultID: vaultID, DisplayName: "e2ee:name", SourceType: model.LinkedSourceURL, SourceRef: ref, ReadOnly: true, CreatedAt: time.Now().UTC()}
		if err := repo.Create(ctx, lf); err != nil {
			t.Fatal(err)
		}
		return lf.ID
	}
	sealed, plain := link(e2eeVault, "e2ee:sealed-url"), link(plainVault, "https://example.com")

	src := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("hello from the source"))
	}))
	defer src.Close()

	rec := callJSON(h.FetchContent, owner, map[string]string{"linkId": sealed}, map[string]string{"url": src.URL})
	if rec.Code != http.StatusOK {
		t.Fatalf("sealed link: status %d (%s)", rec.Code, rec.Body.String())
	}
	var got struct{ Content string }
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if got.Content != "hello from the source" {
		t.Fatalf("content = %q", got.Content)
	}

	for name, tc := range map[string]struct {
		user, link, url string
		want            int
	}{
		"not a member":           {outsider, sealed, src.URL, http.StatusForbidden},
		"not an http(s) URL":     {owner, sealed, "file:///etc/passwd", http.StatusBadRequest},
		"standard vault refuses": {owner, plain, src.URL, http.StatusUnprocessableEntity},
	} {
		if rec := callJSON(h.FetchContent, tc.user, map[string]string{"linkId": tc.link}, map[string]string{"url": tc.url}); rec.Code != tc.want {
			t.Errorf("%s: status %d, want %d (%s)", name, rec.Code, tc.want, rec.Body.String())
		}
	}

	// The stored source of a sealed link is not a URL the server can fetch.
	if rec := call(h.Content, http.MethodGet, owner, map[string]string{"linkId": sealed}); rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("GET on a sealed link: status %d, want 422", rec.Code)
	}
}

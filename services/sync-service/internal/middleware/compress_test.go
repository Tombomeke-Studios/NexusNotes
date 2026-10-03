package middleware

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCompress(t *testing.T) {
	big := strings.Repeat(`{"content":"markdown text "}`, 200)
	h := Compress(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/json":
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, big)
		case "/small":
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"ok":true}`)
		case "/bytes":
			w.Header().Set("Content-Type", "image/png")
			_, _ = io.WriteString(w, big)
		case "/empty":
			w.WriteHeader(http.StatusNoContent)
		}
	}))
	get := func(path, enc string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		if enc != "" {
			req.Header.Set("Accept-Encoding", enc)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	rec := get("/json", "gzip, deflate, br")
	if rec.Header().Get("Content-Encoding") != "gzip" || !strings.Contains(rec.Header().Get("Vary"), "Accept-Encoding") {
		t.Fatalf("headers = %v", rec.Header())
	}
	zr, err := gzip.NewReader(rec.Body)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(zr)
	if string(body) != big {
		t.Fatal("decompressed body differs")
	}
	if rec.Body.Len() > len(big)/4 {
		t.Fatalf("barely compressed: %d of %d bytes", rec.Body.Len(), len(big))
	}

	for name, rec := range map[string]*httptest.ResponseRecorder{
		"no Accept-Encoding": get("/json", ""),
		"not JSON":           get("/bytes", "gzip"),
		"tiny body":          get("/small", "gzip"),
		"no body":            get("/empty", "gzip"),
	} {
		if rec.Header().Get("Content-Encoding") != "" {
			t.Errorf("%s: compressed, want plain", name)
		}
	}
	if got := get("/small", "gzip").Body.String(); got != `{"ok":true}` {
		t.Errorf("tiny body = %q", got)
	}

	// A WebSocket upgrade is never wrapped.
	req := httptest.NewRequest(http.MethodGet, "/json", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	req.Header.Set("Upgrade", "websocket")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Header().Get("Content-Encoding") != "" {
		t.Error("compressed a WebSocket upgrade")
	}
}

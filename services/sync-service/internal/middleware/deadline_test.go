package middleware

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// A slow handler behind a short server WriteTimeout only completes when the
// route extends its own deadline (#332).
func TestDeadlinesExtendTheServerWriteTimeout(t *testing.T) {
	slow := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(300 * time.Millisecond)
		_, _ = io.WriteString(w, "done")
	})
	serve := func(h http.Handler) (string, error) {
		srv := httptest.NewUnstartedServer(h)
		srv.Config.WriteTimeout = 100 * time.Millisecond
		srv.Start()
		defer srv.Close()
		resp, err := http.Get(srv.URL)
		if err != nil {
			return "", err
		}
		defer func() { _ = resp.Body.Close() }()
		body, err := io.ReadAll(resp.Body)
		return string(body), err
	}

	if body, err := serve(slow); err == nil && body == "done" {
		t.Fatal("precondition: without Deadlines the server WriteTimeout must cut the response")
	}
	if body, err := serve(Deadlines(time.Second, time.Second)(slow)); err != nil || body != "done" {
		t.Fatalf("with Deadlines: body %q, err %v; want done", body, err)
	}
}

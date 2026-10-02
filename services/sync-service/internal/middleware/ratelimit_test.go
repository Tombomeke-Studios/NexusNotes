package middleware

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

func doRequest(t *testing.T, h http.Handler, remoteAddr string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
	req.RemoteAddr = remoteAddr
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestRateLimit_AllowsRequestsWithinBurst(t *testing.T) {
	rl := NewRateLimiter(6, 3)
	h := rl.Middleware(okHandler())

	for i := 0; i < 3; i++ {
		if rec := doRequest(t, h, "10.0.0.1:1234"); rec.Code != http.StatusOK {
			t.Fatalf("request %d: got status %d, want %d", i+1, rec.Code, http.StatusOK)
		}
	}
}

func TestRateLimit_BlocksOverBurstWithRetryAfter(t *testing.T) {
	rl := NewRateLimiter(6, 3)
	h := rl.Middleware(okHandler())

	for i := 0; i < 3; i++ {
		doRequest(t, h, "10.0.0.1:1234")
	}
	rec := doRequest(t, h, "10.0.0.1:1234")

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("got status %d, want %d", rec.Code, http.StatusTooManyRequests)
	}
	retryAfter := rec.Header().Get("Retry-After")
	if retryAfter == "" {
		t.Fatal("expected a Retry-After header on 429 response")
	}
	secs, err := strconv.Atoi(retryAfter)
	if err != nil || secs < 1 {
		t.Fatalf("Retry-After = %q, want a positive integer number of seconds", retryAfter)
	}
}

func TestRateLimit_RefillsOverTime(t *testing.T) {
	rl := NewRateLimiter(6, 3) // 6 per minute = 1 token per 10s
	now := time.Now()
	rl.now = func() time.Time { return now }
	h := rl.Middleware(okHandler())

	for i := 0; i < 3; i++ {
		doRequest(t, h, "10.0.0.1:1234")
	}
	if rec := doRequest(t, h, "10.0.0.1:1234"); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("got status %d, want %d before refill", rec.Code, http.StatusTooManyRequests)
	}

	now = now.Add(10 * time.Second)
	if rec := doRequest(t, h, "10.0.0.1:1234"); rec.Code != http.StatusOK {
		t.Fatalf("got status %d, want %d after refill", rec.Code, http.StatusOK)
	}
}

func TestRateLimit_TracksClientIPsIndependently(t *testing.T) {
	rl := NewRateLimiter(6, 1)
	h := rl.Middleware(okHandler())

	doRequest(t, h, "10.0.0.1:1234")
	if rec := doRequest(t, h, "10.0.0.1:5678"); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("same IP, different port: got %d, want %d", rec.Code, http.StatusTooManyRequests)
	}
	if rec := doRequest(t, h, "10.0.0.2:1234"); rec.Code != http.StatusOK {
		t.Fatalf("different IP: got %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestRateLimit_PurgesStaleClients(t *testing.T) {
	rl := NewRateLimiter(6, 1)
	now := time.Now()
	rl.now = func() time.Time { return now }
	h := rl.Middleware(okHandler())

	doRequest(t, h, "10.0.0.1:1234")
	doRequest(t, h, "10.0.0.2:1234")

	now = now.Add(staleAfter + time.Second)
	doRequest(t, h, "10.0.0.3:1234")

	rl.mu.Lock()
	n := len(rl.clients)
	rl.mu.Unlock()
	if n != 1 {
		t.Fatalf("got %d tracked clients after purge, want 1", n)
	}
}

// Stale buckets are dropped, but the map is not walked on every request (#373).
func TestRateLimit_PurgesStaleBucketsPeriodically(t *testing.T) {
	rl := NewRateLimiter(60, 5)
	now := time.Unix(1_000_000, 0)
	rl.now = func() time.Time { return now }

	rl.allow("10.0.0.1")
	now = now.Add(staleAfter + time.Second)
	rl.allow("10.0.0.2") // first purge pass: drops 10.0.0.1
	if _, ok := rl.clients["10.0.0.1"]; ok {
		t.Fatal("a bucket idle for longer than staleAfter must be purged")
	}

	now = now.Add(time.Second)
	rl.clients["ghost"] = &bucket{lastSeen: now.Add(-time.Hour)}
	rl.allow("10.0.0.2") // within purgeEvery of the last pass: no walk
	if _, ok := rl.clients["ghost"]; !ok {
		t.Fatal("purge must not run on every request")
	}
	now = now.Add(purgeEvery)
	rl.allow("10.0.0.2")
	if _, ok := rl.clients["ghost"]; ok {
		t.Fatal("the next periodic purge must drop the stale bucket")
	}
}

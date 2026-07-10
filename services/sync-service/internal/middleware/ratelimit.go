package middleware

import (
	"math"
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// staleAfter is how long a client may be idle before its bucket is dropped.
const staleAfter = 3 * time.Minute

type bucket struct {
	tokens   float64
	lastSeen time.Time
}

// RateLimiter applies a per-client-IP token bucket. Buckets refill at
// perMinute tokens per minute up to a maximum of burst tokens; each request
// costs one token. State is in-memory, which is sufficient for the
// single-instance self-hosted deployment model.
type RateLimiter struct {
	mu      sync.Mutex
	clients map[string]*bucket
	rate    float64 // tokens per second
	burst   float64
	now     func() time.Time
}

func NewRateLimiter(perMinute, burst int) *RateLimiter {
	return &RateLimiter{
		clients: make(map[string]*bucket),
		rate:    float64(perMinute) / 60.0,
		burst:   float64(burst),
		now:     time.Now,
	}
}

func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		allowed, retryAfter := rl.allow(clientIP(r))
		if !allowed {
			w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
			http.Error(w, "too many requests", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// allow reports whether the client may proceed; when denied it also returns
// the number of whole seconds until a token becomes available.
func (rl *RateLimiter) allow(ip string) (bool, int) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := rl.now()
	rl.purge(now)

	b, ok := rl.clients[ip]
	if !ok {
		b = &bucket{tokens: rl.burst}
		rl.clients[ip] = b
	} else {
		b.tokens = math.Min(rl.burst, b.tokens+now.Sub(b.lastSeen).Seconds()*rl.rate)
	}
	b.lastSeen = now

	if b.tokens < 1 {
		return false, int(math.Ceil((1 - b.tokens) / rl.rate))
	}
	b.tokens--
	return true, 0
}

func (rl *RateLimiter) purge(now time.Time) {
	for ip, b := range rl.clients {
		if now.Sub(b.lastSeen) > staleAfter {
			delete(rl.clients, ip)
		}
	}
}

// clientIP extracts the remote host, ignoring the ephemeral port so that all
// connections from one address share a bucket.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

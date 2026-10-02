package middleware

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
)

func clientIPVia(t *testing.T, mw func(http.Handler) http.Handler, remote string, headers map[string]string) string {
	t.Helper()
	var got string
	h := mw(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { got = ClientIP(r) }))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = remote
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	h.ServeHTTP(httptest.NewRecorder(), req)
	return got
}

// Behind the web UI's nginx every request comes from the proxy; the client IP
// must come from the proxy's headers, but only when the peer is trusted (#373).
func TestRealIP(t *testing.T) {
	trusted := []netip.Prefix{netip.MustParsePrefix("172.16.0.0/12"), netip.MustParsePrefix("10.9.9.9/32")}
	mw := RealIP(trusted)

	cases := []struct {
		name    string
		remote  string
		headers map[string]string
		want    string
	}{
		{"untrusted peer: headers ignored (no spoofing)", "203.0.113.5:4000",
			map[string]string{"X-Real-IP": "1.2.3.4", "X-Forwarded-For": "1.2.3.4"}, "203.0.113.5"},
		{"trusted proxy with X-Real-IP", "172.18.0.3:5000",
			map[string]string{"X-Real-IP": "198.51.100.7"}, "198.51.100.7"},
		{"X-Forwarded-For: rightmost untrusted hop wins over a spoofed left entry", "172.18.0.3:5000",
			map[string]string{"X-Forwarded-For": "6.6.6.6, 198.51.100.7, 10.9.9.9", "X-Real-IP": "10.9.9.9"}, "198.51.100.7"},
		{"IPv6 client", "172.18.0.3:5000",
			map[string]string{"X-Real-IP": "2001:db8::42"}, "2001:db8::42"},
		{"garbage header falls back to the peer", "172.18.0.3:5000",
			map[string]string{"X-Real-IP": "not-an-ip"}, "172.18.0.3"},
		{"all hops trusted: leftmost is the client", "172.18.0.3:5000",
			map[string]string{"X-Forwarded-For": "10.9.9.9"}, "10.9.9.9"},
	}
	for _, c := range cases {
		if got := clientIPVia(t, mw, c.remote, c.headers); got != c.want {
			t.Errorf("%s: ClientIP = %q, want %q", c.name, got, c.want)
		}
	}

	// No trusted proxies configured: never read the headers.
	if got := clientIPVia(t, RealIP(nil), "172.18.0.3:5000", map[string]string{"X-Real-IP": "1.2.3.4"}); got != "172.18.0.3" {
		t.Errorf("without TRUSTED_PROXIES: ClientIP = %q, want the peer", got)
	}
}

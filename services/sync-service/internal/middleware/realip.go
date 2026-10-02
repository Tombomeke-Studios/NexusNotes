package middleware

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// RealIP replaces r.RemoteAddr with the client's address taken from proxy
// headers, but only when the direct peer is one of the trusted proxies
// (TRUSTED_PROXIES). Behind the web UI's nginx every request otherwise comes
// from the proxy, so all users would share one rate-limit bucket (#373); from
// an untrusted peer the headers are ignored, so a client cannot spoof its IP.
//
// X-Forwarded-For is read right to left and the first untrusted hop is the
// client (entries further left are client-supplied). Without it, X-Real-IP is
// used. A missing or malformed header leaves RemoteAddr as it is.
func RealIP(trusted []netip.Prefix) func(http.Handler) http.Handler {
	isTrusted := func(a netip.Addr) bool {
		a = a.Unmap()
		for _, p := range trusted {
			if p.Contains(a) {
				return true
			}
		}
		return false
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if len(trusted) > 0 {
				if peer, err := netip.ParseAddr(ClientIP(r)); err == nil && isTrusted(peer) {
					if client, ok := forwardedClient(r, isTrusted); ok {
						r.RemoteAddr = net.JoinHostPort(client.String(), "0")
					}
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

func forwardedClient(r *http.Request, isTrusted func(netip.Addr) bool) (netip.Addr, bool) {
	if xff := r.Header.Values("X-Forwarded-For"); len(xff) > 0 {
		hops := strings.Split(strings.Join(xff, ","), ",")
		var leftmost netip.Addr
		for i := len(hops) - 1; i >= 0; i-- {
			a, err := netip.ParseAddr(strings.TrimSpace(hops[i]))
			if err != nil {
				break // a malformed hop: stop rather than trust what lies beyond it
			}
			a = a.Unmap()
			if !isTrusted(a) {
				return a, true
			}
			leftmost = a
		}
		if leftmost.IsValid() {
			return leftmost, true // every hop is a trusted proxy
		}
	}
	if a, err := netip.ParseAddr(strings.TrimSpace(r.Header.Get("X-Real-IP"))); err == nil {
		return a.Unmap(), true
	}
	return netip.Addr{}, false
}

package handler

import (
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"sync"
	"syscall"
	"time"
)

const (
	// maxLinkedContentBytes caps the size of a proxied URL fetch.
	maxLinkedContentBytes = 5 << 20 // 5 MiB
	// maxLinkedRedirects caps how many redirects a proxied fetch follows.
	maxLinkedRedirects = 3
	// linkedFetchTimeout bounds a whole proxied fetch, redirects included.
	linkedFetchTimeout = 15 * time.Second
	// maxLinkedFetchesPerUser and maxLinkedFetches cap concurrent proxied
	// fetches, so one user cannot tie up the server's outbound connections
	// (each fetch may run for linkedFetchTimeout) (#337).
	maxLinkedFetchesPerUser = 2
	maxLinkedFetches        = 16
)

var (
	// errBlockedDestination is returned when a linked-file fetch would connect
	// to a non-public address (loopback, private, link-local, ...).
	errBlockedDestination = errors.New("destination address is not publicly routable")
	errTooManyRedirects   = fmt.Errorf("stopped after %d redirects", maxLinkedRedirects)
	errSourceTooLarge     = fmt.Errorf("source exceeds %d bytes", maxLinkedContentBytes)
)

// nonPublicPrefixes are ranges that netip's predicates do not already cover
// but that must never be reachable from the linked-file proxy.
var nonPublicPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),      // "this network"
	netip.MustParsePrefix("100.64.0.0/10"),  // carrier-grade NAT (RFC 6598)
	netip.MustParsePrefix("192.0.0.0/24"),   // IETF protocol assignments
	netip.MustParsePrefix("198.18.0.0/15"),  // benchmarking (RFC 2544)
	netip.MustParsePrefix("240.0.0.0/4"),    // reserved, incl. broadcast
	netip.MustParsePrefix("64:ff9b::/96"),   // NAT64: embeds an IPv4 address
	netip.MustParsePrefix("64:ff9b:1::/48"), // local-use NAT64
	netip.MustParsePrefix("fec0::/10"),      // deprecated site-local
	netip.MustParsePrefix("2001:db8::/32"),  // documentation
	netip.MustParsePrefix("100::/64"),       // discard-only
	netip.MustParsePrefix("2002::/16"),      // 6to4: embeds an IPv4 address
	netip.MustParsePrefix("2001::/32"),      // Teredo: embeds an IPv4 address
	netip.MustParsePrefix("::/96"),          // deprecated IPv4-compatible
	// Reviewed in #337:
	netip.MustParsePrefix("192.0.2.0/24"),    // TEST-NET-1 (documentation)
	netip.MustParsePrefix("198.51.100.0/24"), // TEST-NET-2 (documentation)
	netip.MustParsePrefix("203.0.113.0/24"),  // TEST-NET-3 (documentation)
	netip.MustParsePrefix("192.88.99.0/24"),  // deprecated 6to4 relay anycast
	netip.MustParsePrefix("3fff::/20"),       // documentation (RFC 9637)
	netip.MustParsePrefix("::ffff:0:0:0/96"), // IPv4-translated (SIIT): embeds an IPv4 address
}

// isPublicAddr reports whether a is a globally routable unicast address that
// the linked-file proxy may connect to. Loopback, private (RFC 1918 and
// fc00::/7), link-local (incl. 169.254.169.254 metadata endpoints),
// unspecified, multicast, CGNAT and other special-purpose ranges are not.
func isPublicAddr(a netip.Addr) bool {
	if !a.IsValid() {
		return false
	}
	// Judge IPv4-mapped IPv6 (::ffff:a.b.c.d) by the IPv4 address it maps to,
	// so a mapped public address stays reachable and a mapped private one is
	// refused like its IPv4 form (#337).
	a = a.Unmap()
	if a.IsLoopback() || a.IsPrivate() || a.IsLinkLocalUnicast() ||
		a.IsLinkLocalMulticast() || a.IsInterfaceLocalMulticast() ||
		a.IsMulticast() || a.IsUnspecified() {
		return false
	}
	for _, p := range nonPublicPrefixes {
		if p.Contains(a) {
			return false
		}
	}
	return true
}

// newLinkedFileClient returns the HTTP client used to proxy URL-linked files.
// Unless allowPrivate is set (LINKED_FILES_ALLOW_PRIVATE, for self-hosters who
// link LAN resources), it refuses to connect to any non-public address.
func newLinkedFileClient(allowPrivate bool) *http.Client {
	if allowPrivate {
		return newGuardedClient(func(netip.AddrPort) bool { return true })
	}
	return newGuardedClient(func(ap netip.AddrPort) bool { return isPublicAddr(ap.Addr()) })
}

// newGuardedClient builds a client whose every outgoing connection is checked
// by allow. The check runs in the dialer on the already-resolved address, so
// it covers each redirect hop and cannot be sidestepped by a hostname that
// resolves (or re-resolves) to an internal address.
func newGuardedClient(allow func(netip.AddrPort) bool) *http.Client {
	dialer := &net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
		Control: func(_, address string, _ syscall.RawConn) error {
			ap, err := netip.ParseAddrPort(address)
			if err != nil || !allow(ap) {
				return errBlockedDestination
			}
			return nil
		},
	}
	transport := &http.Transport{
		// No proxy: connect directly, so the guard sees the real destination.
		Proxy:                 nil,
		DialContext:           dialer.DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          10,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
	}
	return &http.Client{
		Timeout:   linkedFetchTimeout,
		Transport: transport,
		CheckRedirect: func(_ *http.Request, via []*http.Request) error {
			if len(via) > maxLinkedRedirects {
				return errTooManyRedirects
			}
			return nil
		},
	}
}

// readLinkedBody reads a proxied response body, refusing sources larger than
// maxLinkedContentBytes instead of silently returning a truncated copy.
func readLinkedBody(resp *http.Response) ([]byte, error) {
	if resp.ContentLength > maxLinkedContentBytes {
		return nil, errSourceTooLarge
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxLinkedContentBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxLinkedContentBytes {
		return nil, errSourceTooLarge
	}
	return body, nil
}

// fetchLimiter caps concurrent linked-file fetches per user and overall.
// It never blocks: a fetch over either cap is refused (429), so waiting
// requests cannot pile up behind slow sources (#337).
type fetchLimiter struct {
	mu      sync.Mutex
	perUser int
	total   int
	active  int
	byUser  map[string]int
}

func newFetchLimiter(perUser, total int) *fetchLimiter {
	return &fetchLimiter{perUser: perUser, total: total, byUser: map[string]int{}}
}

// acquire admits a fetch for userID, returning a release func (safe to call
// more than once), or false when a cap is reached.
func (l *fetchLimiter) acquire(userID string) (func(), bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.active >= l.total || l.byUser[userID] >= l.perUser {
		return nil, false
	}
	l.active++
	l.byUser[userID]++
	var once sync.Once
	return func() {
		once.Do(func() {
			l.mu.Lock()
			defer l.mu.Unlock()
			l.active--
			if l.byUser[userID]--; l.byUser[userID] <= 0 {
				delete(l.byUser, userID)
			}
		})
	}, true
}

// inFlight reports how many fetches userID has running (for tests).
func (l *fetchLimiter) inFlight(userID string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.byUser[userID]
}

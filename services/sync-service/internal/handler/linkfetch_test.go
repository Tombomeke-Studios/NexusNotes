package handler

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"
)

func TestIsPublicAddr(t *testing.T) {
	blocked := []string{
		"127.0.0.1", "127.1.2.3", "::1", // loopback
		"10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", // RFC 1918
		"fc00::1", "fd12:3456::1", // unique local
		"169.254.169.254", "169.254.0.1", "fe80::1", // link-local (incl. cloud metadata)
		"0.0.0.0", "0.1.2.3", "::", // unspecified / "this network"
		"224.0.0.1", "239.255.255.250", "ff02::1", // multicast
		"100.64.0.1", "100.127.255.255", // carrier-grade NAT
		"255.255.255.255", "240.0.0.1", // reserved / broadcast
		"198.18.0.1",                          // benchmarking
		"::ffff:127.0.0.1", "::ffff:10.0.0.1", // IPv4-mapped IPv6
		"::ffff:169.254.169.254", "64:ff9b::a9fe:a9fe", // mapped / NAT64 forms of metadata
		"fec0::1", // deprecated site-local
	}
	for _, s := range blocked {
		if isPublicAddr(netip.MustParseAddr(s)) {
			t.Errorf("isPublicAddr(%s) = true, want false", s)
		}
	}

	allowed := []string{
		"8.8.8.8", "1.1.1.1", "93.184.216.34",
		"172.32.0.1", "172.15.255.255", // just outside 172.16.0.0/12
		"100.63.255.255", "100.128.0.1", // just outside 100.64.0.0/10
		"2606:4700:4700::1111", "2001:4860:4860::8888",
	}
	for _, s := range allowed {
		if !isPublicAddr(netip.MustParseAddr(s)) {
			t.Errorf("isPublicAddr(%s) = false, want true", s)
		}
	}
}

func okServer(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "hello")
	}))
	t.Cleanup(srv.Close)
	return srv
}

func get(client *http.Client, url string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	return client.Do(req)
}

func TestLinkedFileClient_RefusesLoopbackByDefault(t *testing.T) {
	srv := okServer(t) // listens on 127.0.0.1
	client := newLinkedFileClient(false)

	for _, url := range []string{
		srv.URL,
		// A hostname is checked after resolution, not by its spelling.
		strings.Replace(srv.URL, "127.0.0.1", "localhost", 1),
	} {
		resp, err := get(client, url)
		if err == nil {
			_ = resp.Body.Close()
			t.Fatalf("GET %s succeeded, want it refused", url)
		}
		if !errors.Is(err, errBlockedDestination) {
			t.Fatalf("GET %s: err = %v, want errBlockedDestination", url, err)
		}
	}
}

func TestLinkedFileClient_AllowPrivateOptOut(t *testing.T) {
	srv := okServer(t)
	resp, err := get(newLinkedFileClient(true), srv.URL)
	if err != nil {
		t.Fatalf("GET with private addresses allowed: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if body, _ := io.ReadAll(resp.Body); string(body) != "hello" {
		t.Fatalf("body = %q", body)
	}
}

// Every connection passes the guard, so a redirect cannot reach an address
// the first request could not. The test allows only the first server's exact
// address to stand in for "public".
func TestLinkedFileClient_RedirectTargetIsCheckedAtConnectTime(t *testing.T) {
	target := okServer(t)
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusFound)
	}))
	defer origin.Close()

	originAddr := netip.MustParseAddrPort(strings.TrimPrefix(origin.URL, "http://"))
	client := newGuardedClient(func(ap netip.AddrPort) bool { return ap == originAddr })

	resp, err := get(client, origin.URL)
	if err == nil {
		_ = resp.Body.Close()
		t.Fatal("redirect to a blocked address succeeded")
	}
	if !errors.Is(err, errBlockedDestination) {
		t.Fatalf("err = %v, want errBlockedDestination", err)
	}
}

func TestLinkedFileClient_CapsRedirects(t *testing.T) {
	var hops atomic.Int32
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := hops.Add(1)
		http.Redirect(w, r, fmt.Sprintf("%s/hop%d", srv.URL, n), http.StatusFound)
	}))
	defer srv.Close()

	resp, err := get(newLinkedFileClient(true), srv.URL)
	if err == nil {
		_ = resp.Body.Close()
		t.Fatal("endless redirect chain succeeded")
	}
	if !errors.Is(err, errTooManyRedirects) {
		t.Fatalf("err = %v, want errTooManyRedirects", err)
	}
	if got := int(hops.Load()); got != maxLinkedRedirects+1 {
		t.Fatalf("server saw %d requests, want %d (first request + %d redirects)", got, maxLinkedRedirects+1, maxLinkedRedirects)
	}
}

func TestReadLinkedBody_RejectsOversizedSources(t *testing.T) {
	within := strings.Repeat("a", maxLinkedContentBytes)
	body, err := readLinkedBody(&http.Response{ContentLength: -1, Body: io.NopCloser(strings.NewReader(within))})
	if err != nil || len(body) != maxLinkedContentBytes {
		t.Fatalf("body at the limit: len=%d err=%v", len(body), err)
	}

	over := within + "b"
	if _, err := readLinkedBody(&http.Response{ContentLength: -1, Body: io.NopCloser(strings.NewReader(over))}); !errors.Is(err, errSourceTooLarge) {
		t.Fatalf("streamed body over the limit: err = %v, want errSourceTooLarge", err)
	}

	// A declared length over the limit is refused without reading the body.
	if _, err := readLinkedBody(&http.Response{ContentLength: maxLinkedContentBytes + 1, Body: io.NopCloser(strings.NewReader(""))}); !errors.Is(err, errSourceTooLarge) {
		t.Fatalf("declared length over the limit: err = %v, want errSourceTooLarge", err)
	}
}

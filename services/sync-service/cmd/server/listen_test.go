package main

import (
	"net"
	"testing"
)

func TestListenAll_OpensEveryAddress(t *testing.T) {
	listeners, err := listenAll([]string{"127.0.0.1:0", "127.0.0.1:0"})
	if err != nil {
		t.Fatalf("listenAll: %v", err)
	}
	defer closeAll(listeners)

	if len(listeners) != 2 {
		t.Fatalf("got %d listeners, want 2", len(listeners))
	}
	for _, ln := range listeners {
		conn, err := net.Dial("tcp", ln.Addr().String())
		if err != nil {
			t.Fatalf("dial %s: %v", ln.Addr(), err)
		}
		_ = conn.Close()
	}
}

func TestListenAll_FailureReleasesAlreadyOpenedListeners(t *testing.T) {
	// Reserve a free port, then free it so listenAll can take it.
	probe, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("probe: %v", err)
	}
	addr := probe.Addr().String()
	_ = probe.Close()

	if _, err := listenAll([]string{addr, "256.0.0.1:0"}); err == nil {
		t.Fatal("expected an error for an unbindable address")
	}

	// The first listener must have been closed, or this bind would fail.
	again, err := net.Listen("tcp", addr)
	if err != nil {
		t.Fatalf("port %s still held after a failed listenAll: %v", addr, err)
	}
	_ = again.Close()
}

func TestListenAll_RejectsEmptyList(t *testing.T) {
	if _, err := listenAll(nil); err == nil {
		t.Fatal("expected an error for no addresses")
	}
}

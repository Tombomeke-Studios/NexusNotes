package main

import (
	"errors"
	"fmt"
	"net"
)

// listenAll opens a TCP listener on every address, all or nothing: when one
// fails, the ones already opened are closed again so the port is not left
// half-bound.
func listenAll(addrs []string) ([]net.Listener, error) {
	if len(addrs) == 0 {
		return nil, errors.New("no listen address configured")
	}
	listeners := make([]net.Listener, 0, len(addrs))
	for _, addr := range addrs {
		ln, err := net.Listen("tcp", addr)
		if err != nil {
			closeAll(listeners)
			return nil, fmt.Errorf("listen on %s: %w", addr, err)
		}
		listeners = append(listeners, ln)
	}
	return listeners, nil
}

func closeAll(listeners []net.Listener) {
	for _, ln := range listeners {
		_ = ln.Close()
	}
}

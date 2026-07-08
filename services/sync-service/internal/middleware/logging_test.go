package middleware

import (
	"bufio"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

// hijackableRecorder is an httptest recorder that also supports Hijack.
type hijackableRecorder struct {
	*httptest.ResponseRecorder
	hijacked bool
}

func (h *hijackableRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h.hijacked = true
	return nil, nil, nil
}

func TestResponseWriter_ImplementsHijacker(t *testing.T) {
	rw := &responseWriter{ResponseWriter: httptest.NewRecorder(), status: http.StatusOK}
	if _, ok := interface{}(rw).(http.Hijacker); !ok {
		t.Fatal("responseWriter must implement http.Hijacker for WebSocket upgrades")
	}
}

func TestResponseWriter_HijackDelegates(t *testing.T) {
	rec := &hijackableRecorder{ResponseRecorder: httptest.NewRecorder()}
	rw := &responseWriter{ResponseWriter: rec, status: http.StatusOK}

	if _, _, err := rw.Hijack(); err != nil {
		t.Fatalf("Hijack() error = %v", err)
	}
	if !rec.hijacked {
		t.Error("Hijack() did not delegate to the underlying writer")
	}
}

func TestResponseWriter_HijackUnsupported(t *testing.T) {
	// httptest.ResponseRecorder does not implement http.Hijacker.
	rw := &responseWriter{ResponseWriter: httptest.NewRecorder(), status: http.StatusOK}
	if _, _, err := rw.Hijack(); err == nil {
		t.Error("Hijack() should error when the underlying writer is not a Hijacker")
	}
}

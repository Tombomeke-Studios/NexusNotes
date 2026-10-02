package ws

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// serveHub upgrades every request to a hub client, like the WS handler does.
func serveHub(t *testing.T, hub *Hub) string {
	t.Helper()
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		c := NewClient(hub, conn, "u1", "d1")
		hub.Register(c)
		go c.WritePump()
		go c.ReadPump()
	}))
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http")
}

func dial(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

// On shutdown every client gets a "going away" close frame and the hub
// empties within the deadline (#332).
func TestHubShutdownClosesClientsCleanly(t *testing.T) {
	hub := NewHub()
	url := serveHub(t, hub)
	a, b := dial(t, url), dial(t, url)
	deadline := time.Now().Add(2 * time.Second)
	for hub.clientCount() < 2 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := hub.Shutdown(ctx); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}
	if n := hub.clientCount(); n != 0 {
		t.Fatalf("%d clients left after shutdown", n)
	}
	for _, c := range []*websocket.Conn{a, b} {
		_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
		_, _, err := c.ReadMessage()
		if !websocket.IsCloseError(err, websocket.CloseGoingAway) {
			t.Fatalf("client read %v, want a going-away close frame", err)
		}
	}

	// A connection that arrives after shutdown is turned away.
	late := dial(t, url)
	_ = late.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, _, err := late.ReadMessage(); !websocket.IsCloseError(err, websocket.CloseGoingAway) {
		t.Fatalf("late client read %v, want a going-away close frame", err)
	}
}

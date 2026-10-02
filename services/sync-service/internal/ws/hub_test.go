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

// A client that does not drain its send buffer is disconnected rather than
// silently missing updates; it reconnects and resyncs (#388).
func TestHubEvictsASlowClient(t *testing.T) {
	hub := NewHub()
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	registered := make(chan *Client, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		c := NewClient(hub, conn, "u1", "slow")
		hub.Register(c) // no WritePump: nothing drains Send
		registered <- c
	}))
	t.Cleanup(srv.Close)
	dial(t, "ws"+strings.TrimPrefix(srv.URL, "http"))
	c := <-registered

	for i := 0; i < sendBufSize+1; i++ {
		hub.BroadcastToUser("u1", Message{Type: "note:updated", Payload: []byte(`{}`)}, nil)
	}
	if n := hub.clientCount(); n != 0 {
		t.Fatalf("%d clients registered, want the slow one evicted", n)
	}
	// Send is closed once the client has left the hub.
	for range c.Send {
	}
}

// Unregistering closes the client's Send channel, ending its WritePump.
func TestUnregisterClosesSend(t *testing.T) {
	hub := NewHub()
	c := &Client{Hub: hub, Send: make(chan []byte, 1), UserID: "u1", DeviceID: "d1"}
	hub.Register(c)
	hub.Unregister(c)
	if _, ok := <-c.Send; ok {
		t.Fatal("Send must be closed after Unregister")
	}
	hub.Unregister(c) // a second unregister must not panic on a closed channel
}

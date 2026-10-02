package ws

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/metrics"
)

type Message struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type Hub struct {
	mu      sync.RWMutex
	clients map[string]map[*Client]bool // userID -> set of clients
	// closing is set by Shutdown; later registrations are turned away.
	closing bool
}

func NewHub() *Hub {
	return &Hub{
		clients: make(map[string]map[*Client]bool),
	}
}

func (h *Hub) Register(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.closing {
		client.closeGoingAway()
		return
	}

	if h.clients[client.UserID] == nil {
		h.clients[client.UserID] = make(map[*Client]bool)
	}
	h.clients[client.UserID][client] = true
	metrics.WSConnections.Inc()
	slog.Info("ws client registered", "user_id", client.UserID, "device_id", client.DeviceID, "connections", len(h.clients[client.UserID]))
}

func (h *Hub) Unregister(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.removeLocked(client) {
		slog.Info("ws client unregistered", "user_id", client.UserID, "device_id", client.DeviceID)
	}
}

// removeLocked drops client from the hub and closes its Send channel, which
// ends its WritePump (#388). Only the call that actually removes it closes
// Send, so a later Unregister cannot close it twice. h.mu must be held.
func (h *Hub) removeLocked(client *Client) bool {
	clients, ok := h.clients[client.UserID]
	if !ok || !clients[client] {
		return false
	}
	delete(clients, client)
	if len(clients) == 0 {
		delete(h.clients, client.UserID)
	}
	metrics.WSConnections.Dec()
	close(client.Send)
	return true
}

// DisconnectUser force-closes every live connection of the user, e.g. after
// account deletion. Closing the connection makes the client's ReadPump exit,
// which handles the rest of its teardown.
func (h *Hub) DisconnectUser(userID string) {
	h.mu.Lock()
	var clients []*Client
	for client := range h.clients[userID] {
		clients = append(clients, client)
	}
	for _, client := range clients {
		h.removeLocked(client)
	}
	h.mu.Unlock()

	for _, client := range clients {
		_ = client.Conn.Close()
	}
	if len(clients) > 0 {
		slog.Info("ws disconnected all clients of user", "user_id", userID, "count", len(clients))
	}
}

// DisconnectDevice force-closes the live connections of one revoked device
// (#45). A best-effort "device:revoked" message goes out first so the client
// signs itself out — the JWT itself stays valid until expiry (per-device
// token revocation needs the refresh-token work, #49).
func (h *Hub) DisconnectDevice(userID, deviceID string) {
	revoked, _ := json.Marshal(Message{Type: "device:revoked", Payload: json.RawMessage("{}")})

	h.mu.Lock()
	var targets []*Client
	for client := range h.clients[userID] {
		if client.DeviceID == deviceID {
			targets = append(targets, client)
		}
	}
	for _, client := range targets {
		// Queue the notice before Send is closed: the WritePump still
		// delivers what is buffered, then sends the close frame.
		select {
		case client.Send <- revoked:
		default:
		}
		h.removeLocked(client)
	}
	h.mu.Unlock()

	for _, client := range targets {
		// Give the write pump a moment to flush the message, then close.
		go func(c *Client) {
			time.Sleep(200 * time.Millisecond)
			_ = c.Conn.Close()
		}(client)
	}
	if len(targets) > 0 {
		slog.Info("ws device revoked", "user_id", userID, "device_id", deviceID, "connections", len(targets))
	}
}

func (h *Hub) BroadcastToUser(userID string, msg Message, exclude *Client) {
	data, err := json.Marshal(msg)
	if err != nil {
		slog.Error("ws marshal broadcast message", "error", err)
		return
	}

	h.mu.RLock()
	var slow []*Client
	for client := range h.clients[userID] {
		if client == exclude {
			continue
		}
		select {
		case client.Send <- data:
		default:
			slow = append(slow, client)
		}
	}
	h.mu.RUnlock()

	// A client that cannot keep up would silently miss this update and stay
	// stale. Disconnect it instead: it reconnects and resyncs (#388).
	for _, client := range slow {
		slog.Warn("ws client too slow; disconnecting it", "user_id", client.UserID, "device_id", client.DeviceID)
		h.mu.Lock()
		h.removeLocked(client)
		h.mu.Unlock()
		if client.Conn != nil {
			_ = client.Conn.Close()
		}
	}
}

// clientCount returns the number of registered connections.
func (h *Hub) clientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	n := 0
	for _, clients := range h.clients {
		n += len(clients)
	}
	return n
}

// shutdownGrace is how long Shutdown waits for clients to answer the close
// frame before it closes their connections itself.
const shutdownGrace = time.Second

// Shutdown sends every connected client a "going away" close frame and turns
// away new connections (#332). Clients that complete the close handshake
// within shutdownGrace leave on their own; the rest are closed, and Shutdown
// returns once every ReadPump has unregistered or ctx ends. Hijacked
// WebSocket connections are not covered by http.Server.Shutdown.
func (h *Hub) Shutdown(ctx context.Context) error {
	h.mu.Lock()
	h.closing = true
	var all []*Client
	for _, clients := range h.clients {
		for c := range clients {
			all = append(all, c)
		}
	}
	h.mu.Unlock()

	for _, c := range all {
		c.closeGoingAway()
	}
	slog.Info("ws hub shutting down", "connections", len(all))

	graceCtx, cancel := context.WithTimeout(ctx, shutdownGrace)
	defer cancel()
	if h.waitEmpty(graceCtx) == nil {
		return nil
	}
	for _, c := range all {
		_ = c.Conn.Close()
	}
	return h.waitEmpty(ctx)
}

// waitEmpty polls until no client is registered or ctx ends.
func (h *Hub) waitEmpty(ctx context.Context) error {
	tick := time.NewTicker(20 * time.Millisecond)
	defer tick.Stop()
	for h.clientCount() > 0 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-tick.C:
		}
	}
	return nil
}

// closeGoingAway starts the close handshake with a 1001 frame. The client's
// reply ends its ReadPump, which unregisters it and closes the connection.
func (c *Client) closeGoingAway() {
	msg := websocket.FormatCloseMessage(websocket.CloseGoingAway, "server shutting down")
	if err := c.Conn.WriteControl(websocket.CloseMessage, msg, time.Now().Add(writeWait)); err != nil {
		_ = c.Conn.Close()
	}
}

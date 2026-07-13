package ws

import (
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/metrics"
)

type Message struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type Hub struct {
	mu      sync.RWMutex
	clients map[string]map[*Client]bool // userID -> set of clients
}

func NewHub() *Hub {
	return &Hub{
		clients: make(map[string]map[*Client]bool),
	}
}

func (h *Hub) Register(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

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

	if clients, ok := h.clients[client.UserID]; ok {
		if clients[client] {
			metrics.WSConnections.Dec()
		}
		delete(clients, client)
		if len(clients) == 0 {
			delete(h.clients, client.UserID)
		}
	}
	slog.Info("ws client unregistered", "user_id", client.UserID, "device_id", client.DeviceID)
}

// DisconnectUser force-closes every live connection of the user, e.g. after
// account deletion. Closing the connection makes the client's ReadPump exit,
// which handles the rest of its teardown.
func (h *Hub) DisconnectUser(userID string) {
	h.mu.Lock()
	clients := h.clients[userID]
	delete(h.clients, userID)
	h.mu.Unlock()

	// The map entries are gone, so the eventual Unregister from each ReadPump
	// can no longer decrement the gauge — do it here.
	metrics.WSConnections.Sub(float64(len(clients)))
	for client := range clients {
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
			delete(h.clients[userID], client)
			metrics.WSConnections.Dec()
		}
	}
	if len(h.clients[userID]) == 0 {
		delete(h.clients, userID)
	}
	h.mu.Unlock()

	for _, client := range targets {
		select {
		case client.Send <- revoked:
		default:
		}
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
	defer h.mu.RUnlock()

	for client := range h.clients[userID] {
		if client == exclude {
			continue
		}
		select {
		case client.Send <- data:
		default:
			slog.Warn("ws client send buffer full, dropping message", "user_id", client.UserID, "device_id", client.DeviceID)
		}
	}
}

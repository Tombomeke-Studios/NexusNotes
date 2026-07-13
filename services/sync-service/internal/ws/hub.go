package ws

import (
	"encoding/json"
	"log"
	"sync"
	"time"
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
	log.Printf("ws: client registered for user %s (total: %d)", client.UserID, len(h.clients[client.UserID]))
}

func (h *Hub) Unregister(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if clients, ok := h.clients[client.UserID]; ok {
		delete(clients, client)
		if len(clients) == 0 {
			delete(h.clients, client.UserID)
		}
	}
	log.Printf("ws: client unregistered for user %s", client.UserID)
}

// DisconnectUser force-closes every live connection of the user, e.g. after
// account deletion. Closing the connection makes the client's ReadPump exit,
// which handles the rest of its teardown.
func (h *Hub) DisconnectUser(userID string) {
	h.mu.Lock()
	clients := h.clients[userID]
	delete(h.clients, userID)
	h.mu.Unlock()

	for client := range clients {
		_ = client.Conn.Close()
	}
	if len(clients) > 0 {
		log.Printf("ws: disconnected %d client(s) for user %s", len(clients), userID)
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
		log.Printf("ws: revoked device %s for user %s (%d connection(s))", deviceID, userID, len(targets))
	}
}

func (h *Hub) BroadcastToUser(userID string, msg Message, exclude *Client) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("ws: marshal broadcast message: %v", err)
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
			log.Printf("ws: client send buffer full, dropping message")
		}
	}
}

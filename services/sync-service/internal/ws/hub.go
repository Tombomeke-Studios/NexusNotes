package ws

import (
	"encoding/json"
	"log"
	"sync"
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

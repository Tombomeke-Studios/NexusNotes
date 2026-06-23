package handler

import (
	"log"
	"net/http"

	"github.com/gorilla/websocket"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/service"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/ws"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type WSHandler struct {
	hub         *ws.Hub
	authService *service.AuthService
}

func NewWSHandler(hub *ws.Hub, authService *service.AuthService) *WSHandler {
	return &WSHandler{hub: hub, authService: authService}
}

func (h *WSHandler) HandleConnect(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}

	claims, err := h.authService.ValidateToken(token)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	deviceID := r.URL.Query().Get("device_id")

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws: upgrade error: %v", err)
		return
	}

	client := ws.NewClient(h.hub, conn, claims.UserID, deviceID)
	h.hub.Register(client)

	go client.WritePump()
	go client.ReadPump()
}

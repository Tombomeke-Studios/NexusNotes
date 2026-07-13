package handler

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/gorilla/websocket"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
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
	deviceRepo  *repository.DeviceRepo
}

func NewWSHandler(hub *ws.Hub, authService *service.AuthService, deviceRepo *repository.DeviceRepo) *WSHandler {
	return &WSHandler{hub: hub, authService: authService, deviceRepo: deviceRepo}
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

	// Register/refresh the device (#44): the client identifies itself with a
	// stable device id plus a human-readable name and platform. Done async so
	// a slow write never delays the upgrade.
	if deviceID != "" {
		name := r.URL.Query().Get("device_name")
		platform := r.URL.Query().Get("platform")
		go func() {
			if err := h.deviceRepo.Upsert(context.Background(), deviceID, claims.UserID, name, platform); err != nil {
				slog.Error("ws device upsert failed", "device_id", deviceID, "error", err)
			}
		}()
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Warn("ws upgrade error", "error", err)
		return
	}

	client := ws.NewClient(h.hub, conn, claims.UserID, deviceID)
	h.hub.Register(client)

	go client.WritePump()
	go client.ReadPump()
}

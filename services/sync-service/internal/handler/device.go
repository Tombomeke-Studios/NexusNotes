package handler

import (
	"net/http"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/ws"
)

// DeviceHandler exposes the user's registered sync devices (#44, #45).
type DeviceHandler struct {
	deviceRepo *repository.DeviceRepo
	hub        *ws.Hub
}

func NewDeviceHandler(deviceRepo *repository.DeviceRepo, hub *ws.Hub) *DeviceHandler {
	return &DeviceHandler{deviceRepo: deviceRepo, hub: hub}
}

// List returns the caller's devices, most recently seen first.
func (h *DeviceHandler) List(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())

	devices, err := h.deviceRepo.ListByUser(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list devices")
		return
	}
	if devices == nil {
		devices = []model.Device{}
	}
	writeJSON(w, http.StatusOK, devices)
}

// Revoke forgets a device and force-closes its live WebSocket connections.
// The delete is scoped to the caller, so foreign device ids are a 404.
func (h *DeviceHandler) Revoke(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	deviceID := r.PathValue("deviceId")

	removed, err := h.deviceRepo.Delete(r.Context(), userID, deviceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to revoke device")
		return
	}
	if !removed {
		writeError(w, http.StatusNotFound, "device not found")
		return
	}
	h.hub.DisconnectDevice(userID, deviceID)
	w.WriteHeader(http.StatusNoContent)
}

package handler

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/service"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/ws"
)

// deviceUpsertTimeout bounds the background device registration so a stuck
// database cannot pile up goroutines, one per connect.
const deviceUpsertTimeout = 5 * time.Second

type WSHandler struct {
	hub            *ws.Hub
	tickets        *service.WSTicketStore
	deviceRepo     *repository.DeviceRepo
	allowedOrigins []string
	upgrader       websocket.Upgrader
}

// NewWSHandler wires the WebSocket endpoint. allowedOrigins is the same list
// the CORS middleware uses; a browser handshake from any other origin (other
// than the server's own) is refused.
func NewWSHandler(hub *ws.Hub, tickets *service.WSTicketStore, deviceRepo *repository.DeviceRepo, allowedOrigins []string) *WSHandler {
	h := &WSHandler{
		hub:            hub,
		tickets:        tickets,
		deviceRepo:     deviceRepo,
		allowedOrigins: append([]string(nil), allowedOrigins...),
	}
	h.upgrader = websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			return originAllowed(r.Header.Get("Origin"), r.Host, h.allowedOrigins)
		},
	}
	return h
}

// originAllowed reports whether a WebSocket handshake from origin may proceed
// against a server reached as host. Browsers always send an Origin on a
// WebSocket upgrade, so an allowlist here blocks cross-site WebSocket
// hijacking; non-browser clients send none and authenticate by ticket alone.
// Matching is exact (scheme, host and port), never by prefix or suffix.
func originAllowed(origin, host string, allowed []string) bool {
	if origin == "" {
		return true
	}
	for _, a := range allowed {
		if strings.EqualFold(origin, a) {
			return true
		}
	}
	// Same-origin: a web build served by the same host (e.g. behind a reverse
	// proxy) dials back to where it came from.
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	return strings.EqualFold(u.Host, host)
}

// IssueTicket mints a short-lived, single-use WebSocket ticket for the
// authenticated caller (POST /api/ws/ticket, behind the auth middleware).
// The client redeems it on /ws?ticket=... so the access token itself never
// appears in a URL.
func (h *WSHandler) IssueTicket(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	ticket, err := h.tickets.Issue(userID)
	if errors.Is(err, service.ErrTooManyWSTickets) {
		w.Header().Set("Retry-After", strconv.Itoa(int(h.tickets.TTL()/time.Second)))
		writeError(w, http.StatusServiceUnavailable, "too many pending connections, retry shortly")
		return
	}
	if err != nil {
		slog.Error("ws ticket issue failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to issue ticket")
		return
	}

	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"ticket":     ticket,
		"expires_in": int(h.tickets.TTL() / time.Second),
	})
}

func (h *WSHandler) HandleConnect(w http.ResponseWriter, r *http.Request) {
	// The Origin is checked before the ticket is looked at, so a cross-site
	// page cannot burn a ticket it somehow obtained. The upgrader repeats the
	// same check as defence in depth.
	if !originAllowed(r.Header.Get("Origin"), r.Host, h.allowedOrigins) {
		writeError(w, http.StatusForbidden, "origin not allowed")
		return
	}

	// Only single-use tickets are accepted; the legacy ?token=<jwt> parameter
	// is ignored so long-lived credentials never travel in the URL (#258).
	userID, ok := h.tickets.Consume(r.URL.Query().Get("ticket"))
	if !ok {
		writeError(w, http.StatusUnauthorized, "invalid or expired ticket")
		return
	}

	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Warn("ws upgrade error", "error", err)
		return
	}

	deviceID := r.URL.Query().Get("device_id")

	// Register/refresh the device (#44): the client identifies itself with a
	// stable device id plus a human-readable name and platform. Done async so
	// a slow write never delays the session, but bounded so it cannot hang.
	// WithoutCancel keeps request-scoped values (request id) while outliving
	// the handler, which returns as soon as the pumps start.
	if deviceID != "" && h.deviceRepo != nil {
		name := r.URL.Query().Get("device_name")
		platform := r.URL.Query().Get("platform")
		ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), deviceUpsertTimeout)
		go func() {
			defer cancel()
			if err := h.deviceRepo.Upsert(ctx, deviceID, userID, name, platform); err != nil {
				slog.Error("ws device upsert failed", "device_id", deviceID, "error", err)
			}
		}()
	}

	client := ws.NewClient(h.hub, conn, userID, deviceID)
	h.hub.Register(client)

	go client.WritePump()
	go client.ReadPump()
}

package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/service"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/ws"
)

var testAllowedOrigins = []string{"http://localhost:1420", "tauri://localhost", "http://tauri.localhost"}

func newTestWS(tickets *service.WSTicketStore) *WSHandler {
	// No device repo: the tests never send a device_id, so it is never touched.
	return NewWSHandler(ws.NewHub(), tickets, nil, testAllowedOrigins)
}

func TestOriginAllowed(t *testing.T) {
	cases := []struct {
		name, origin, host string
		want               bool
	}{
		{"no Origin header (non-browser client)", "", "api.example.com", true},
		{"listed dev origin", "http://localhost:1420", "localhost:8080", true},
		{"listed tauri origin", "tauri://localhost", "localhost:8080", true},
		{"listed windows tauri origin", "http://tauri.localhost", "localhost:8080", true},
		{"same origin (proxied web build)", "https://notes.example.com", "notes.example.com", true},
		{"same origin on a non-default port (compose web UI on :3000)", "http://localhost:3000", "localhost:3000", true},
		// A proxy that forwards Host without its port (nginx $host) breaks
		// same-origin matching; desktop/nginx.conf must forward $http_host.
		{"proxy dropped the port from Host", "http://localhost:3000", "localhost", false},
		{"foreign site", "https://evil.example", "localhost:8080", false},
		{"lookalike of a listed origin", "http://localhost:1420.evil.example", "localhost:8080", false},
		{"different port is a different origin", "http://localhost:9999", "localhost:8080", false},
		{"unparseable origin", "://nonsense", "localhost:8080", false},
	}
	for _, c := range cases {
		if got := originAllowed(c.origin, c.host, testAllowedOrigins); got != c.want {
			t.Errorf("%s: originAllowed(%q, %q) = %v, want %v", c.name, c.origin, c.host, got, c.want)
		}
	}
}

func TestIssueTicket_ReturnsAConsumableTicketForTheCaller(t *testing.T) {
	tickets := service.NewWSTicketStore(30 * time.Second)
	h := newTestWS(tickets)

	req := httptest.NewRequest(http.MethodPost, "/api/ws/ticket", nil)
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, "user-42"))
	rec := httptest.NewRecorder()
	h.IssueTicket(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body struct {
		Ticket    string `json:"ticket"`
		ExpiresIn int    `json:"expires_in"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if body.Ticket == "" || body.ExpiresIn != 30 {
		t.Fatalf("body = %+v, want a ticket and expires_in 30", body)
	}
	if uid, ok := tickets.Consume(body.Ticket); !ok || uid != "user-42" {
		t.Fatalf("ticket does not belong to the caller: (%q, %v)", uid, ok)
	}
}

func TestIssueTicket_RefusesAnonymousCallers(t *testing.T) {
	h := newTestWS(service.NewWSTicketStore(time.Minute))
	rec := httptest.NewRecorder()
	h.IssueTicket(rec, httptest.NewRequest(http.MethodPost, "/api/ws/ticket", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 without an authenticated user", rec.Code)
	}
}

func TestHandleConnect_RejectsMissingAndUnknownTickets(t *testing.T) {
	h := newTestWS(service.NewWSTicketStore(time.Minute))
	for _, target := range []string{"/ws", "/ws?ticket=", "/ws?ticket=bogus"} {
		rec := httptest.NewRecorder()
		h.HandleConnect(rec, httptest.NewRequest(http.MethodGet, target, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s: status = %d, want 401", target, rec.Code)
		}
	}
}

func TestHandleConnect_IgnoresTheOldTokenQueryParameter(t *testing.T) {
	// The long-lived JWT must no longer be accepted in the URL.
	h := newTestWS(service.NewWSTicketStore(time.Minute))
	rec := httptest.NewRecorder()
	h.HandleConnect(rec, httptest.NewRequest(http.MethodGet, "/ws?token=some.jwt.value", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (only tickets are accepted)", rec.Code)
	}
}

func TestHandleConnect_ForeignOriginIsRejectedWithoutBurningTheTicket(t *testing.T) {
	tickets := service.NewWSTicketStore(time.Minute)
	h := newTestWS(tickets)
	ticket, _ := tickets.Issue("user-1")

	req := httptest.NewRequest(http.MethodGet, "/ws?ticket="+ticket, nil)
	req.Header.Set("Origin", "https://evil.example")
	rec := httptest.NewRecorder()
	h.HandleConnect(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for a foreign origin", rec.Code)
	}
	if _, ok := tickets.Consume(ticket); !ok {
		t.Fatal("a rejected foreign-origin request must not consume the ticket")
	}
}

func TestHandleConnect_HandshakeWithValidTicketThenReuseFails(t *testing.T) {
	tickets := service.NewWSTicketStore(time.Minute)
	srv := httptest.NewServer(http.HandlerFunc(newTestWS(tickets).HandleConnect))
	defer srv.Close()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?ticket="

	ticket, _ := tickets.Issue("user-1")
	hdr := http.Header{"Origin": []string{"http://localhost:1420"}}
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL+ticket, hdr)
	if err != nil {
		t.Fatalf("handshake with a valid ticket failed: %v", err)
	}
	_ = conn.Close()
	_ = resp.Body.Close()

	// The same ticket again must be refused.
	_, resp2, err := websocket.DefaultDialer.Dial(wsURL+ticket, hdr)
	if err == nil {
		t.Fatal("a reused ticket must not complete a handshake")
	}
	if resp2 == nil || resp2.StatusCode != http.StatusUnauthorized {
		t.Fatalf("reused ticket: response = %v, want 401", resp2)
	}
	_ = resp2.Body.Close()
}

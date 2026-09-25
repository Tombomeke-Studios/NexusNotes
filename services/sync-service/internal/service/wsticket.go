package service

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"sync"
	"time"
)

// DefaultWSTicketTTL is how long a WebSocket ticket stays redeemable. The
// client fetches one immediately before dialling, so a short window suffices.
const DefaultWSTicketTTL = 30 * time.Second

// defaultMaxWSTickets caps the number of live (unredeemed, unexpired)
// tickets so a flood of ticket requests cannot grow memory without bound.
const defaultMaxWSTickets = 10000

// ErrTooManyWSTickets is returned when the live-ticket cap is reached.
var ErrTooManyWSTickets = errors.New("too many outstanding websocket tickets")

type wsTicket struct {
	userID    string
	expiresAt time.Time
}

// WSTicketStore issues short-lived, single-use tickets that authenticate a
// WebSocket handshake (#258). Browsers cannot set an Authorization header on
// a WebSocket upgrade, so the credential has to travel in the URL; a ticket
// keeps the long-lived access token out of proxy and access logs, and one
// that leaks anyway is worthless once redeemed or expired. State is
// in-memory, matching the single-instance self-hosted deployment model.
type WSTicketStore struct {
	mu         sync.Mutex
	tickets    map[string]wsTicket
	ttl        time.Duration
	maxTickets int
	now        func() time.Time
}

// NewWSTicketStore returns a store whose tickets expire after ttl.
func NewWSTicketStore(ttl time.Duration) *WSTicketStore {
	return &WSTicketStore{
		tickets:    make(map[string]wsTicket),
		ttl:        ttl,
		maxTickets: defaultMaxWSTickets,
		now:        time.Now,
	}
}

// TTL reports how long an issued ticket remains redeemable.
func (s *WSTicketStore) TTL() time.Duration { return s.ttl }

// Issue mints a fresh ticket bound to userID. Expired tickets are swept
// first; ErrTooManyWSTickets is returned when the live cap is still reached.
func (s *WSTicketStore) Issue(userID string) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate websocket ticket: %w", err)
	}
	ticket := base64.RawURLEncoding.EncodeToString(raw)

	s.mu.Lock()
	defer s.mu.Unlock()

	now := s.now()
	s.sweep(now)
	if len(s.tickets) >= s.maxTickets {
		return "", ErrTooManyWSTickets
	}
	s.tickets[ticket] = wsTicket{userID: userID, expiresAt: now.Add(s.ttl)}
	return ticket, nil
}

// Consume redeems a ticket, returning the user it was issued to. A ticket is
// removed on its first redemption attempt, so it can never be used twice.
func (s *WSTicketStore) Consume(ticket string) (string, bool) {
	if ticket == "" {
		return "", false
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	t, ok := s.tickets[ticket]
	if !ok {
		return "", false
	}
	delete(s.tickets, ticket)
	if !s.now().Before(t.expiresAt) {
		return "", false
	}
	return t.userID, true
}

// sweep drops expired tickets. Callers must hold s.mu.
func (s *WSTicketStore) sweep(now time.Time) {
	for k, t := range s.tickets {
		if !now.Before(t.expiresAt) {
			delete(s.tickets, k)
		}
	}
}

// size reports the number of stored tickets (tests only).
func (s *WSTicketStore) size() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.tickets)
}

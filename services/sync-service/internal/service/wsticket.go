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
// With the per-user cap below it is only a backstop: reaching it takes
// thousands of distinct accounts.
const defaultMaxWSTickets = 10000

// defaultMaxWSTicketsPerUser caps one user's live tickets so a single
// account cannot fill the global store and lock everyone else out of sync.
// A well-behaved client holds one ticket at a time (it fetches right before
// dialling); a few extra cover several devices reconnecting at once.
const defaultMaxWSTicketsPerUser = 5

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
	byUser     map[string][]string // user id → live tickets, oldest first
	ttl        time.Duration
	maxTickets int
	maxPerUser int
	now        func() time.Time
}

// NewWSTicketStore returns a store whose tickets expire after ttl.
func NewWSTicketStore(ttl time.Duration) *WSTicketStore {
	return &WSTicketStore{
		tickets:    make(map[string]wsTicket),
		byUser:     make(map[string][]string),
		ttl:        ttl,
		maxTickets: defaultMaxWSTickets,
		maxPerUser: defaultMaxWSTicketsPerUser,
		now:        time.Now,
	}
}

// TTL reports how long an issued ticket remains redeemable.
func (s *WSTicketStore) TTL() time.Duration { return s.ttl }

// Issue mints a fresh ticket bound to userID. Expired tickets are swept
// first. When the user already holds the per-user maximum, their oldest
// ticket is evicted instead of refusing: a client only ever redeems its
// newest ticket, so eviction never breaks a well-behaved client, whereas
// refusing would let abandoned fetches (quick reconnects, a reload) lock the
// user out of sync until those tickets expire. ErrTooManyWSTickets is
// returned only when the global backstop cap is reached.
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

	owned := s.byUser[userID]
	for len(owned) >= s.maxPerUser && len(owned) > 0 {
		delete(s.tickets, owned[0])
		owned = owned[1:]
	}
	s.byUser[userID] = owned

	if len(s.tickets) >= s.maxTickets {
		return "", ErrTooManyWSTickets
	}
	s.tickets[ticket] = wsTicket{userID: userID, expiresAt: now.Add(s.ttl)}
	s.byUser[userID] = append(owned, ticket)
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
	s.forget(t.userID, ticket)
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
			s.forget(t.userID, k)
		}
	}
}

// forget removes ticket from its owner's index. Callers must hold s.mu.
func (s *WSTicketStore) forget(userID, ticket string) {
	owned := s.byUser[userID]
	for i, tk := range owned {
		if tk == ticket {
			owned = append(owned[:i], owned[i+1:]...)
			break
		}
	}
	if len(owned) == 0 {
		delete(s.byUser, userID)
		return
	}
	s.byUser[userID] = owned
}

// size reports the number of stored tickets (tests only).
func (s *WSTicketStore) size() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.tickets)
}

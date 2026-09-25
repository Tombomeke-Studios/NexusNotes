package service

import (
	"testing"
	"time"
)

func newTestTickets(ttl time.Duration) (*WSTicketStore, *time.Time) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	s := NewWSTicketStore(ttl)
	s.now = func() time.Time { return now }
	return s, &now
}

func TestWSTicket_IssuedTicketIsConsumableExactlyOnce(t *testing.T) {
	s, _ := newTestTickets(30 * time.Second)
	ticket, err := s.Issue("user-1")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if len(ticket) < 32 {
		t.Fatalf("ticket looks too short to be unguessable: %q", ticket)
	}

	uid, ok := s.Consume(ticket)
	if !ok || uid != "user-1" {
		t.Fatalf("first consume = (%q, %v), want (user-1, true)", uid, ok)
	}
	if _, ok := s.Consume(ticket); ok {
		t.Fatal("a ticket must be single use, but the second consume succeeded")
	}
}

func TestWSTicket_ExpiresAfterTTL(t *testing.T) {
	s, now := newTestTickets(30 * time.Second)
	ticket, _ := s.Issue("user-1")

	*now = now.Add(31 * time.Second)
	if _, ok := s.Consume(ticket); ok {
		t.Fatal("an expired ticket must not be accepted")
	}
}

func TestWSTicket_StillValidJustBeforeExpiry(t *testing.T) {
	s, now := newTestTickets(30 * time.Second)
	ticket, _ := s.Issue("user-1")

	*now = now.Add(29 * time.Second)
	if _, ok := s.Consume(ticket); !ok {
		t.Fatal("a ticket inside its TTL must be accepted")
	}
}

func TestWSTicket_RejectsUnknownAndEmptyTickets(t *testing.T) {
	s, _ := newTestTickets(time.Minute)
	for _, bad := range []string{"", "nope", "AAAA"} {
		if _, ok := s.Consume(bad); ok {
			t.Errorf("unknown ticket %q was accepted", bad)
		}
	}
}

func TestWSTicket_TicketsAreUniquePerIssue(t *testing.T) {
	s, _ := newTestTickets(time.Minute)
	seen := map[string]bool{}
	for i := 0; i < 200; i++ {
		tk, err := s.Issue("u")
		if err != nil {
			t.Fatalf("issue: %v", err)
		}
		if seen[tk] {
			t.Fatalf("duplicate ticket issued: %q", tk)
		}
		seen[tk] = true
	}
}

func TestWSTicket_ExpiredTicketsAreSweptSoTheStoreCannotGrowForever(t *testing.T) {
	s, now := newTestTickets(30 * time.Second)
	for i := 0; i < 50; i++ {
		_, _ = s.Issue("u")
	}
	*now = now.Add(time.Minute)
	_, _ = s.Issue("u") // issuing sweeps the expired ones

	if got := s.size(); got != 1 {
		t.Fatalf("store holds %d tickets after the sweep, want 1", got)
	}
}

func TestWSTicket_RefusesToIssueBeyondTheCap(t *testing.T) {
	s, _ := newTestTickets(time.Minute)
	s.maxTickets = 3
	for i := 0; i < 3; i++ {
		if _, err := s.Issue("u"); err != nil {
			t.Fatalf("issue %d: %v", i, err)
		}
	}
	if _, err := s.Issue("u"); err == nil {
		t.Fatal("expected an error once the live-ticket cap is reached")
	}
}

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

func TestWSTicket_PerUserCapEvictsThatUsersOldestTicket(t *testing.T) {
	s, _ := newTestTickets(time.Minute)
	s.maxPerUser = 3
	var issued []string
	for i := 0; i < 4; i++ {
		tk, err := s.Issue("u")
		if err != nil {
			t.Fatalf("issue %d: %v", i, err)
		}
		issued = append(issued, tk)
	}

	if got := s.size(); got != 3 {
		t.Fatalf("store holds %d tickets for one user, want the per-user cap 3", got)
	}
	if _, ok := s.Consume(issued[0]); ok {
		t.Fatal("the oldest ticket should have been evicted to make room")
	}
	for i, tk := range issued[1:] {
		if uid, ok := s.Consume(tk); !ok || uid != "u" {
			t.Fatalf("ticket %d should still be valid: (%q, %v)", i+1, uid, ok)
		}
	}
}

func TestWSTicket_PerUserEvictionDoesNotTouchOtherUsers(t *testing.T) {
	s, _ := newTestTickets(time.Minute)
	s.maxPerUser = 2
	other, _ := s.Issue("other")
	for i := 0; i < 5; i++ {
		_, _ = s.Issue("greedy")
	}
	if uid, ok := s.Consume(other); !ok || uid != "other" {
		t.Fatalf("another user's ticket was evicted: (%q, %v)", uid, ok)
	}
}

func TestWSTicket_OneUserCannotExhaustTheGlobalStore(t *testing.T) {
	// Regression: the global cap alone let one account mint maxTickets tickets
	// and lock every other user out of sync.
	s, _ := newTestTickets(time.Minute)
	s.maxTickets = 10
	for i := 0; i < 1000; i++ {
		if _, err := s.Issue("greedy"); err != nil {
			t.Fatalf("issue %d for the greedy user: %v", i, err)
		}
	}
	if got := s.size(); got > s.maxPerUser {
		t.Fatalf("one user holds %d tickets, want at most %d", got, s.maxPerUser)
	}
	if _, err := s.Issue("victim"); err != nil {
		t.Fatalf("another user could not get a ticket: %v", err)
	}
}

func TestWSTicket_GlobalCapIsABackstopAcrossUsers(t *testing.T) {
	s, _ := newTestTickets(time.Minute)
	s.maxTickets = 3
	for _, u := range []string{"a", "b", "c"} {
		if _, err := s.Issue(u); err != nil {
			t.Fatalf("issue for %s: %v", u, err)
		}
	}
	if _, err := s.Issue("d"); err == nil {
		t.Fatal("expected an error once the global cap is reached across users")
	}
}

func TestWSTicket_ConsumedAndExpiredTicketsFreeTheUsersSlots(t *testing.T) {
	s, now := newTestTickets(30 * time.Second)
	s.maxPerUser = 2
	a, _ := s.Issue("u")
	b, _ := s.Issue("u")
	_, _ = s.Consume(a)
	_, _ = s.Issue("u") // a's slot was freed, so b must survive this issue
	if _, ok := s.Consume(b); !ok {
		t.Fatal("a consumed ticket should have freed its slot, but b was evicted")
	}

	*now = now.Add(time.Minute) // the remaining ticket expires
	d, _ := s.Issue("u")
	e, _ := s.Issue("u")
	for _, tk := range []string{d, e} {
		if _, ok := s.Consume(tk); !ok {
			t.Fatal("an expired ticket should have freed its slot")
		}
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

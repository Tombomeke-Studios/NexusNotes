package service

import (
	"testing"
	"time"
)

func newTestThrottle() (*loginThrottle, *time.Time) {
	th := newLoginThrottle()
	now := time.Now()
	th.now = func() time.Time { return now }
	return th, &now
}

func failN(th *loginThrottle, n int, email, ip string) {
	for i := 0; i < n; i++ {
		th.recordFailure(email, ip)
	}
}

func TestThrottle_AllowsUnderThreshold(t *testing.T) {
	th, _ := newTestThrottle()
	failN(th, lockThreshold-1, "a@example.com", "10.0.0.1")
	if d, _ := th.check("a@example.com", "10.0.0.1"); d != 0 {
		t.Fatalf("locked for %v below the failure threshold", d)
	}
}

func TestThrottle_LocksAtThreshold(t *testing.T) {
	th, _ := newTestThrottle()
	failN(th, lockThreshold, "a@example.com", "10.0.0.1")
	if d, _ := th.check("a@example.com", "10.0.0.1"); d != baseLockPeriod {
		t.Fatalf("lock duration = %v, want %v", d, baseLockPeriod)
	}
}

func TestThrottle_LockDoublesAndCaps(t *testing.T) {
	th, _ := newTestThrottle()
	failN(th, lockThreshold+1, "a@example.com", "10.0.0.1")
	if d, _ := th.check("a@example.com", "10.0.0.1"); d != 2*baseLockPeriod {
		t.Fatalf("lock after one extra failure = %v, want %v", d, 2*baseLockPeriod)
	}

	failN(th, 10, "a@example.com", "10.0.0.1")
	if d, _ := th.check("a@example.com", "10.0.0.1"); d != maxLockPeriod {
		t.Fatalf("lock duration = %v, want cap %v", d, maxLockPeriod)
	}
}

func TestThrottle_UnlocksAfterWindow(t *testing.T) {
	th, now := newTestThrottle()
	failN(th, lockThreshold, "a@example.com", "10.0.0.1")
	*now = now.Add(baseLockPeriod + time.Second)
	if d, _ := th.check("a@example.com", "10.0.0.1"); d != 0 {
		t.Fatalf("still locked for %v after the lock window passed", d)
	}
}

func TestThrottle_ResetClearsFailures(t *testing.T) {
	th, _ := newTestThrottle()
	failN(th, lockThreshold, "a@example.com", "10.0.0.1")
	th.reset("a@example.com", "10.0.0.1")
	if d, tarpit := th.check("a@example.com", "10.0.0.1"); d != 0 || tarpit {
		t.Fatalf("lock=%v tarpit=%v after reset, want none", d, tarpit)
	}
}

func TestThrottle_AccountsAreIndependent(t *testing.T) {
	th, _ := newTestThrottle()
	failN(th, lockThreshold, "a@example.com", "10.0.0.1")
	if d, _ := th.check("b@example.com", "10.0.0.1"); d != 0 {
		t.Fatalf("unrelated account locked for %v", d)
	}
}

// The griefing fix (#181): an attacker hammering the victim's email from their
// own IP must not lock the victim out on the victim's IP.
func TestThrottle_LockIsPerIP(t *testing.T) {
	th, _ := newTestThrottle()
	failN(th, lockThreshold, "victim@example.com", "6.6.6.6")

	if d, _ := th.check("victim@example.com", "6.6.6.6"); d == 0 {
		t.Fatal("attacker IP should be locked")
	}
	if d, _ := th.check("victim@example.com", "10.0.0.1"); d != 0 {
		t.Fatalf("victim's own IP locked for %v — griefing not mitigated", d)
	}
}

// Distributed guessing across many IPs escalates to a tarpit delay instead of
// a hard lock, so the real owner can still sign in (slowly).
func TestThrottle_CrossIPFailuresTriggerTarpit(t *testing.T) {
	th, _ := newTestThrottle()
	for i := 0; i < tarpitThreshold; i++ {
		th.recordFailure("victim@example.com", string(rune('a'+i)))
	}

	d, tarpit := th.check("victim@example.com", "10.0.0.99")
	if d != 0 {
		t.Fatalf("fresh IP hard-locked for %v, want tarpit only", d)
	}
	if !tarpit {
		t.Fatal("expected tarpit after cross-IP failure threshold")
	}
}

func TestThrottle_TarpitClearsOnReset(t *testing.T) {
	th, _ := newTestThrottle()
	for i := 0; i < tarpitThreshold; i++ {
		th.recordFailure("victim@example.com", string(rune('a'+i)))
	}
	th.reset("victim@example.com", "10.0.0.1")
	if _, tarpit := th.check("victim@example.com", "10.0.0.2"); tarpit {
		t.Fatal("tarpit must clear after a successful login reset")
	}
}

func TestThrottle_PurgesStaleEntries(t *testing.T) {
	th, now := newTestThrottle()
	th.recordFailure("a@example.com", "10.0.0.1")
	th.recordFailure("b@example.com", "10.0.0.2")

	*now = now.Add(throttleStale + time.Second)
	th.recordFailure("c@example.com", "10.0.0.3")

	th.mu.Lock()
	n := len(th.entries) + len(th.emails)
	th.mu.Unlock()
	if n != 2 { // one compound entry + one email entry for c@
		t.Fatalf("got %d tracked entries after purge, want 2", n)
	}
}

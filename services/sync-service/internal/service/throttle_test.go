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

func TestThrottle_AllowsUnderThreshold(t *testing.T) {
	th, _ := newTestThrottle()
	for i := 0; i < lockThreshold-1; i++ {
		th.recordFailure("a@example.com")
	}
	if d := th.check("a@example.com"); d != 0 {
		t.Fatalf("locked for %v below the failure threshold", d)
	}
}

func TestThrottle_LocksAtThreshold(t *testing.T) {
	th, _ := newTestThrottle()
	for i := 0; i < lockThreshold; i++ {
		th.recordFailure("a@example.com")
	}
	if d := th.check("a@example.com"); d != baseLockPeriod {
		t.Fatalf("lock duration = %v, want %v", d, baseLockPeriod)
	}
}

func TestThrottle_LockDoublesAndCaps(t *testing.T) {
	th, _ := newTestThrottle()
	for i := 0; i < lockThreshold+1; i++ {
		th.recordFailure("a@example.com")
	}
	if d := th.check("a@example.com"); d != 2*baseLockPeriod {
		t.Fatalf("lock after one extra failure = %v, want %v", d, 2*baseLockPeriod)
	}

	for i := 0; i < 10; i++ {
		th.recordFailure("a@example.com")
	}
	if d := th.check("a@example.com"); d != maxLockPeriod {
		t.Fatalf("lock duration = %v, want cap %v", d, maxLockPeriod)
	}
}

func TestThrottle_UnlocksAfterWindow(t *testing.T) {
	th, now := newTestThrottle()
	for i := 0; i < lockThreshold; i++ {
		th.recordFailure("a@example.com")
	}
	*now = now.Add(baseLockPeriod + time.Second)
	if d := th.check("a@example.com"); d != 0 {
		t.Fatalf("still locked for %v after the lock window passed", d)
	}
}

func TestThrottle_ResetClearsFailures(t *testing.T) {
	th, _ := newTestThrottle()
	for i := 0; i < lockThreshold; i++ {
		th.recordFailure("a@example.com")
	}
	th.reset("a@example.com")
	if d := th.check("a@example.com"); d != 0 {
		t.Fatalf("locked for %v after reset", d)
	}
}

func TestThrottle_AccountsAreIndependent(t *testing.T) {
	th, _ := newTestThrottle()
	for i := 0; i < lockThreshold; i++ {
		th.recordFailure("a@example.com")
	}
	if d := th.check("b@example.com"); d != 0 {
		t.Fatalf("unrelated account locked for %v", d)
	}
}

func TestThrottle_PurgesStaleEntries(t *testing.T) {
	th, now := newTestThrottle()
	th.recordFailure("a@example.com")
	th.recordFailure("b@example.com")

	*now = now.Add(throttleStale + time.Second)
	th.recordFailure("c@example.com")

	th.mu.Lock()
	n := len(th.entries)
	th.mu.Unlock()
	if n != 1 {
		t.Fatalf("got %d tracked entries after purge, want 1", n)
	}
}

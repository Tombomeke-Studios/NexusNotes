package service

import (
	"sync"
	"time"
)

const (
	// lockThreshold is the number of consecutive failures before a lock.
	lockThreshold = 5
	// baseLockPeriod is the first lock duration; it doubles per further
	// failure up to maxLockPeriod.
	baseLockPeriod = time.Minute
	maxLockPeriod  = 15 * time.Minute
	// throttleStale is how long an idle entry is kept before being purged.
	throttleStale = time.Hour
)

type throttleEntry struct {
	failures    int
	lockedUntil time.Time
	lastEvent   time.Time
}

// loginThrottle tracks consecutive failed logins per account key and applies
// a progressively longer lock. Keys are tracked whether or not the account
// exists, so the lock response carries no enumeration signal. State is
// in-memory, matching the single-instance self-hosted deployment model.
type loginThrottle struct {
	mu      sync.Mutex
	entries map[string]*throttleEntry
	now     func() time.Time
}

func newLoginThrottle() *loginThrottle {
	return &loginThrottle{
		entries: make(map[string]*throttleEntry),
		now:     time.Now,
	}
}

// check returns how long the key remains locked; zero means allowed.
func (t *loginThrottle) check(key string) time.Duration {
	t.mu.Lock()
	defer t.mu.Unlock()

	e, ok := t.entries[key]
	if !ok {
		return 0
	}
	if remaining := e.lockedUntil.Sub(t.now()); remaining > 0 {
		return remaining
	}
	return 0
}

func (t *loginThrottle) recordFailure(key string) {
	t.mu.Lock()
	defer t.mu.Unlock()

	now := t.now()
	t.purge(now)

	e, ok := t.entries[key]
	if !ok {
		e = &throttleEntry{}
		t.entries[key] = e
	}
	e.failures++
	e.lastEvent = now

	if e.failures >= lockThreshold {
		lock := baseLockPeriod << (e.failures - lockThreshold)
		if lock > maxLockPeriod || lock <= 0 {
			lock = maxLockPeriod
		}
		e.lockedUntil = now.Add(lock)
	}
}

func (t *loginThrottle) reset(key string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.entries, key)
}

func (t *loginThrottle) purge(now time.Time) {
	for key, e := range t.entries {
		if now.Sub(e.lastEvent) > throttleStale {
			delete(t.entries, key)
		}
	}
}

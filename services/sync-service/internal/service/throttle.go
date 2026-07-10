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
	// tarpitThreshold is the number of failures for one email across all IPs
	// before every attempt on that email gets a constant delay. Distributed
	// guessing is slowed without letting an attacker hard-lock the real owner.
	tarpitThreshold = 15
	// tarpitDelay is that constant delay.
	tarpitDelay = time.Second
	// throttleStale is how long an idle entry is kept before being purged.
	throttleStale = time.Hour
)

type throttleEntry struct {
	failures    int
	lockedUntil time.Time
	lastEvent   time.Time
}

// loginThrottle tracks consecutive failed logins. Hard locks are keyed on
// email+IP so an attacker cannot lock the real owner out of their account
// (#181); a separate per-email counter escalates distributed cross-IP
// guessing to a tarpit delay. Keys are tracked whether or not the account
// exists, so responses carry no enumeration signal. State is in-memory,
// matching the single-instance self-hosted deployment model.
type loginThrottle struct {
	mu      sync.Mutex
	entries map[string]*throttleEntry // email|ip → hard-lock state
	emails  map[string]*throttleEntry // email → cross-IP failure count
	now     func() time.Time
}

func newLoginThrottle() *loginThrottle {
	return &loginThrottle{
		entries: make(map[string]*throttleEntry),
		emails:  make(map[string]*throttleEntry),
		now:     time.Now,
	}
}

func compoundKey(email, ip string) string { return email + "|" + ip }

// check returns how long this email+IP remains hard-locked (zero = allowed)
// and whether the email is in the cross-IP tarpit.
func (t *loginThrottle) check(email, ip string) (time.Duration, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()

	now := t.now()
	var locked time.Duration
	if e, ok := t.entries[compoundKey(email, ip)]; ok {
		if remaining := e.lockedUntil.Sub(now); remaining > 0 {
			locked = remaining
		}
	}
	tarpit := false
	if e, ok := t.emails[email]; ok {
		tarpit = e.failures >= tarpitThreshold
	}
	return locked, tarpit
}

func (t *loginThrottle) recordFailure(email, ip string) {
	t.mu.Lock()
	defer t.mu.Unlock()

	now := t.now()
	t.purge(now)

	key := compoundKey(email, ip)
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

	m, ok := t.emails[email]
	if !ok {
		m = &throttleEntry{}
		t.emails[email] = m
	}
	m.failures++
	m.lastEvent = now
}

// reset clears both the email+IP lock and the cross-IP counter: a successful
// login proves the caller owns the account.
func (t *loginThrottle) reset(email, ip string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.entries, compoundKey(email, ip))
	delete(t.emails, email)
}

func (t *loginThrottle) purge(now time.Time) {
	for key, e := range t.entries {
		if now.Sub(e.lastEvent) > throttleStale {
			delete(t.entries, key)
		}
	}
	for key, e := range t.emails {
		if now.Sub(e.lastEvent) > throttleStale {
			delete(t.emails, key)
		}
	}
}

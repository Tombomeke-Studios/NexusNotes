package repository

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func newRefreshFixture(t *testing.T) (*pgxpool.Pool, *RefreshRepo, string) {
	t.Helper()
	pool := newIsolatedDB(t)
	userID := uuid.NewString()
	if _, err := pool.Exec(context.Background(), `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'x')`, userID, userID+"@test"); err != nil {
		t.Fatal(err)
	}
	return pool, NewRefreshRepo(pool), userID
}

func countTokens(t *testing.T, pool *pgxpool.Pool, userID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM refresh_tokens WHERE user_id = $1`, userID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// Rotation must never burn the old token without storing the new one (#338).
func TestRefreshRotate_RollsBackWhenTheSuccessorCannotBeStored(t *testing.T) {
	pool, repo, userID := newRefreshFixture(t)
	ctx := context.Background()
	exp := time.Now().Add(time.Hour)
	if err := repo.Create(ctx, userID, "d1", "old-hash", exp); err != nil {
		t.Fatal(err)
	}
	if err := repo.Create(ctx, userID, "d1", "taken-hash", exp); err != nil {
		t.Fatal(err)
	}
	old, _ := repo.GetByHash(ctx, "old-hash")

	// token_hash is unique, so inserting "taken-hash" again fails mid-rotation.
	if err := repo.Rotate(ctx, old.ID, userID, "d1", "taken-hash", exp); err == nil {
		t.Fatal("rotation onto a taken hash must fail")
	}
	after, err := repo.GetByHash(ctx, "old-hash")
	if err != nil || after.UsedAt != nil {
		t.Fatalf("old token after a failed rotation: %+v, %v; want it still unused", after, err)
	}
	if n := countTokens(t, pool, userID); n != 2 {
		t.Fatalf("%d tokens, want the original 2", n)
	}
}

func TestRefreshRotate_SecondRotationOfTheSameTokenIsReuse(t *testing.T) {
	_, repo, userID := newRefreshFixture(t)
	ctx := context.Background()
	exp := time.Now().Add(time.Hour)
	if err := repo.Create(ctx, userID, "d1", "old-hash", exp); err != nil {
		t.Fatal(err)
	}
	old, _ := repo.GetByHash(ctx, "old-hash")

	if err := repo.Rotate(ctx, old.ID, userID, "d1", "new-1", exp); err != nil {
		t.Fatalf("first rotation: %v", err)
	}
	if err := repo.Rotate(ctx, old.ID, userID, "d1", "new-2", exp); !errors.Is(err, ErrRefreshTokenReused) {
		t.Fatalf("second rotation: err = %v, want ErrRefreshTokenReused", err)
	}
	if _, err := repo.GetByHash(ctx, "new-2"); !errors.Is(err, ErrRefreshTokenNotFound) {
		t.Fatal("a refused rotation must not store a successor")
	}
}

func TestRefreshRotate_ConcurrentRotationsHaveExactlyOneWinner(t *testing.T) {
	pool, repo, userID := newRefreshFixture(t)
	ctx := context.Background()
	exp := time.Now().Add(time.Hour)
	if err := repo.Create(ctx, userID, "d1", "old-hash", exp); err != nil {
		t.Fatal(err)
	}
	old, _ := repo.GetByHash(ctx, "old-hash")

	const racers = 8
	errs := make([]error, racers)
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			errs[i] = repo.Rotate(ctx, old.ID, userID, "d1", uuid.NewString(), exp)
		}(i)
	}
	close(start)
	wg.Wait()

	wins := 0
	for _, err := range errs {
		switch {
		case err == nil:
			wins++
		case errors.Is(err, ErrRefreshTokenReused):
		default:
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if wins != 1 {
		t.Fatalf("%d rotations won, want exactly 1", wins)
	}
	if n := countTokens(t, pool, userID); n != 2 {
		t.Fatalf("%d tokens, want the used original plus one successor", n)
	}
}

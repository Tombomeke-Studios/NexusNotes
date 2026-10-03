package repository

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

// The grace period's schedule lives on the user row (#289).
func TestUserRepo_DeletionSchedule(t *testing.T) {
	pool := newIsolatedDB(t)
	ctx := context.Background()
	repo := NewUserRepo(pool, testCipher(t))
	u := &model.User{ID: uuid.NewString(), Email: uuid.NewString() + "@example.com", PasswordHash: "x", DisplayName: "U"}
	if err := repo.Create(ctx, u); err != nil {
		t.Fatal(err)
	}
	got, _ := repo.GetByID(ctx, u.ID)
	if got.DeletionScheduledAt != nil {
		t.Fatal("a new user is scheduled for deletion")
	}
	soon := time.Now().UTC().Add(time.Hour).Truncate(time.Microsecond)
	if err := repo.SetDeletionScheduled(ctx, u.ID, &soon); err != nil {
		t.Fatal(err)
	}
	got, _ = repo.GetByEmail(ctx, u.Email)
	if got.DeletionScheduledAt == nil || !got.DeletionScheduledAt.Equal(soon) {
		t.Fatalf("scheduled = %v, want %v", got.DeletionScheduledAt, soon)
	}
	if due, _ := repo.DeletionDue(ctx, time.Now().UTC()); len(due) != 0 {
		t.Fatalf("due before its time: %v", due)
	}
	if due, _ := repo.DeletionDue(ctx, soon.Add(time.Second)); len(due) != 1 || due[0] != u.ID {
		t.Fatalf("due = %v", due)
	}
	if err := repo.SetDeletionScheduled(ctx, u.ID, nil); err != nil {
		t.Fatal(err)
	}
	if due, _ := repo.DeletionDue(ctx, soon.Add(time.Hour)); len(due) != 0 {
		t.Fatal("a cancelled deletion is still due")
	}
	if err := repo.SetDeletionScheduled(ctx, uuid.NewString(), nil); err != ErrUserNotFound {
		t.Fatalf("unknown user: %v", err)
	}

	// The token tables accept and consume links.
	tokens := NewDeletionCancelRepo(pool)
	if err := tokens.Create(ctx, u.ID, "hash1", time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if id, err := tokens.Consume(ctx, "hash1"); err != nil || id != u.ID {
		t.Fatalf("consume: %s %v", id, err)
	}
}

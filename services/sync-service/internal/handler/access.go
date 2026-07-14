package handler

import (
	"context"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
)

// canRead reports whether the user may read a vault (owner or any member).
func canRead(ctx context.Context, vaultRepo *repository.VaultRepo, vaultID, userID string) bool {
	role, err := vaultRepo.AccessRole(ctx, vaultID, userID)
	return err == nil && role != ""
}

// canWrite reports whether the user may modify a vault's notes (owner or editor).
func canWrite(ctx context.Context, vaultRepo *repository.VaultRepo, vaultID, userID string) bool {
	role, err := vaultRepo.AccessRole(ctx, vaultID, userID)
	return err == nil && (role == model.VaultRoleOwner || role == model.VaultRoleEditor)
}

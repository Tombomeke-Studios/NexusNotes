package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

// DeviceRepo persists the sync devices registered to a user (#44).
type DeviceRepo struct {
	pool *pgxpool.Pool
}

func NewDeviceRepo(pool *pgxpool.Pool) *DeviceRepo {
	return &DeviceRepo{pool: pool}
}

// Upsert registers a device (id is the client-generated device id) or, when
// it already exists, refreshes its last-seen time and descriptive fields.
func (r *DeviceRepo) Upsert(ctx context.Context, id, userID, name, platform string) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO devices (id, user_id, name, platform, last_seen)
		 VALUES ($1, $2, $3, $4, now())
		 ON CONFLICT (id) DO UPDATE
		 SET last_seen = now(), name = EXCLUDED.name, platform = EXCLUDED.platform
		 WHERE devices.user_id = EXCLUDED.user_id`,
		id, userID, name, platform,
	)
	if err != nil {
		return fmt.Errorf("upsert device: %w", err)
	}
	return nil
}

// ListByUser returns the user's devices, most recently seen first.
func (r *DeviceRepo) ListByUser(ctx context.Context, userID string) ([]model.Device, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, user_id, name, platform, last_seen, created_at
		 FROM devices WHERE user_id = $1 ORDER BY last_seen DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list devices: %w", err)
	}
	defer rows.Close()

	var devices []model.Device
	for rows.Next() {
		var d model.Device
		if err := rows.Scan(&d.ID, &d.UserID, &d.Name, &d.Platform, &d.LastSeen, &d.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan device: %w", err)
		}
		devices = append(devices, d)
	}
	return devices, rows.Err()
}

// Delete removes a device owned by the user; returns whether a row existed.
func (r *DeviceRepo) Delete(ctx context.Context, userID, deviceID string) (bool, error) {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM devices WHERE id = $1 AND user_id = $2`,
		deviceID, userID,
	)
	if err != nil {
		return false, fmt.Errorf("delete device: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// DeleteInactive removes devices not seen since the cutoff (#46) and returns
// how many were removed.
func (r *DeviceRepo) DeleteInactive(ctx context.Context, olderThan time.Duration) (int64, error) {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM devices WHERE last_seen < now() - $1::interval`,
		fmt.Sprintf("%d seconds", int64(olderThan.Seconds())),
	)
	if err != nil {
		return 0, fmt.Errorf("delete inactive devices: %w", err)
	}
	return tag.RowsAffected(), nil
}

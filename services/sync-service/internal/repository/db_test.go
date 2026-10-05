package repository

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestNewPool_AppliesOptions(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping database integration test")
	}
	opts := PoolOptions{MaxConns: 7, MinConns: 1, MaxConnLifetime: 45 * time.Minute, MaxConnIdleTime: 5 * time.Minute}
	pool, err := NewPool(context.Background(), url, opts)
	if err != nil {
		t.Skipf("database not reachable: %v", err)
	}
	defer pool.Close()
	cfg := pool.Config()
	if cfg.MaxConns != 7 || cfg.MinConns != 1 || cfg.MaxConnLifetime != 45*time.Minute || cfg.MaxConnIdleTime != 5*time.Minute {
		t.Fatalf("pool config = max %d min %d life %v idle %v", cfg.MaxConns, cfg.MinConns, cfg.MaxConnLifetime, cfg.MaxConnIdleTime)
	}
}

func TestNewPool_ZeroOptionsKeepPgxDefaults(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping database integration test")
	}
	pool, err := NewPool(context.Background(), url, PoolOptions{})
	if err != nil {
		t.Skipf("database not reachable: %v", err)
	}
	defer pool.Close()
	if pool.Config().MaxConns < 4 {
		t.Fatalf("MaxConns = %d, want pgx's default (at least 4)", pool.Config().MaxConns)
	}
}

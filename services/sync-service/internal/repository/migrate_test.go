package repository

import (
	"context"
	"sync"
	"testing"
)

// Two processes migrating the same database at once (parallel test packages,
// two server instances) must not both apply a migration (#368).
func TestRunMigrations_ConcurrentRunsApplyEachMigrationOnce(t *testing.T) {
	pool := newIsolatedDB(t) // already migrated once; start from scratch below
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `
		DO $$ DECLARE r record; BEGIN
		  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = current_schema() LOOP
		    EXECUTE 'DROP TABLE ' || quote_ident(r.tablename) || ' CASCADE';
		  END LOOP;
		END $$`); err != nil {
		t.Fatal(err)
	}

	const runners = 4
	errs := make(chan error, runners)
	var wg sync.WaitGroup
	for i := 0; i < runners; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- RunMigrations(ctx, pool, "../../migrations")
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent RunMigrations: %v", err)
		}
	}
	var applied, files int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM schema_migrations`).Scan(&applied); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(DISTINCT version) FROM schema_migrations`).Scan(&files); err != nil {
		t.Fatal(err)
	}
	if applied != files || applied == 0 {
		t.Fatalf("schema_migrations has %d rows for %d migrations", applied, files)
	}
}

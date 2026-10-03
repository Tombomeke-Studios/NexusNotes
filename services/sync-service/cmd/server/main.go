package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/rs/cors"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/buildinfo"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/config"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/handler"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/mail"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/search"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/service"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/storage"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/ws"
)

func main() {
	// Structured JSON logging (#56); every request line carries a correlation id.
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	cfg, err := config.Load()
	if err != nil {
		slog.Error("load config", "error", err)
		os.Exit(1)
	}

	ctx := context.Background()
	pool, err := repository.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("connect database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := repository.RunMigrations(ctx, pool, "migrations"); err != nil {
		slog.Error("run migrations", "error", err)
		os.Exit(1)
	}

	// User data is encrypted at rest under the server's data key (#352).
	crypt, err := fieldcrypt.New(cfg.DataEncryptionKey, cfg.DataEncryptionOldKeys)
	if err != nil {
		slog.Error("data encryption key", "error", err)
		os.Exit(1)
	}
	// Encrypt rows from before encryption at rest, or under a retired key, in
	// the background (#357): reads already handle both, so serving need not wait.
	go func() {
		n, err := repository.BackfillEncryption(ctx, pool, crypt, 500)
		if err != nil {
			slog.Error("encryption backfill", "error", err, "rewritten", n)
			return
		}
		if n > 0 {
			slog.Info("encryption backfill done", "rewritten", n)
		}
	}()

	userRepo := repository.NewUserRepo(pool, crypt)
	vaultRepo := repository.NewVaultRepo(pool, crypt)
	noteRepo := repository.NewNoteRepo(pool, crypt)
	linkRepo := repository.NewLinkRepo(pool)
	tagRepo := repository.NewTagRepo(pool)
	aliasRepo := repository.NewAliasRepo(pool)

	attachStore, err := storage.New(ctx, storage.Config{
		Endpoint:  cfg.MinIOEndpoint,
		AccessKey: cfg.MinIOAccessKey,
		SecretKey: cfg.MinIOSecretKey,
		Bucket:    cfg.MinIOBucket,
		UseSSL:    cfg.MinIOUseSSL,
	}, crypt)
	if err != nil {
		slog.Warn("object storage unavailable; attachments disabled", "error", err)
	}
	if attachStore != nil {
		// Seal files stored before encryption at rest (or under a retired key).
		go func() {
			n, err := attachStore.EncryptExisting(ctx)
			if err != nil {
				slog.Error("attachment encryption backfill", "error", err, "rewritten", n)
				return
			}
			if n > 0 {
				slog.Info("attachment encryption backfill done", "rewritten", n)
			}
		}()
	}

	indexer := search.NewIndexer(cfg.MeiliURL, cfg.MeiliMasterKey)
	if err := indexer.ConfigureIndex(ctx); err != nil {
		slog.Warn("meilisearch index configuration failed; search may be degraded", "error", err)
	}

	authService := service.NewAuthService(userRepo, cfg.JWTSecret)
	refreshRepo := repository.NewRefreshRepo(pool)
	authService.SetRefreshStore(refreshRepo)

	mailer := mail.New(mail.SMTPConfig{
		Host: cfg.SMTPHost, Port: cfg.SMTPPort,
		User: cfg.SMTPUser, Pass: cfg.SMTPPass, From: cfg.SMTPFrom,
	})
	verifyRepo := repository.NewEmailVerificationRepo(pool)
	deletionCancelRepo := repository.NewDeletionCancelRepo(pool)
	deletionRequestRepo := repository.NewDeletionRequestRepo(pool)
	resetRepo := repository.NewPasswordResetRepo(pool)
	emailAuth := service.NewEmailAuthService(userRepo, verifyRepo, resetRepo, refreshRepo, mailer, cfg.AppBaseURL)
	linkedFileRepo := repository.NewLinkedFileRepo(pool, crypt)
	syncService := service.NewSyncService(noteRepo, vaultRepo, linkRepo, tagRepo, aliasRepo, linkedFileRepo, indexer)
	// Search data is derived: an empty index (new volume, restore without it)
	// is refilled from the database in the background (#365).
	go func() {
		if _, err := syncService.RebuildSearchIndexIfEmpty(ctx); err != nil {
			slog.Warn("search index rebuild", "error", err)
		}
	}()

	hub := ws.NewHub()
	accountService := service.NewAccountService(userRepo, vaultRepo, noteRepo, indexer, hub)
	deviceRepo := repository.NewDeviceRepo(pool, crypt)
	memberRepo := repository.NewVaultMemberRepo(pool, crypt)

	// Daily cleanup (#46): forget devices that haven't been seen in 90 days.
	go func() {
		const retention = 90 * 24 * time.Hour
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for {
			if n, err := deviceRepo.DeleteInactive(context.Background(), retention); err != nil {
				slog.Error("device cleanup failed", "error", err)
			} else if n > 0 {
				slog.Info("device cleanup removed inactive devices", "count", n)
			}
			if n, err := refreshRepo.DeleteExpired(context.Background()); err != nil {
				slog.Error("refresh token cleanup failed", "error", err)
			} else if n > 0 {
				slog.Info("refresh token cleanup removed expired tokens", "count", n)
			}
			if _, err := verifyRepo.DeleteExpired(context.Background()); err != nil {
				slog.Error("verification token cleanup failed", "error", err)
			}
			// Versions past their vault's retention (#418); age limits are
			// otherwise only applied when a note is saved.
			if n, err := noteRepo.PruneVersions(context.Background(), ""); err != nil {
				slog.Error("version history cleanup failed", "error", err)
			} else if n > 0 {
				slog.Info("version history cleanup removed old versions", "count", n)
			}
			for _, r := range []*repository.AuthTokenRepo{deletionCancelRepo, deletionRequestRepo} {
				if _, err := r.DeleteExpired(context.Background()); err != nil {
					slog.Error("deletion token cleanup failed", "error", err)
				}
			}
			if _, err := resetRepo.DeleteExpired(context.Background()); err != nil {
				slog.Error("reset token cleanup failed", "error", err)
			}
			<-ticker.C
		}
	}()

	authHandler := handler.NewAuthHandler(authService, accountService, emailAuth, userRepo)
	// Account deletion with a 7-day grace period (#289).
	deletionService := service.NewAccountDeletionService(userRepo, accountService,
		deletionCancelRepo, deletionRequestRepo,
		refreshRepo, hub, mailer, cfg.AppBaseURL)
	deletionHandler := handler.NewDeletionHandler(deletionService)
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			if n, err := deletionService.PurgeDue(context.Background()); err != nil {
				slog.Error("account deletion purge failed", "error", err)
			} else if n > 0 {
				slog.Info("erased accounts after their grace period", "count", n)
			}
			<-ticker.C
		}
	}()
	vaultHandler := handler.NewVaultHandler(vaultRepo, userRepo, memberRepo, mailer.Enabled())
	noteHandler := handler.NewNoteHandler(syncService, vaultRepo, memberRepo, hub)
	memberHandler := handler.NewMemberHandler(vaultRepo, memberRepo, userRepo)
	attachHandler := handler.NewAttachmentHandler(attachStore, repository.NewAttachmentRepo(pool), vaultRepo, syncService)
	// Deleting an account, vault or note also erases its attachment files (#290).
	// Wired only when object storage is up: a nil *storage.Store inside the
	// interface would not be nil.
	if attachStore != nil {
		// Remove files no attachment row refers to (#316): at start-up, then daily.
		sweeper := service.NewOrphanSweeper(attachStore, repository.NewAttachmentRepo(pool))
		go func() {
			ticker := time.NewTicker(24 * time.Hour)
			defer ticker.Stop()
			for {
				if _, err := sweeper.Sweep(context.Background()); err != nil {
					slog.Warn("orphan attachment sweep", "error", err)
				}
				<-ticker.C
			}
		}()
		files := service.NewFileCleanup(attachStore, repository.NewAttachmentRepo(pool))
		accountService.SetFileCleanup(files)
		vaultHandler.SetFileCleanup(files)
		noteHandler.SetFileCleanup(files)
	}
	tagHandler := handler.NewTagHandler(syncService, vaultRepo)
	searchHandler := handler.NewSearchHandler(indexer, vaultRepo, noteRepo)
	starHandler := handler.NewStarHandler(repository.NewStarRepo(pool), vaultRepo, syncService)
	linkHandler := handler.NewLinkedFileHandler(linkedFileRepo, vaultRepo, cfg.LinkedFilesAllowPrivate)
	deviceHandler := handler.NewDeviceHandler(deviceRepo, refreshRepo, hub)
	adminHandler := handler.NewAdminHandler(repository.NewStatsRepo(pool), cfg.AdminToken, time.Now())
	// One origin allowlist for both CORS and the WebSocket handshake (#258);
	// defaults in config.DefaultAllowedOrigins, override via CORS_ALLOWED_ORIGINS.
	wsTickets := service.NewWSTicketStore(service.DefaultWSTicketTTL)
	wsHandler := handler.NewWSHandler(hub, wsTickets, deviceRepo, cfg.AllowedOrigins)

	mux := http.NewServeMux()

	authLimiter := middleware.NewRateLimiter(cfg.AuthRateLimitPerMin, cfg.AuthRateLimitBurst)
	mux.Handle("POST /api/auth/register", authLimiter.Middleware(http.HandlerFunc(authHandler.Register)))
	mux.Handle("POST /api/auth/login", authLimiter.Middleware(http.HandlerFunc(authHandler.Login)))
	mux.Handle("POST /api/auth/refresh", authLimiter.Middleware(http.HandlerFunc(authHandler.Refresh)))
	mux.HandleFunc("POST /api/auth/logout", authHandler.Logout)
	mux.Handle("POST /api/auth/verify-email", authLimiter.Middleware(http.HandlerFunc(authHandler.VerifyEmail)))
	mux.Handle("POST /api/auth/forgot-password", authLimiter.Middleware(http.HandlerFunc(authHandler.ForgotPassword)))
	mux.Handle("POST /api/auth/reset-password", authLimiter.Middleware(http.HandlerFunc(authHandler.ResetPassword)))
	mux.Handle("POST /api/auth/request-deletion", authLimiter.Middleware(http.HandlerFunc(deletionHandler.Request)))
	mux.Handle("POST /api/auth/confirm-deletion", authLimiter.Middleware(http.HandlerFunc(deletionHandler.Confirm)))
	mux.Handle("POST /api/auth/cancel-deletion", authLimiter.Middleware(http.HandlerFunc(deletionHandler.CancelWithToken)))

	authMw := middleware.Auth(authService)

	protectedMux := http.NewServeMux()
	protectedMux.HandleFunc("GET /api/auth/me", authHandler.Me)
	protectedMux.HandleFunc("DELETE /api/auth/account", deletionHandler.Schedule)
	protectedMux.HandleFunc("POST /api/auth/account/keep", deletionHandler.Cancel)
	// Long transfers get their own deadlines instead of the server-wide 15 s
	// (#332): exports and attachments can be large, and the linked-file proxy
	// may itself wait up to 15 s for the source.
	longTransfer := middleware.Deadlines(2*time.Minute, 5*time.Minute)
	protectedMux.Handle("GET /api/auth/export", longTransfer(http.HandlerFunc(authHandler.ExportAccount)))
	protectedMux.HandleFunc("GET /api/vaults", vaultHandler.List)
	protectedMux.HandleFunc("POST /api/vaults", vaultHandler.Create)
	protectedMux.HandleFunc("GET /api/vaults/{id}", vaultHandler.Get)
	protectedMux.HandleFunc("PUT /api/vaults/{id}", vaultHandler.Update)
	protectedMux.HandleFunc("PUT /api/vaults/{id}/encryption", vaultHandler.UpdateEncryption)
	// Converting a standard vault to e2ee uploads every note at once (#361).
	protectedMux.Handle("POST /api/vaults/{id}/encryption/convert", longTransfer(http.HandlerFunc(noteHandler.ConvertVault)))
	protectedMux.HandleFunc("DELETE /api/vaults/{id}", vaultHandler.Delete)
	protectedMux.HandleFunc("GET /api/vaults/{id}/members", memberHandler.List)
	protectedMux.HandleFunc("POST /api/vaults/{id}/members", memberHandler.Invite)
	protectedMux.HandleFunc("PATCH /api/vaults/{id}/members/{userId}", memberHandler.UpdateRole)
	protectedMux.HandleFunc("DELETE /api/vaults/{id}/members/{userId}", memberHandler.Remove)

	protectedMux.HandleFunc("GET /api/vaults/{vaultId}/notes", noteHandler.List)
	protectedMux.HandleFunc("POST /api/vaults/{vaultId}/notes", noteHandler.Create)
	protectedMux.HandleFunc("GET /api/notes/{noteId}", noteHandler.Get)
	protectedMux.HandleFunc("PUT /api/notes/{noteId}", noteHandler.Update)
	protectedMux.HandleFunc("DELETE /api/vaults/{vaultId}/notes/{noteId}", noteHandler.Delete)
	protectedMux.HandleFunc("GET /api/notes/{noteId}/versions", noteHandler.Versions)
	protectedMux.HandleFunc("GET /api/notes/{noteId}/versions/{versionId}", noteHandler.Version)
	protectedMux.HandleFunc("POST /api/notes/{noteId}/versions/{versionId}/restore", noteHandler.RestoreVersion)
	protectedMux.HandleFunc("GET /api/vaults/{id}/history-settings", noteHandler.GetHistorySettings)
	protectedMux.HandleFunc("PUT /api/vaults/{id}/history-settings", noteHandler.PutHistorySettings)
	protectedMux.HandleFunc("GET /api/notes/{noteId}/backlinks", noteHandler.Backlinks)
	protectedMux.Handle("POST /api/notes/{noteId}/attachments", longTransfer(http.HandlerFunc(attachHandler.Upload)))
	protectedMux.HandleFunc("GET /api/notes/{noteId}/attachments", attachHandler.List)
	protectedMux.Handle("GET /api/attachments/{id}", longTransfer(http.HandlerFunc(attachHandler.Download)))
	protectedMux.HandleFunc("DELETE /api/attachments/{id}", attachHandler.Delete)
	protectedMux.HandleFunc("GET /api/vaults/{id}/links", linkHandler.List)
	protectedMux.HandleFunc("POST /api/vaults/{id}/links", linkHandler.Create)
	protectedMux.HandleFunc("DELETE /api/vaults/{id}/links/{linkId}", linkHandler.Delete)
	protectedMux.Handle("GET /api/links/{linkId}/content", middleware.Deadlines(15*time.Second, 45*time.Second)(http.HandlerFunc(linkHandler.Content)))
	protectedMux.Handle("POST /api/links/{linkId}/content", middleware.Deadlines(15*time.Second, 45*time.Second)(http.HandlerFunc(linkHandler.FetchContent)))
	protectedMux.HandleFunc("GET /api/links/{linkId}/annotation", linkHandler.GetAnnotation)
	protectedMux.HandleFunc("PUT /api/links/{linkId}/annotation", linkHandler.PutAnnotation)
	protectedMux.HandleFunc("GET /api/notes/starred", starHandler.List)
	protectedMux.HandleFunc("POST /api/notes/{noteId}/star", starHandler.Star)
	protectedMux.HandleFunc("DELETE /api/notes/{noteId}/star", starHandler.Unstar)
	protectedMux.HandleFunc("GET /api/devices", deviceHandler.List)
	protectedMux.HandleFunc("DELETE /api/devices/{deviceId}", deviceHandler.Revoke)
	protectedMux.HandleFunc("GET /api/vaults/{vaultId}/search", noteHandler.Search)
	protectedMux.HandleFunc("GET /api/vaults/{vaultId}/tags", tagHandler.ListVaultTags)
	protectedMux.HandleFunc("GET /api/search", searchHandler.Search)
	protectedMux.HandleFunc("POST /api/ws/ticket", wsHandler.IssueTicket)

	mux.Handle("/api/", authMw(protectedMux))
	mux.HandleFunc("/ws", wsHandler.HandleConnect)

	// Operator-only; guarded by its own static token, not user JWTs (#59).
	mux.HandleFunc("GET /api/admin/stats", adminHandler.Stats)

	mux.HandleFunc("GET /health", buildinfo.HealthHandler)
	// Readiness (#327): can the service reach its database? Redis is not
	// probed: the service does not use it.
	mux.HandleFunc("GET /ready", buildinfo.ReadyHandler(pool.Ping, 2*time.Second))

	c := cors.New(cors.Options{
		AllowedOrigins:   cfg.AllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		ExposedHeaders:   []string{"X-Next-Cursor"}, // the paged note list (#461)
		AllowCredentials: true,
	})

	server := &http.Server{
		// RealIP first, so logs, rate limits and the login throttle all see the
		// client behind a trusted reverse proxy (#373).
		Handler:      middleware.RealIP(cfg.TrustedProxies)(middleware.RequestID(middleware.Logging(middleware.Metrics(c.Handler(middleware.Compress(mux)))))),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// One listener per BIND_ADDR entry (every interface when unset); Shutdown
	// closes all of them.
	listeners, err := listenAll(cfg.ListenAddrs())
	if err != nil {
		slog.Error("listen", "error", err)
		os.Exit(1)
	}
	for _, ln := range listeners {
		go func() {
			slog.Info("sync service listening", "addr", ln.Addr().String())
			if err := server.Serve(ln); err != nil && err != http.ErrServerClosed {
				slog.Error("server error", "error", err)
				os.Exit(1)
			}
		}()
	}

	// Prometheus scrape endpoint (#57) on its own listener (METRICS_ADDR), so
	// it is never reachable through the public port (#327).
	var metricsServer *http.Server
	if cfg.MetricsAddr != "" {
		metricsMux := http.NewServeMux()
		metricsMux.Handle("GET /metrics", promhttp.Handler())
		metricsServer = &http.Server{Addr: cfg.MetricsAddr, Handler: metricsMux, ReadHeaderTimeout: 5 * time.Second}
		go func() {
			slog.Info("metrics listening", "addr", cfg.MetricsAddr)
			if err := metricsServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				slog.Error("metrics server error", "error", err)
				os.Exit(1)
			}
		}()
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Close WebSockets first (#332): http.Server.Shutdown does not track
	// hijacked connections, and clients should hear "going away" rather than
	// a dropped TCP connection.
	if err := hub.Shutdown(shutdownCtx); err != nil {
		slog.Warn("ws hub shutdown", "error", err)
	}
	if metricsServer != nil {
		_ = metricsServer.Shutdown(shutdownCtx)
	}
	if err := server.Shutdown(shutdownCtx); err != nil {
		slog.Error("shutdown error", "error", err)
		os.Exit(1)
	}
	// After the HTTP server: requests that were still running have queued
	// their index updates by now; let them reach Meilisearch (#401).
	if err := indexer.Close(shutdownCtx); err != nil {
		slog.Warn("search index queue not drained", "error", err)
	}
	slog.Info("server stopped")
}

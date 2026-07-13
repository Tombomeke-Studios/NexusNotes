package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rs/cors"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/config"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/handler"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/search"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/service"
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

	userRepo := repository.NewUserRepo(pool)
	vaultRepo := repository.NewVaultRepo(pool)
	noteRepo := repository.NewNoteRepo(pool)
	linkRepo := repository.NewLinkRepo(pool)
	tagRepo := repository.NewTagRepo(pool)
	aliasRepo := repository.NewAliasRepo(pool)

	indexer := search.NewIndexer(cfg.MeiliURL, cfg.MeiliMasterKey)
	if err := indexer.ConfigureIndex(ctx); err != nil {
		slog.Warn("meilisearch index configuration failed; search may be degraded", "error", err)
	}

	authService := service.NewAuthService(userRepo, cfg.JWTSecret)
	syncService := service.NewSyncService(noteRepo, vaultRepo, linkRepo, tagRepo, aliasRepo, indexer)

	hub := ws.NewHub()
	accountService := service.NewAccountService(userRepo, vaultRepo, noteRepo, indexer, hub)
	deviceRepo := repository.NewDeviceRepo(pool)

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
			<-ticker.C
		}
	}()

	authHandler := handler.NewAuthHandler(authService, accountService, userRepo)
	vaultHandler := handler.NewVaultHandler(vaultRepo)
	noteHandler := handler.NewNoteHandler(syncService, vaultRepo, hub)
	tagHandler := handler.NewTagHandler(syncService, vaultRepo)
	searchHandler := handler.NewSearchHandler(indexer, vaultRepo, noteRepo)
	starHandler := handler.NewStarHandler(repository.NewStarRepo(pool), vaultRepo, syncService)
	deviceHandler := handler.NewDeviceHandler(deviceRepo, hub)
	wsHandler := handler.NewWSHandler(hub, authService, deviceRepo)

	mux := http.NewServeMux()

	authLimiter := middleware.NewRateLimiter(cfg.AuthRateLimitPerMin, cfg.AuthRateLimitBurst)
	mux.Handle("POST /api/auth/register", authLimiter.Middleware(http.HandlerFunc(authHandler.Register)))
	mux.Handle("POST /api/auth/login", authLimiter.Middleware(http.HandlerFunc(authHandler.Login)))

	authMw := middleware.Auth(authService)

	protectedMux := http.NewServeMux()
	protectedMux.HandleFunc("GET /api/auth/me", authHandler.Me)
	protectedMux.HandleFunc("DELETE /api/auth/account", authHandler.DeleteAccount)
	protectedMux.HandleFunc("GET /api/auth/export", authHandler.ExportAccount)
	protectedMux.HandleFunc("GET /api/vaults", vaultHandler.List)
	protectedMux.HandleFunc("POST /api/vaults", vaultHandler.Create)
	protectedMux.HandleFunc("GET /api/vaults/{id}", vaultHandler.Get)
	protectedMux.HandleFunc("PUT /api/vaults/{id}", vaultHandler.Update)
	protectedMux.HandleFunc("PUT /api/vaults/{id}/encryption", vaultHandler.UpdateEncryption)
	protectedMux.HandleFunc("DELETE /api/vaults/{id}", vaultHandler.Delete)

	protectedMux.HandleFunc("GET /api/vaults/{vaultId}/notes", noteHandler.List)
	protectedMux.HandleFunc("POST /api/vaults/{vaultId}/notes", noteHandler.Create)
	protectedMux.HandleFunc("GET /api/notes/{noteId}", noteHandler.Get)
	protectedMux.HandleFunc("PUT /api/notes/{noteId}", noteHandler.Update)
	protectedMux.HandleFunc("DELETE /api/vaults/{vaultId}/notes/{noteId}", noteHandler.Delete)
	protectedMux.HandleFunc("GET /api/notes/{noteId}/versions", noteHandler.Versions)
	protectedMux.HandleFunc("GET /api/notes/{noteId}/backlinks", noteHandler.Backlinks)
	protectedMux.HandleFunc("GET /api/notes/starred", starHandler.List)
	protectedMux.HandleFunc("POST /api/notes/{noteId}/star", starHandler.Star)
	protectedMux.HandleFunc("DELETE /api/notes/{noteId}/star", starHandler.Unstar)
	protectedMux.HandleFunc("GET /api/devices", deviceHandler.List)
	protectedMux.HandleFunc("DELETE /api/devices/{deviceId}", deviceHandler.Revoke)
	protectedMux.HandleFunc("GET /api/vaults/{vaultId}/search", noteHandler.Search)
	protectedMux.HandleFunc("GET /api/vaults/{vaultId}/tags", tagHandler.ListVaultTags)
	protectedMux.HandleFunc("GET /api/search", searchHandler.Search)

	mux.Handle("/api/", authMw(protectedMux))
	mux.HandleFunc("/ws", wsHandler.HandleConnect)

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	c := cors.New(cors.Options{
		AllowedOrigins:   []string{"http://localhost:1420", "http://localhost:5173", "tauri://localhost"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
	})

	server := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      middleware.RequestID(middleware.Logging(c.Handler(mux))),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		slog.Info("sync service listening", "port", cfg.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		slog.Error("shutdown error", "error", err)
		os.Exit(1)
	}
	slog.Info("server stopped")
}

package main

import (
	"context"
	"fmt"
	"log"
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
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/service"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/ws"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	ctx := context.Background()
	pool, err := repository.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("connect database: %v", err)
	}
	defer pool.Close()

	if err := repository.RunMigrations(ctx, pool, "migrations"); err != nil {
		log.Fatalf("run migrations: %v", err)
	}

	userRepo := repository.NewUserRepo(pool)
	vaultRepo := repository.NewVaultRepo(pool)
	noteRepo := repository.NewNoteRepo(pool)

	authService := service.NewAuthService(userRepo, cfg.JWTSecret)
	syncService := service.NewSyncService(noteRepo, vaultRepo)

	hub := ws.NewHub()

	authHandler := handler.NewAuthHandler(authService, userRepo)
	vaultHandler := handler.NewVaultHandler(vaultRepo)
	noteHandler := handler.NewNoteHandler(syncService, vaultRepo, hub)
	wsHandler := handler.NewWSHandler(hub, authService)

	mux := http.NewServeMux()

	mux.HandleFunc("POST /api/auth/register", authHandler.Register)
	mux.HandleFunc("POST /api/auth/login", authHandler.Login)

	authMw := middleware.Auth(authService)

	protectedMux := http.NewServeMux()
	protectedMux.HandleFunc("GET /api/auth/me", authHandler.Me)
	protectedMux.HandleFunc("GET /api/vaults", vaultHandler.List)
	protectedMux.HandleFunc("POST /api/vaults", vaultHandler.Create)
	protectedMux.HandleFunc("GET /api/vaults/{id}", vaultHandler.Get)
	protectedMux.HandleFunc("PUT /api/vaults/{id}", vaultHandler.Update)
	protectedMux.HandleFunc("DELETE /api/vaults/{id}", vaultHandler.Delete)

	protectedMux.HandleFunc("GET /api/vaults/{vaultId}/notes", noteHandler.List)
	protectedMux.HandleFunc("POST /api/vaults/{vaultId}/notes", noteHandler.Create)
	protectedMux.HandleFunc("GET /api/notes/{noteId}", noteHandler.Get)
	protectedMux.HandleFunc("PUT /api/notes/{noteId}", noteHandler.Update)
	protectedMux.HandleFunc("DELETE /api/vaults/{vaultId}/notes/{noteId}", noteHandler.Delete)
	protectedMux.HandleFunc("GET /api/notes/{noteId}/versions", noteHandler.Versions)

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
		Handler:      middleware.Logging(c.Handler(mux)),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Printf("sync service listening on :%d", cfg.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("shutting down...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("shutdown error: %v", err)
	}
	log.Println("server stopped")
}

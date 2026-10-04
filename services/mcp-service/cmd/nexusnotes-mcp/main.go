// Command nexusnotes-mcp is the NexusNotes MCP server (#221). It serves the
// tools over stdio for a local AI client, or over Streamable HTTP with
// --http, and acts on the user's notes through the sync service with an MCP
// token from Settings > AI Access.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/Tombomeke-Studios/NexusNotes/services/mcp-service/internal/nexus"
	"github.com/Tombomeke-Studios/NexusNotes/services/mcp-service/internal/server"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "nexusnotes-mcp:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	fs := flag.NewFlagSet("nexusnotes-mcp", flag.ContinueOnError)
	api := fs.String("api", envOr("NEXUSNOTES_API_URL", "http://localhost:8080"), "sync service URL")
	token := fs.String("token", os.Getenv("NEXUSNOTES_TOKEN"), "MCP token (stdio mode); prefer the NEXUSNOTES_TOKEN variable")
	httpAddr := fs.String("http", os.Getenv("MCP_HTTP_ADDR"), "serve Streamable HTTP on this address (e.g. :8081) instead of stdio")
	if err := fs.Parse(args); err != nil {
		return err
	}
	base := strings.TrimRight(*api, "/")
	// Logs go to stderr: in stdio mode stdout carries the protocol.
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if *httpAddr != "" {
		return serveHTTP(ctx, *httpAddr, base)
	}
	if !strings.HasPrefix(*token, "nn_") {
		return errors.New("set NEXUSNOTES_TOKEN (or --token) to an MCP token from Settings > AI Access")
	}
	return server.New(nexus.NewClient(base, *token), time.Now).Run(ctx, &mcp.StdioTransport{})
}

// serveHTTP serves Streamable HTTP statelessly: every request carries its
// own Bearer token and gets a server acting as that token, so no session can
// borrow another client's token.
func serveHTTP(ctx context.Context, addr, base string) error {
	handler := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || !strings.HasPrefix(token, "nn_") {
			return nil // 400
		}
		return server.New(nexus.NewClient(base, token), time.Now)
	}, &mcp.StreamableHTTPOptions{Stateless: true})

	mux := http.NewServeMux()
	mux.Handle("/mcp", requireBearer(handler))
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	srv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	slog.Info("nexusnotes-mcp listening", "addr", addr, "api", base)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// requireBearer answers 401 without a token, as the MCP authorization spec
// expects, instead of the SDK's 400.
func requireBearer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer nn_") {
			w.Header().Set("WWW-Authenticate", `Bearer realm="nexusnotes"`)
			http.Error(w, `{"error":"an MCP token is required: Authorization: Bearer nn_..."}`, http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func envOr(name, def string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return def
}

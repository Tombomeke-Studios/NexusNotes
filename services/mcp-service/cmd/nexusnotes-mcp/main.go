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
	"net/url"
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
	origins := fs.String("allowed-origins", os.Getenv("MCP_ALLOWED_ORIGINS"),
		"comma-separated browser origins allowed to call the HTTP transport (requests without an Origin header always are)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	base := strings.TrimRight(*api, "/")
	// Logs go to stderr: in stdio mode stdout carries the protocol.
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if *httpAddr != "" {
		allowed, err := parseOrigins(*origins)
		if err != nil {
			return err
		}
		return serveHTTP(ctx, *httpAddr, base, allowed)
	}
	if !strings.HasPrefix(*token, "nn_") {
		return errors.New("set NEXUSNOTES_TOKEN (or --token) to an MCP token from Settings > AI Access")
	}
	return server.New(nexus.NewClient(base, *token), time.Now).Run(ctx, &mcp.StdioTransport{})
}

// serveHTTP serves Streamable HTTP statelessly: every request carries its
// own Bearer token and gets a server acting as that token, so no session can
// borrow another client's token.
func serveHTTP(ctx context.Context, addr, base string, allowedOrigins map[string]bool) error {
	srv := &http.Server{Addr: addr, Handler: newHTTPHandler(base, allowedOrigins), ReadHeaderTimeout: 10 * time.Second}
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

// newHTTPHandler routes /mcp (Origin check, then token check, then the MCP
// handler) and /health.
func newHTTPHandler(base string, allowedOrigins map[string]bool) http.Handler {
	handler := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || !strings.HasPrefix(token, "nn_") {
			return nil // 400
		}
		return server.New(nexus.NewClient(base, token), time.Now)
	}, &mcp.StreamableHTTPOptions{Stateless: true})

	mux := http.NewServeMux()
	mux.Handle("/mcp", checkOrigin(allowedOrigins, requireBearer(handler)))
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	return mux
}

// checkOrigin validates the Origin header, as the MCP Streamable HTTP
// transport asks of servers (#556). AI clients that are not browsers send no
// Origin and pass; a browser page passes only from an allowlisted origin and
// is answered 403 otherwise.
func checkOrigin(allowed map[string]bool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" && !allowed[normaliseOrigin(origin)] {
			http.Error(w, `{"error":"origin not allowed"}`, http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// normaliseOrigin lowercases an origin and drops a trailing slash, so
// "https://Notes.example.com/" matches "https://notes.example.com".
func normaliseOrigin(origin string) string {
	return strings.ToLower(strings.TrimRight(strings.TrimSpace(origin), "/"))
}

// parseOrigins reads the comma-separated allowlist. Each entry must be a bare
// origin (scheme://host[:port]); "*" is refused, as it would undo the check.
func parseOrigins(list string) (map[string]bool, error) {
	allowed := map[string]bool{}
	for _, part := range strings.Split(list, ",") {
		origin := normaliseOrigin(part)
		if origin == "" {
			continue
		}
		u, err := url.Parse(origin)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.Path != "" || u.RawQuery != "" {
			return nil, fmt.Errorf("MCP_ALLOWED_ORIGINS: %q is not an origin like https://notes.example.com", strings.TrimSpace(part))
		}
		allowed[origin] = true
	}
	return allowed, nil
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

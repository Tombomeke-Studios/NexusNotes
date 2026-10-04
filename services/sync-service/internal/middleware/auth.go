package middleware

import (
	"context"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/service"
)

type contextKey string

const (
	UserIDKey   contextKey = "user_id"
	mcpTokenKey contextKey = "mcp_token"
)

// MCPAuthenticator resolves MCP API tokens and records their use (#221).
type MCPAuthenticator interface {
	Authenticate(ctx context.Context, raw string) (*model.MCPToken, error)
	Record(ctx context.Context, tokenID, tool, summary string) error
}

// MCPAccess is what an MCP token may reach. Its requests never go to the
// full API: they are served by a mux holding only the routes its scope
// allows, so account, token and sharing endpoints stay out of reach.
type MCPAccess struct {
	Auth    MCPAuthenticator
	Read    *http.ServeMux // routes for the read scope
	Write   *http.ServeMux // routes for the read-write scope
	Limiter *RateLimiter   // per token
}

// mcpToolName is the tool an MCP client says it is running (X-MCP-Tool), for
// the audit log; anything else is logged as "api".
var mcpToolName = regexp.MustCompile(`^[a-z][a-z0-9_]{0,39}$`)

// Auth accepts a JWT; with mcp set it also accepts MCP API tokens.
func Auth(authService *service.AuthService, mcp ...MCPAccess) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			if header == "" {
				http.Error(w, `{"error":"missing authorization header"}`, http.StatusUnauthorized)
				return
			}

			parts := strings.SplitN(header, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
				http.Error(w, `{"error":"invalid authorization format"}`, http.StatusUnauthorized)
				return
			}

			if strings.HasPrefix(parts[1], service.MCPTokenPrefix) {
				if len(mcp) == 0 {
					http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
					return
				}
				serveMCP(w, r, mcp[0], parts[1])
				return
			}

			claims, err := authService.ValidateToken(parts[1])
			if err != nil {
				http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), UserIDKey, claims.UserID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func serveMCP(w http.ResponseWriter, r *http.Request, access MCPAccess, raw string) {
	token, err := access.Auth.Authenticate(r.Context(), raw)
	if err != nil {
		slog.Error("mcp token lookup failed", "error", err)
		http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
		return
	}
	if token == nil {
		http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
		return
	}
	if access.Limiter != nil {
		if ok, retryAfter := access.Limiter.Allow(token.ID); !ok {
			w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
			http.Error(w, `{"error":"too many requests"}`, http.StatusTooManyRequests)
			return
		}
	}
	routes := access.Read
	if token.Scope == model.MCPScopeReadWrite {
		routes = access.Write
	}
	if _, pattern := routes.Handler(r); pattern == "" {
		http.Error(w, `{"error":"not available to this MCP token"}`, http.StatusForbidden)
		return
	}
	tool := r.Header.Get("X-MCP-Tool")
	if !mcpToolName.MatchString(tool) {
		tool = "api"
	}
	// Identifiers only: the path, never the query (search terms) or body.
	if err := access.Auth.Record(r.Context(), token.ID, tool, r.Method+" "+r.URL.Path); err != nil {
		slog.Error("mcp audit entry failed", "error", err)
		http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
		return
	}
	ctx := context.WithValue(r.Context(), UserIDKey, token.UserID)
	ctx = context.WithValue(ctx, mcpTokenKey, token)
	routes.ServeHTTP(w, r.WithContext(ctx))
}

// MCPTokenFrom returns the MCP token a request was made with, or nil for a
// signed-in user.
func MCPTokenFrom(ctx context.Context) *model.MCPToken {
	t, _ := ctx.Value(mcpTokenKey).(*model.MCPToken)
	return t
}

func GetUserID(ctx context.Context) string {
	if id, ok := ctx.Value(UserIDKey).(string); ok {
		return id
	}
	return ""
}

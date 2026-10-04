package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
)

// MCPTokenPrefix marks an MCP API token, so the auth middleware can tell it
// from a JWT without trying to parse it as one.
const MCPTokenPrefix = "nn_"

// MaxMCPTokensPerUser bounds how many tokens one account may hold.
const MaxMCPTokensPerUser = 20

const maxMCPTokenNameLen = 64

var (
	ErrMCPTokenName  = errors.New("token name must be 1-64 characters")
	ErrMCPTokenScope = errors.New(`scope must be "read" or "read-write"`)
	ErrMCPTokenLimit = errors.New("too many tokens; revoke one first")
)

// MCPTokenService issues and checks the API tokens AI clients use over MCP
// (#221). A token is 32 random bytes; only its SHA-256 is stored, which is
// enough for a value with that much entropy and lets it be looked up directly.
type MCPTokenService struct {
	repo *repository.MCPTokenRepo
}

func NewMCPTokenService(repo *repository.MCPTokenRepo) *MCPTokenService {
	return &MCPTokenService{repo: repo}
}

// Create issues a token for the user and returns it with its secret value,
// which is never shown again.
func (s *MCPTokenService) Create(ctx context.Context, userID, name, scope string) (*model.MCPToken, string, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > maxMCPTokenNameLen {
		return nil, "", ErrMCPTokenName
	}
	if scope != model.MCPScopeRead && scope != model.MCPScopeReadWrite {
		return nil, "", ErrMCPTokenScope
	}
	n, err := s.repo.CountByUser(ctx, userID)
	if err != nil {
		return nil, "", err
	}
	if n >= MaxMCPTokensPerUser {
		return nil, "", ErrMCPTokenLimit
	}
	secret, err := newMCPTokenValue()
	if err != nil {
		return nil, "", err
	}
	t := &model.MCPToken{UserID: userID, Name: name, Scope: scope}
	if err := s.repo.Create(ctx, t, HashMCPToken(secret)); err != nil {
		return nil, "", err
	}
	return t, secret, nil
}

func (s *MCPTokenService) List(ctx context.Context, userID string) ([]model.MCPToken, error) {
	return s.repo.ListByUser(ctx, userID)
}

func (s *MCPTokenService) Revoke(ctx context.Context, userID, id string) (bool, error) {
	return s.repo.Delete(ctx, userID, id)
}

func (s *MCPTokenService) Audit(ctx context.Context, userID, tokenID string, limit int) ([]model.MCPAuditEntry, error) {
	return s.repo.Audit(ctx, userID, tokenID, limit)
}

// Authenticate returns the token a raw bearer value belongs to, or nil when
// it is not a known token.
func (s *MCPTokenService) Authenticate(ctx context.Context, raw string) (*model.MCPToken, error) {
	if !strings.HasPrefix(raw, MCPTokenPrefix) {
		return nil, nil
	}
	return s.repo.GetByHash(ctx, HashMCPToken(raw))
}

// Record writes the audit entry for one request made with the token.
func (s *MCPTokenService) Record(ctx context.Context, tokenID, tool, summary string) error {
	return s.repo.Use(ctx, tokenID, tool, summary)
}

// HashMCPToken is the stored form of a token value.
func HashMCPToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func newMCPTokenValue() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return MCPTokenPrefix + base64.RawURLEncoding.EncodeToString(b), nil
}

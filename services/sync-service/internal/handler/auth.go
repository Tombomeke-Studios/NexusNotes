package handler

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/middleware"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/service"
)

type AuthHandler struct {
	authService    *service.AuthService
	accountService *service.AccountService
	emailAuth      *service.EmailAuthService
	userRepo       *repository.UserRepo
}

func NewAuthHandler(authService *service.AuthService, accountService *service.AccountService, emailAuth *service.EmailAuthService, userRepo *repository.UserRepo) *AuthHandler {
	return &AuthHandler{authService: authService, accountService: accountService, emailAuth: emailAuth, userRepo: userRepo}
}

// ExportAccount streams a zip with all of the user's data (GDPR portability):
// every vault as a folder of markdown files plus account metadata.
func (h *AuthHandler) ExportAccount(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())

	data, err := h.accountService.Export(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to export account data")
		return
	}

	filename := fmt.Sprintf("nexusnotes-export-%s.zip", time.Now().UTC().Format("2006-01-02"))
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// DeleteAccount permanently erases the authenticated user's account and all
// their data (GDPR right to erasure). The password must be re-supplied.
func (h *AuthHandler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())

	var req struct {
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Password == "" {
		writeError(w, http.StatusBadRequest, "password is required to delete the account")
		return
	}

	if err := h.accountService.DeleteAccount(r.Context(), userID, req.Password); err != nil {
		if errors.Is(err, service.ErrInvalidCredentials) {
			writeError(w, http.StatusUnauthorized, "invalid credentials")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to delete account")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		DisplayName string `json:"display_name"`
		DeviceID    string `json:"device_id"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Email == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "email and password are required")
		return
	}

	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}

	user, token, err := h.authService.Register(r.Context(), req.Email, req.Password, req.DisplayName)
	if err != nil {
		if errors.Is(err, service.ErrEmailTaken) {
			writeError(w, http.StatusConflict, "email already taken")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to register")
		return
	}

	refresh, err := h.authService.IssueRefreshToken(r.Context(), user.ID, req.DeviceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to register")
		return
	}

	// Kick off email verification (#47); best effort — a mail failure must not
	// fail registration, and with SMTP unconfigured this is a logged no-op.
	if h.emailAuth != nil {
		if err := h.emailAuth.SendVerification(r.Context(), user.ID, user.Email); err != nil {
			slog.Warn("send verification email on register", "user_id", user.ID, "error", err)
		}
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"user":          user,
		"token":         token,
		"refresh_token": refresh,
	})
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		DeviceID string `json:"device_id"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Email == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "email and password are required")
		return
	}

	user, token, err := h.authService.Login(r.Context(), req.Email, req.Password, middleware.ClientIP(r))
	if err != nil {
		if errors.Is(err, service.ErrInvalidCredentials) {
			writeError(w, http.StatusUnauthorized, "invalid credentials")
			return
		}
		if errors.Is(err, service.ErrTooManyAttempts) {
			writeError(w, http.StatusTooManyRequests, "too many failed attempts, try again later")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to login")
		return
	}

	refresh, err := h.authService.IssueRefreshToken(r.Context(), user.ID, req.DeviceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to login")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"user":          user,
		"token":         token,
		"refresh_token": refresh,
	})
}

// VerifyEmail confirms an address from the token in a verification email (#47).
func (h *AuthHandler) VerifyEmail(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
	}
	if err := decodeJSON(r, &req); err != nil || req.Token == "" {
		writeError(w, http.StatusBadRequest, "token is required")
		return
	}
	if err := h.emailAuth.VerifyEmail(r.Context(), req.Token); err != nil {
		writeError(w, http.StatusBadRequest, "invalid or expired verification link")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ForgotPassword emails a reset link (#48). Always 204 so the response never
// reveals whether the address is registered.
func (h *AuthHandler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
	}
	if err := decodeJSON(r, &req); err != nil || req.Email == "" {
		writeError(w, http.StatusBadRequest, "email is required")
		return
	}
	h.emailAuth.RequestPasswordReset(r.Context(), req.Email)
	w.WriteHeader(http.StatusNoContent)
}

// ResetPassword sets a new password from a reset token and revokes sessions (#48).
func (h *AuthHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &req); err != nil || req.Token == "" {
		writeError(w, http.StatusBadRequest, "token is required")
		return
	}
	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}
	if err := h.emailAuth.ResetPassword(r.Context(), req.Token, req.Password); err != nil {
		writeError(w, http.StatusBadRequest, "invalid or expired reset link")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Refresh rotates a refresh token into a fresh access + refresh pair (#49).
func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RefreshToken string `json:"refresh_token"`
		DeviceID     string `json:"device_id"`
	}
	if err := decodeJSON(r, &req); err != nil || req.RefreshToken == "" {
		writeError(w, http.StatusBadRequest, "refresh_token is required")
		return
	}

	access, refresh, err := h.authService.Refresh(r.Context(), req.RefreshToken, req.DeviceID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid refresh token")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"token":         access,
		"refresh_token": refresh,
	})
}

// Logout invalidates the presented refresh token (the token itself is the
// credential, so no JWT is required). Always 204.
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := decodeJSON(r, &req); err == nil {
		h.authService.Logout(r.Context(), req.RefreshToken)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())

	user, err := h.userRepo.GetByID(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}

	writeJSON(w, http.StatusOK, user)
}

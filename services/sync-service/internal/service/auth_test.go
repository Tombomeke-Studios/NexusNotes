package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/repository"
)

// fakeUserStore is a hand-rolled UserStore for exercising the auth service
// without a database.
type fakeUserStore struct {
	createErr   error
	byEmail     *model.User
	byEmailErr  error
	updatedHash string
}

func (f *fakeUserStore) Create(context.Context, *model.User) error { return f.createErr }
func (f *fakeUserStore) GetByEmail(context.Context, string) (*model.User, error) {
	return f.byEmail, f.byEmailErr
}
func (f *fakeUserStore) GetByID(context.Context, string) (*model.User, error) {
	return f.byEmail, f.byEmailErr
}
func (f *fakeUserStore) UpdatePasswordHash(_ context.Context, _ string, hash string) error {
	f.updatedHash = hash
	return nil
}

func newAuthService(store UserStore) *AuthService {
	return NewAuthService(store, "test-secret")
}

func TestRegister_DuplicateEmail(t *testing.T) {
	s := newAuthService(&fakeUserStore{createErr: repository.ErrDuplicateEmail})
	_, _, err := s.Register(context.Background(), "a@example.com", "password123", "A")
	if !errors.Is(err, ErrEmailTaken) {
		t.Fatalf("err = %v, want ErrEmailTaken", err)
	}
}

func TestRegister_InfraErrorNotMasked(t *testing.T) {
	// A database/connection failure must NOT be reported as "email taken".
	s := newAuthService(&fakeUserStore{createErr: errors.New("connection refused")})
	_, _, err := s.Register(context.Background(), "a@example.com", "password123", "A")
	if err == nil {
		t.Fatal("expected an error")
	}
	if errors.Is(err, ErrEmailTaken) {
		t.Fatalf("infra error must not be masked as ErrEmailTaken, got %v", err)
	}
}

func TestRegister_Success(t *testing.T) {
	s := newAuthService(&fakeUserStore{})
	user, token, err := s.Register(context.Background(), "a@example.com", "password123", "A")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if user == nil || token == "" {
		t.Fatalf("want user and token, got user=%v token=%q", user, token)
	}
}

func TestLogin_UserNotFound(t *testing.T) {
	s := newAuthService(&fakeUserStore{byEmailErr: repository.ErrUserNotFound})
	_, _, err := s.Login(context.Background(), "missing@example.com", "password123", "10.0.0.1")
	if !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("err = %v, want ErrInvalidCredentials", err)
	}
}

func TestLogin_InfraErrorNotMasked(t *testing.T) {
	// A database/connection failure must NOT be reported as "invalid credentials".
	s := newAuthService(&fakeUserStore{byEmailErr: errors.New("connection refused")})
	_, _, err := s.Login(context.Background(), "a@example.com", "password123", "10.0.0.1")
	if err == nil {
		t.Fatal("expected an error")
	}
	if errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("infra error must not be masked as ErrInvalidCredentials, got %v", err)
	}
}

func TestLogin_WrongPassword(t *testing.T) {
	hash, _ := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.DefaultCost)
	s := newAuthService(&fakeUserStore{byEmail: &model.User{
		ID:           "u1",
		Email:        "a@example.com",
		PasswordHash: string(hash),
	}})
	_, _, err := s.Login(context.Background(), "a@example.com", "wrong-password", "10.0.0.1")
	if !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("err = %v, want ErrInvalidCredentials", err)
	}
}

func TestLogin_Success(t *testing.T) {
	hash, _ := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.DefaultCost)
	s := newAuthService(&fakeUserStore{byEmail: &model.User{
		ID:           "u1",
		Email:        "a@example.com",
		PasswordHash: string(hash),
	}})
	user, token, err := s.Login(context.Background(), "a@example.com", "correct-password", "10.0.0.1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if user == nil || token == "" {
		t.Fatalf("want user and token, got user=%v token=%q", user, token)
	}
}

func TestLogin_UserNotFoundRunsDummyVerify(t *testing.T) {
	called := false
	orig := dummyPasswordVerify
	dummyPasswordVerify = func(string) { called = true }
	t.Cleanup(func() { dummyPasswordVerify = orig })

	s := newAuthService(&fakeUserStore{byEmailErr: repository.ErrUserNotFound})
	_, _, err := s.Login(context.Background(), "missing@example.com", "password123", "10.0.0.1")
	if !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("err = %v, want ErrInvalidCredentials", err)
	}
	if !called {
		t.Fatal("unknown-email path must run the dummy password verification")
	}
}

func TestDummyPasswordVerify_UsesValidArgon2idHash(t *testing.T) {
	if !strings.HasPrefix(dummyHash(), "$argon2id$") {
		t.Fatalf("dummy hash = %q, want $argon2id$ prefix", dummyHash())
	}
	// Must not panic or error for arbitrary input; it only burns KDF time.
	dummyPasswordVerify("any-password")
}

func TestLogin_RehashesLegacyBcryptHash(t *testing.T) {
	legacy, _ := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.DefaultCost)
	store := &fakeUserStore{byEmail: &model.User{
		ID:           "u1",
		Email:        "a@example.com",
		PasswordHash: string(legacy),
	}}
	s := newAuthService(store)

	if _, _, err := s.Login(context.Background(), "a@example.com", "correct-password", "10.0.0.1"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.HasPrefix(store.updatedHash, "$argon2id$") {
		t.Fatalf("stored hash was not upgraded to argon2id, got %q", store.updatedHash)
	}
	if ok, _, _ := verifyPassword(store.updatedHash, "correct-password"); !ok {
		t.Fatal("upgraded hash does not verify the original password")
	}
}

func TestLogin_NoRehashForCurrentHash(t *testing.T) {
	hash, _ := hashPassword("correct-password")
	store := &fakeUserStore{byEmail: &model.User{
		ID:           "u1",
		Email:        "a@example.com",
		PasswordHash: hash,
	}}
	s := newAuthService(store)

	if _, _, err := s.Login(context.Background(), "a@example.com", "correct-password", "10.0.0.1"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if store.updatedHash != "" {
		t.Fatalf("current argon2id hash must not be rehashed, got update %q", store.updatedHash)
	}
}

func TestLogin_LocksAfterRepeatedFailures(t *testing.T) {
	hash, _ := hashPassword("correct-password")
	s := newAuthService(&fakeUserStore{byEmail: &model.User{
		ID:           "u1",
		Email:        "a@example.com",
		PasswordHash: hash,
	}})

	for i := 0; i < lockThreshold; i++ {
		if _, _, err := s.Login(context.Background(), "a@example.com", "wrong", "10.0.0.1"); !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("attempt %d: err = %v, want ErrInvalidCredentials", i+1, err)
		}
	}

	// Even the correct password is rejected while the account is locked.
	if _, _, err := s.Login(context.Background(), "a@example.com", "correct-password", "10.0.0.1"); !errors.Is(err, ErrTooManyAttempts) {
		t.Fatalf("err = %v, want ErrTooManyAttempts", err)
	}
}

func TestLogin_SuccessResetsFailureCount(t *testing.T) {
	hash, _ := hashPassword("correct-password")
	s := newAuthService(&fakeUserStore{byEmail: &model.User{
		ID:           "u1",
		Email:        "a@example.com",
		PasswordHash: hash,
	}})

	for i := 0; i < lockThreshold-1; i++ {
		_, _, _ = s.Login(context.Background(), "a@example.com", "wrong", "10.0.0.1")
	}
	if _, _, err := s.Login(context.Background(), "a@example.com", "correct-password", "10.0.0.1"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// The counter restarted: new failures start from zero again.
	if _, _, err := s.Login(context.Background(), "a@example.com", "wrong", "10.0.0.1"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("err = %v, want ErrInvalidCredentials after reset", err)
	}
}

func TestLogin_UnknownEmailAlsoThrottled(t *testing.T) {
	s := newAuthService(&fakeUserStore{byEmailErr: repository.ErrUserNotFound})

	for i := 0; i < lockThreshold; i++ {
		_, _, _ = s.Login(context.Background(), "ghost@example.com", "wrong", "10.0.0.1")
	}
	if _, _, err := s.Login(context.Background(), "ghost@example.com", "wrong", "10.0.0.1"); !errors.Is(err, ErrTooManyAttempts) {
		t.Fatalf("err = %v, want ErrTooManyAttempts for a nonexistent account", err)
	}
}

// #181: an attacker locking the email from their IP must not lock the real
// owner out on the owner's own IP.
func TestLogin_LockDoesNotAffectOtherIPs(t *testing.T) {
	hash, _ := hashPassword("correct-password")
	s := newAuthService(&fakeUserStore{byEmail: &model.User{
		ID:           "u1",
		Email:        "a@example.com",
		PasswordHash: hash,
	}})

	for i := 0; i < lockThreshold; i++ {
		_, _, _ = s.Login(context.Background(), "a@example.com", "wrong", "6.6.6.6")
	}
	if _, _, err := s.Login(context.Background(), "a@example.com", "correct-password", "6.6.6.6"); !errors.Is(err, ErrTooManyAttempts) {
		t.Fatalf("attacker IP: err = %v, want ErrTooManyAttempts", err)
	}
	if _, _, err := s.Login(context.Background(), "a@example.com", "correct-password", "10.0.0.1"); err != nil {
		t.Fatalf("owner IP must still be able to sign in, got %v", err)
	}
}

func TestLogin_CrossIPGuessingHitsTarpit(t *testing.T) {
	hash, _ := hashPassword("correct-password")
	s := newAuthService(&fakeUserStore{byEmail: &model.User{
		ID:           "u1",
		Email:        "a@example.com",
		PasswordHash: hash,
	}})
	var slept time.Duration
	s.sleep = func(d time.Duration) { slept += d }

	for i := 0; i < tarpitThreshold; i++ {
		_, _, _ = s.Login(context.Background(), "a@example.com", "wrong", fmt.Sprintf("10.0.%d.1", i))
	}

	// The owner can still log in from a fresh IP, but pays the tarpit delay.
	if _, _, err := s.Login(context.Background(), "a@example.com", "correct-password", "192.168.1.5"); err != nil {
		t.Fatalf("owner must still be able to sign in through the tarpit, got %v", err)
	}
	if slept != tarpitDelay {
		t.Fatalf("tarpit slept %v, want %v", slept, tarpitDelay)
	}

	// The successful login cleared the tarpit again.
	slept = 0
	if _, _, err := s.Login(context.Background(), "a@example.com", "correct-password", "192.168.1.5"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if slept != 0 {
		t.Fatalf("tarpit still active after a successful login (slept %v)", slept)
	}
}

func TestAuthService_GenerateAndValidateToken(t *testing.T) {
	s := &AuthService{jwtSecret: []byte("test-secret")}

	token, err := s.generateToken("user-123")
	if err != nil {
		t.Fatalf("generateToken() error = %v", err)
	}

	claims, err := s.ValidateToken(token)
	if err != nil {
		t.Fatalf("ValidateToken() error = %v", err)
	}

	if claims.UserID != "user-123" {
		t.Errorf("UserID = %v, want user-123", claims.UserID)
	}
}

func TestAuthService_ValidateToken_Invalid(t *testing.T) {
	s := &AuthService{jwtSecret: []byte("test-secret")}

	_, err := s.ValidateToken("invalid-token")
	if err == nil {
		t.Error("ValidateToken() should fail for invalid token")
	}
}

func TestAuthService_ValidateToken_WrongSecret(t *testing.T) {
	s1 := &AuthService{jwtSecret: []byte("secret-1")}
	s2 := &AuthService{jwtSecret: []byte("secret-2")}

	token, _ := s1.generateToken("user-123")
	_, err := s2.ValidateToken(token)
	if err == nil {
		t.Error("ValidateToken() should fail for wrong secret")
	}
}

func TestAuthService_ValidateToken_Expired(t *testing.T) {
	s := &AuthService{jwtSecret: []byte("test-secret")}

	claims := &Claims{
		UserID: "user-123",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-2 * time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, _ := token.SignedString(s.jwtSecret)

	_, err := s.ValidateToken(tokenString)
	if err == nil {
		t.Error("ValidateToken() should fail for expired token")
	}
}

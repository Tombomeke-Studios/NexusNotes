package service

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

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

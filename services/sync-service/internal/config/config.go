package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	Port                int
	DatabaseURL         string
	JWTSecret           string
	RedisURL            string
	MeiliURL            string
	MeiliMasterKey      string
	AuthRateLimitPerMin int
	AuthRateLimitBurst  int
	// AdminToken guards /api/admin/*; the endpoints are disabled when empty.
	AdminToken string
}

func Load() (*Config, error) {
	port := 8080
	if p := os.Getenv("PORT"); p != "" {
		var err error
		port, err = strconv.Atoi(p)
		if err != nil {
			return nil, fmt.Errorf("invalid PORT: %w", err)
		}
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		return nil, fmt.Errorf("JWT_SECRET is required")
	}

	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://localhost:6379"
	}

	meiliURL := os.Getenv("MEILI_URL")
	if meiliURL == "" {
		meiliURL = "http://localhost:7700"
	}

	meiliMasterKey := os.Getenv("MEILI_MASTER_KEY")
	adminToken := os.Getenv("ADMIN_TOKEN")

	authRatePerMin, err := intEnv("AUTH_RATE_LIMIT_PER_MIN", 10)
	if err != nil {
		return nil, err
	}
	authRateBurst, err := intEnv("AUTH_RATE_LIMIT_BURST", 10)
	if err != nil {
		return nil, err
	}

	return &Config{
		Port:                port,
		DatabaseURL:         dbURL,
		JWTSecret:           jwtSecret,
		RedisURL:            redisURL,
		MeiliURL:            meiliURL,
		MeiliMasterKey:      meiliMasterKey,
		AuthRateLimitPerMin: authRatePerMin,
		AuthRateLimitBurst:  authRateBurst,
		AdminToken:          adminToken,
	}, nil
}

// intEnv reads an integer environment variable, falling back to def when unset.
func intEnv(name string, def int) (int, error) {
	v := os.Getenv(name)
	if v == "" {
		return def, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, fmt.Errorf("invalid %s: %w", name, err)
	}
	return n, nil
}

package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	Port            int
	DatabaseURL     string
	JWTSecret       string
	RedisURL        string
	MeiliURL        string
	MeiliMasterKey  string
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

	return &Config{
		Port:           port,
		DatabaseURL:    dbURL,
		JWTSecret:      jwtSecret,
		RedisURL:       redisURL,
		MeiliURL:       meiliURL,
		MeiliMasterKey: meiliMasterKey,
	}, nil
}

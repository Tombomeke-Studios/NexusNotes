package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
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
	// SMTP_* mail settings; when SMTPHost is empty, mail is logged not sent
	// and email verification is not enforced (#50).
	SMTPHost string
	SMTPPort int
	SMTPUser string
	SMTPPass string
	SMTPFrom string
	// AppBaseURL is the public origin used to build action links in emails.
	AppBaseURL string
	// MinIO/S3 object storage for attachments (#153); disabled when Endpoint empty.
	MinIOEndpoint  string
	MinIOAccessKey string
	MinIOSecretKey string
	MinIOBucket    string
	MinIOUseSSL    bool
	// AllowedOrigins is the browser-origin allowlist shared by CORS and the
	// WebSocket handshake (#258), from CORS_ALLOWED_ORIGINS (comma separated).
	AllowedOrigins []string
}

// DefaultAllowedOrigins covers the desktop app and local development:
// the Vite dev servers, tauri://localhost (packaged app on macOS/Linux) and
// http://tauri.localhost (packaged app on Windows, WebView2). A web UI
// served through a proxy on the API's own host needs no entry: the
// WebSocket check also accepts the server's own origin.
var DefaultAllowedOrigins = []string{
	"http://localhost:1420",
	"http://localhost:5173",
	"tauri://localhost",
	"http://tauri.localhost",
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

	smtpPort, err := intEnv("SMTP_PORT", 587)
	if err != nil {
		return nil, err
	}
	appBaseURL := os.Getenv("APP_BASE_URL")
	if appBaseURL == "" {
		appBaseURL = "http://localhost:1420"
	}

	minioBucket := os.Getenv("MINIO_BUCKET")
	if minioBucket == "" {
		minioBucket = "attachments"
	}

	allowedOrigins, err := parseAllowedOrigins(os.Getenv("CORS_ALLOWED_ORIGINS"))
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
		SMTPHost:            os.Getenv("SMTP_HOST"),
		SMTPPort:            smtpPort,
		SMTPUser:            os.Getenv("SMTP_USER"),
		SMTPPass:            os.Getenv("SMTP_PASS"),
		SMTPFrom:            os.Getenv("SMTP_FROM"),
		AppBaseURL:          appBaseURL,
		MinIOEndpoint:       os.Getenv("MINIO_ENDPOINT"),
		MinIOAccessKey:      os.Getenv("MINIO_ACCESS_KEY"),
		MinIOSecretKey:      os.Getenv("MINIO_SECRET_KEY"),
		MinIOBucket:         minioBucket,
		MinIOUseSSL:         os.Getenv("MINIO_USE_SSL") == "true",
		AllowedOrigins:      allowedOrigins,
	}, nil
}

// parseAllowedOrigins turns a comma-separated CORS_ALLOWED_ORIGINS value into
// an origin list, falling back to DefaultAllowedOrigins when it is blank.
// Every entry must be a bare origin (scheme://host[:port]); a wildcard is
// refused because credentialed CORS plus "*" would let any site in.
func parseAllowedOrigins(raw string) ([]string, error) {
	var origins []string
	for _, part := range strings.Split(raw, ",") {
		o := strings.TrimSuffix(strings.TrimSpace(part), "/")
		if o == "" {
			continue
		}
		if strings.Contains(o, "*") {
			return nil, fmt.Errorf("invalid CORS_ALLOWED_ORIGINS entry %q: wildcards are not allowed", o)
		}
		u, err := url.Parse(o)
		if err != nil || u.Scheme == "" || u.Host == "" || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
			return nil, fmt.Errorf("invalid CORS_ALLOWED_ORIGINS entry %q: want scheme://host[:port]", o)
		}
		origins = append(origins, o)
	}
	if len(origins) == 0 {
		return append([]string(nil), DefaultAllowedOrigins...), nil
	}
	return origins, nil
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

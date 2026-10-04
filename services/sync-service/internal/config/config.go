package config

import (
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt"
)

type Config struct {
	Port int
	// BindAddrs are the host addresses the HTTP server listens on (BIND_ADDR,
	// comma-separated). Empty means every interface, which the Docker image
	// needs; the packaged desktop app passes its loopback addresses so the
	// bundled backend cannot be reached from the network (#260).
	BindAddrs   []string
	DatabaseURL string
	JWTSecret   string
	// DataEncryptionKey encrypts user data at rest (#353): 64 hex characters.
	// DataEncryptionOldKeys are retired keys that existing rows may still be
	// encrypted under (key rotation). Losing a key loses the data under it.
	DataEncryptionKey     string
	DataEncryptionOldKeys []string
	RedisURL              string
	MeiliURL              string
	MeiliMasterKey        string
	AuthRateLimitPerMin   int
	AuthRateLimitBurst    int
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
	// LinkedFilesAllowPrivate lets the linked-file URL proxy fetch loopback,
	// private and link-local addresses. Off by default; only for self-hosters
	// who deliberately link resources on their own network.
	LinkedFilesAllowPrivate bool
	// MetricsAddr is the separate listener /metrics is served on (METRICS_ADDR,
	// host:port such as ":9091"). Empty disables /metrics: it is never served
	// on the public listener (#327).
	MetricsAddr string
	// TrustedProxies are the reverse proxies (TRUSTED_PROXIES, comma-separated
	// CIDRs or IPs) whose X-Forwarded-For / X-Real-IP name the real client.
	// Empty: those headers are ignored (#373).
	TrustedProxies []netip.Prefix
	// DBPool sizes the Postgres connection pool (DB_MAX_CONNS, DB_MIN_CONNS,
	// DB_MAX_CONN_LIFETIME, DB_MAX_CONN_IDLE_TIME) (#220).
	DBPool DBPool
}

// DBPool holds the connection pool settings. Connections are recycled after
// MaxConnLifetime so a restarted or failed-over database is picked up, and
// idle ones beyond MinConns are closed after MaxConnIdleTime.
type DBPool struct {
	MaxConns        int32
	MinConns        int32
	MaxConnLifetime time.Duration
	MaxConnIdleTime time.Duration
}

// DefaultDBPool suits a single self-hosted instance: Postgres allows 100
// connections by default, which leaves room for migrations, backups and psql.
var DefaultDBPool = DBPool{
	MaxConns:        20,
	MinConns:        2,
	MaxConnLifetime: time.Hour,
	MaxConnIdleTime: 30 * time.Minute,
}

// DefaultAllowedOrigins covers the desktop app and local development:
// the Vite dev servers, tauri://localhost (packaged app on macOS/Linux) and
// http://tauri.localhost (packaged app on Windows, WebView2). A web UI
// served through a proxy on the API's own host needs no entry: the
// WebSocket check also accepts the server's own origin.
// MinSecretLength is the shortest JWT_SECRET and ADMIN_TOKEN accepted: a
// short HMAC secret can be guessed offline from any token it signed (#328).
const MinSecretLength = 32

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
	if len(jwtSecret) < MinSecretLength {
		return nil, fmt.Errorf("JWT_SECRET must be at least %d characters (generate one with: openssl rand -hex 32)", MinSecretLength)
	}

	dataKey := strings.TrimSpace(os.Getenv("DATA_ENCRYPTION_KEY"))
	if dataKey == "" {
		return nil, fmt.Errorf("DATA_ENCRYPTION_KEY is required (generate one with: openssl rand -hex 32, and back it up: data encrypted under a lost key cannot be recovered)")
	}
	if _, err := fieldcrypt.New(dataKey, nil); err != nil {
		return nil, fmt.Errorf("DATA_ENCRYPTION_KEY: %w", err)
	}
	var oldDataKeys []string
	for _, part := range strings.Split(os.Getenv("DATA_ENCRYPTION_OLD_KEYS"), ",") {
		if k := strings.TrimSpace(part); k != "" {
			oldDataKeys = append(oldDataKeys, k)
		}
	}
	if _, err := fieldcrypt.New(dataKey, oldDataKeys); err != nil {
		return nil, fmt.Errorf("DATA_ENCRYPTION_OLD_KEYS: %w", err)
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
	if adminToken != "" && len(adminToken) < MinSecretLength {
		return nil, fmt.Errorf("ADMIN_TOKEN must be at least %d characters, or empty to disable the admin endpoints", MinSecretLength)
	}

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

	linkedAllowPrivate, err := boolEnv("LINKED_FILES_ALLOW_PRIVATE", false)
	if err != nil {
		return nil, err
	}

	minioBucket := os.Getenv("MINIO_BUCKET")
	if minioBucket == "" {
		minioBucket = "attachments"
	}

	allowedOrigins, err := parseAllowedOrigins(os.Getenv("CORS_ALLOWED_ORIGINS"))
	if err != nil {
		return nil, err
	}

	bindAddrs, err := parseBindAddrs(os.Getenv("BIND_ADDR"))
	if err != nil {
		return nil, err
	}

	metricsAddr := strings.TrimSpace(os.Getenv("METRICS_ADDR"))
	if metricsAddr != "" {
		if _, _, err := net.SplitHostPort(metricsAddr); err != nil {
			return nil, fmt.Errorf("invalid METRICS_ADDR %q: want host:port such as :9091", metricsAddr)
		}
	}

	dbPool, err := loadDBPool()
	if err != nil {
		return nil, err
	}

	trustedProxies, err := parseTrustedProxies(os.Getenv("TRUSTED_PROXIES"))
	if err != nil {
		return nil, err
	}

	return &Config{
		Port:                    port,
		BindAddrs:               bindAddrs,
		DatabaseURL:             dbURL,
		JWTSecret:               jwtSecret,
		DataEncryptionKey:       dataKey,
		DataEncryptionOldKeys:   oldDataKeys,
		RedisURL:                redisURL,
		MeiliURL:                meiliURL,
		MeiliMasterKey:          meiliMasterKey,
		AuthRateLimitPerMin:     authRatePerMin,
		AuthRateLimitBurst:      authRateBurst,
		AdminToken:              adminToken,
		SMTPHost:                os.Getenv("SMTP_HOST"),
		SMTPPort:                smtpPort,
		SMTPUser:                os.Getenv("SMTP_USER"),
		SMTPPass:                os.Getenv("SMTP_PASS"),
		SMTPFrom:                os.Getenv("SMTP_FROM"),
		AppBaseURL:              appBaseURL,
		MinIOEndpoint:           os.Getenv("MINIO_ENDPOINT"),
		MinIOAccessKey:          os.Getenv("MINIO_ACCESS_KEY"),
		MinIOSecretKey:          os.Getenv("MINIO_SECRET_KEY"),
		MinIOBucket:             minioBucket,
		MinIOUseSSL:             os.Getenv("MINIO_USE_SSL") == "true",
		AllowedOrigins:          allowedOrigins,
		LinkedFilesAllowPrivate: linkedAllowPrivate,
		MetricsAddr:             metricsAddr,
		TrustedProxies:          trustedProxies,
		DBPool:                  dbPool,
	}, nil
}

func loadDBPool() (DBPool, error) {
	pool := DefaultDBPool
	maxConns, err := intEnv("DB_MAX_CONNS", int(pool.MaxConns))
	if err != nil {
		return pool, err
	}
	minConns, err := intEnv("DB_MIN_CONNS", int(pool.MinConns))
	if err != nil {
		return pool, err
	}
	if maxConns < 1 || maxConns > 1000 {
		return pool, fmt.Errorf("DB_MAX_CONNS must be between 1 and 1000")
	}
	if minConns < 0 || minConns > maxConns {
		return pool, fmt.Errorf("DB_MIN_CONNS must be between 0 and DB_MAX_CONNS (%d)", maxConns)
	}
	pool.MaxConns, pool.MinConns = int32(maxConns), int32(minConns)
	if pool.MaxConnLifetime, err = durationEnv("DB_MAX_CONN_LIFETIME", pool.MaxConnLifetime); err != nil {
		return pool, err
	}
	if pool.MaxConnIdleTime, err = durationEnv("DB_MAX_CONN_IDLE_TIME", pool.MaxConnIdleTime); err != nil {
		return pool, err
	}
	return pool, nil
}

// durationEnv reads a positive Go duration ("45m", "1h") from the environment.
func durationEnv(name string, def time.Duration) (time.Duration, error) {
	v := os.Getenv(name)
	if v == "" {
		return def, nil
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		return 0, fmt.Errorf("invalid %s: want a positive duration such as 30m or 1h", name)
	}
	return d, nil
}

// parseTrustedProxies reads TRUSTED_PROXIES: comma-separated CIDRs or single
// IPs (a bare IP trusts exactly that address).
func parseTrustedProxies(raw string) ([]netip.Prefix, error) {
	var out []netip.Prefix
	for _, part := range strings.Split(raw, ",") {
		v := strings.TrimSpace(part)
		if v == "" {
			continue
		}
		if p, err := netip.ParsePrefix(v); err == nil {
			out = append(out, p.Masked())
			continue
		}
		a, err := netip.ParseAddr(v)
		if err != nil {
			return nil, fmt.Errorf("invalid TRUSTED_PROXIES entry %q: want a CIDR (172.16.0.0/12) or an IP", v)
		}
		out = append(out, netip.PrefixFrom(a, a.BitLen()))
	}
	return out, nil
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

// parseBindAddrs reads BIND_ADDR. Empty means every interface (what the Docker
// image needs). A value that is set but names no address (" , ", "   ") is
// refused: falling back to every interface would expose a backend that was
// meant to stay local (#335).
func parseBindAddrs(raw string) ([]string, error) {
	addrs := splitList(raw)
	if raw != "" && len(addrs) == 0 {
		return nil, fmt.Errorf("invalid BIND_ADDR %q: no address given; leave it unset to listen on every interface", raw)
	}
	return addrs, nil
}

// ListenAddrs returns one host:port per bind address, or ":port" (every
// interface) when no bind address is configured.
func (c *Config) ListenAddrs() []string {
	port := strconv.Itoa(c.Port)
	if len(c.BindAddrs) == 0 {
		return []string{":" + port}
	}
	addrs := make([]string, 0, len(c.BindAddrs))
	for _, host := range c.BindAddrs {
		addrs = append(addrs, net.JoinHostPort(host, port))
	}
	return addrs
}

// splitList splits a comma-separated value, dropping blanks and spaces.
func splitList(v string) []string {
	var out []string
	for _, part := range strings.Split(v, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
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

// boolEnv reads a boolean environment variable ("true"/"false", "1"/"0", ...),
// falling back to def when unset.
func boolEnv(name string, def bool) (bool, error) {
	v := os.Getenv(name)
	if v == "" {
		return def, nil
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return false, fmt.Errorf("invalid %s: %w", name, err)
	}
	return b, nil
}

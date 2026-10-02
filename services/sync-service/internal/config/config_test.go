package config

import (
	"reflect"
	"strings"
	"testing"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt"
)

func TestParseAllowedOrigins(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want []string
	}{
		{"unset falls back to the defaults", "", DefaultAllowedOrigins},
		{"blank falls back to the defaults", "  ,  ", DefaultAllowedOrigins},
		{"single origin", "https://notes.example.com", []string{"https://notes.example.com"}},
		{
			"comma separated, trimmed, trailing slash dropped",
			" https://notes.example.com/ , tauri://localhost ",
			[]string{"https://notes.example.com", "tauri://localhost"},
		},
	}
	for _, c := range cases {
		got, err := parseAllowedOrigins(c.raw)
		if err != nil {
			t.Fatalf("%s: unexpected error %v", c.name, err)
		}
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

func TestParseAllowedOrigins_DefaultsAreACopy(t *testing.T) {
	got, _ := parseAllowedOrigins("")
	got[0] = "https://mutated.example"
	if DefaultAllowedOrigins[0] == "https://mutated.example" {
		t.Fatal("callers must not be able to mutate the shared defaults")
	}
}

func TestParseAllowedOrigins_RejectsUnsafeOrMalformedEntries(t *testing.T) {
	for _, raw := range []string{
		"*",                             // would allow every site with credentials
		"https://ok.example,*",          // wildcard anywhere in the list
		"notes.example.com",             // no scheme
		"https://",                      // no host
		"https://notes.example.com/app", // an origin has no path
		"https://notes.example.com?x=1", // nor a query
		"://nonsense",                   // unparseable
	} {
		if _, err := parseAllowedOrigins(raw); err == nil {
			t.Errorf("%q: expected an error", raw)
		}
	}
}

func TestLoad_ReadsAllowedOriginsFromEnv(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("JWT_SECRET", testSecret)
	t.Setenv("DATA_ENCRYPTION_KEY", testDataKey)
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://notes.example.com")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if want := []string{"https://notes.example.com"}; !reflect.DeepEqual(cfg.AllowedOrigins, want) {
		t.Fatalf("AllowedOrigins = %v, want %v", cfg.AllowedOrigins, want)
	}
}

func TestLoad_FailsOnAnInvalidAllowedOrigin(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("JWT_SECRET", testSecret)
	t.Setenv("DATA_ENCRYPTION_KEY", testDataKey)
	t.Setenv("CORS_ALLOWED_ORIGINS", "*")

	if _, err := Load(); err == nil {
		t.Fatal("expected Load to reject a wildcard origin")
	}
}

// setRequired sets the variables Load refuses to run without.
func setRequired(t *testing.T) {
	t.Helper()
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("JWT_SECRET", testSecret)
	t.Setenv("DATA_ENCRYPTION_KEY", testDataKey)
}

func TestLoad_ListenAddrsDefaultsToAllInterfaces(t *testing.T) {
	setRequired(t)
	t.Setenv("PORT", "")
	t.Setenv("BIND_ADDR", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	// Docker needs every interface; an unset BIND_ADDR must keep that.
	if got, want := cfg.ListenAddrs(), []string{":8080"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("ListenAddrs() = %v, want %v", got, want)
	}
}

func TestLoad_ListenAddrsFromBindAddr(t *testing.T) {
	setRequired(t)
	t.Setenv("PORT", "8083")
	t.Setenv("BIND_ADDR", "127.0.0.1,::1")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	want := []string{"127.0.0.1:8083", "[::1]:8083"}
	if got := cfg.ListenAddrs(); !reflect.DeepEqual(got, want) {
		t.Fatalf("ListenAddrs() = %v, want %v", got, want)
	}
}

func TestLoad_BindAddrIgnoresBlanksAndSpaces(t *testing.T) {
	setRequired(t)
	t.Setenv("PORT", "")
	t.Setenv("BIND_ADDR", " 127.0.0.1 , ,")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got, want := cfg.BindAddrs, []string{"127.0.0.1"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("BindAddrs = %v, want %v", got, want)
	}
	if got, want := cfg.ListenAddrs(), []string{"127.0.0.1:8080"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("ListenAddrs() = %v, want %v", got, want)
	}
}

// A BIND_ADDR that is set but names no address is a mistake (a typo or an
// unfilled template); falling back to every interface would expose a backend
// that was meant to stay local (#335).
func TestLoad_BindAddrWithoutAddressesIsAnError(t *testing.T) {
	for _, value := range []string{" , ", ",", "   "} {
		setRequired(t)
		t.Setenv("PORT", "")
		t.Setenv("BIND_ADDR", value)

		if _, err := Load(); err == nil || !strings.Contains(err.Error(), "BIND_ADDR") {
			t.Fatalf("BIND_ADDR=%q: err = %v, want an error naming BIND_ADDR", value, err)
		}
	}
}

func TestLoad_LinkedFilesAllowPrivate(t *testing.T) {
	cases := []struct {
		value   string
		want    bool
		wantErr bool
	}{
		{value: "", want: false}, // unset: private addresses stay blocked
		{value: "false", want: false},
		{value: "true", want: true},
		{value: "1", want: true},
		{value: "yes please", wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.value, func(t *testing.T) {
			setRequired(t)
			t.Setenv("LINKED_FILES_ALLOW_PRIVATE", tc.value)

			cfg, err := Load()
			if tc.wantErr {
				if err == nil {
					t.Fatalf("Load() accepted LINKED_FILES_ALLOW_PRIVATE=%q", tc.value)
				}
				return
			}
			if err != nil {
				t.Fatalf("Load(): %v", err)
			}
			if cfg.LinkedFilesAllowPrivate != tc.want {
				t.Fatalf("LinkedFilesAllowPrivate = %v, want %v", cfg.LinkedFilesAllowPrivate, tc.want)
			}
		})
	}
}

// testSecret is exactly the minimum JWT_SECRET length.
const testSecret = "0123456789abcdef0123456789abcdef"

// Short secrets are guessable offline from any token they signed (#328).
func TestLoad_RejectsAShortJWTSecret(t *testing.T) {
	setRequired(t)
	t.Setenv("JWT_SECRET", testSecret[:31])
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "JWT_SECRET") {
		t.Fatalf("err = %v, want an error naming JWT_SECRET", err)
	}
}

func TestLoad_RejectsAShortAdminToken(t *testing.T) {
	setRequired(t)
	t.Setenv("ADMIN_TOKEN", "short-admin-token")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "ADMIN_TOKEN") {
		t.Fatalf("err = %v, want an error naming ADMIN_TOKEN", err)
	}

	// Unset keeps the admin endpoints disabled, as before.
	t.Setenv("ADMIN_TOKEN", "")
	if _, err := Load(); err != nil {
		t.Fatalf("Load without ADMIN_TOKEN: %v", err)
	}
}

// testDataKey is a valid DATA_ENCRYPTION_KEY (32 bytes as hex).
const testDataKey = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"

// User data is encrypted at rest, so the server must not start without a key (#353).
func TestLoad_RequiresAValidDataEncryptionKey(t *testing.T) {
	for _, value := range []string{"", "too-short", testDataKey[:63] + "z"} {
		setRequired(t)
		t.Setenv("DATA_ENCRYPTION_KEY", value)
		if _, err := Load(); err == nil || !strings.Contains(err.Error(), "DATA_ENCRYPTION_KEY") {
			t.Errorf("DATA_ENCRYPTION_KEY=%q: err = %v, want an error naming it", value, err)
		}
	}
}

func TestLoad_DataEncryptionKeys(t *testing.T) {
	setRequired(t)
	old := "1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100"
	t.Setenv("DATA_ENCRYPTION_OLD_KEYS", " "+old+" , ")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.DataEncryptionKey != testDataKey || !reflect.DeepEqual(cfg.DataEncryptionOldKeys, []string{old}) {
		t.Fatalf("keys = %q, %q", cfg.DataEncryptionKey, cfg.DataEncryptionOldKeys)
	}
	if _, err := fieldcrypt.New(cfg.DataEncryptionKey, cfg.DataEncryptionOldKeys); err != nil {
		t.Fatalf("loaded keys must build a cipher: %v", err)
	}

	t.Setenv("DATA_ENCRYPTION_OLD_KEYS", "not-a-key")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "DATA_ENCRYPTION_OLD_KEYS") {
		t.Fatalf("err = %v, want an error naming DATA_ENCRYPTION_OLD_KEYS", err)
	}
}

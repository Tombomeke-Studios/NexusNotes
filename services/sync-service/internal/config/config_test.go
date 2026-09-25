package config

import (
	"reflect"
	"testing"
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
	t.Setenv("JWT_SECRET", "secret")
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
	t.Setenv("JWT_SECRET", "secret")
	t.Setenv("CORS_ALLOWED_ORIGINS", "*")

	if _, err := Load(); err == nil {
		t.Fatal("expected Load to reject a wildcard origin")
	}
}

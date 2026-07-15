package handler

import "testing"

func TestValidLinkedSourceType(t *testing.T) {
	cases := map[string]bool{
		"url":         true,
		"local_path":  true,
		"github_path": true,
		"ftp":         false,
		"":            false,
		"URL":         false, // case-sensitive
	}
	for st, want := range cases {
		if got := validLinkedSourceType(st); got != want {
			t.Errorf("validLinkedSourceType(%q) = %v, want %v", st, got, want)
		}
	}
}

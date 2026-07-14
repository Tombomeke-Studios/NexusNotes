package handler

import "testing"

func TestValidRole(t *testing.T) {
	cases := map[string]bool{
		"viewer": true,
		"editor": true,
		"owner":  false, // owner is implicit, never an assignable member role
		"admin":  false,
		"":       false,
	}
	for role, want := range cases {
		if got := validRole(role); got != want {
			t.Errorf("validRole(%q) = %v, want %v", role, got, want)
		}
	}
}

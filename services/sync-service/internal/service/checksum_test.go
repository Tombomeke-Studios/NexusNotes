package service

import "testing"

func TestComputeChecksum(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    string
	}{
		{
			name:    "empty string",
			content: "",
			want:    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		},
		{
			name:    "hello world",
			content: "hello world",
			want:    "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
		},
		{
			name:    "deterministic",
			content: "# My Note\n\nSome content here.",
			want:    ComputeChecksum("# My Note\n\nSome content here."),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ComputeChecksum(tt.content)
			if got != tt.want {
				t.Errorf("ComputeChecksum() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestComputeChecksum_DifferentContent(t *testing.T) {
	a := ComputeChecksum("content A")
	b := ComputeChecksum("content B")
	if a == b {
		t.Error("different content should produce different checksums")
	}
}

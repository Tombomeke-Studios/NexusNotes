package service

import (
	"crypto/sha256"
	"encoding/hex"
)

func ComputeChecksum(content string) string {
	h := sha256.Sum256([]byte(content))
	return hex.EncodeToString(h[:])
}

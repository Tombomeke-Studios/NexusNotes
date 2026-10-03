package middleware

import (
	"bytes"
	"compress/gzip"
	"net/http"
	"strings"
	"sync"
)

// minCompressBytes: smaller bodies are sent as they are; gzip's overhead
// would outweigh the gain.
const minCompressBytes = 1024

var gzipPool = sync.Pool{New: func() any { w, _ := gzip.NewWriterLevel(nil, gzip.DefaultCompression); return w }}

// Compress gzips JSON responses for clients that accept it (#461). The note
// list carries every note's markdown, which shrinks to a fraction. Other
// types (attachment bytes are often compressed already), tiny bodies and
// WebSocket upgrades pass through untouched.
func Compress(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Upgrade") != "" || !acceptsGzip(r.Header.Get("Accept-Encoding")) {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Add("Vary", "Accept-Encoding")
		cw := &compressWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(cw, r)
		cw.finish()
	})
}

func acceptsGzip(header string) bool {
	for _, part := range strings.Split(header, ",") {
		enc, params, _ := strings.Cut(strings.TrimSpace(part), ";")
		if strings.EqualFold(strings.TrimSpace(enc), "gzip") && !strings.Contains(strings.ReplaceAll(params, " ", ""), "q=0") {
			return true
		}
	}
	return false
}

// compressWriter buffers the start of a JSON body to decide: below
// minCompressBytes it is written plain, otherwise the rest streams through
// gzip.
type compressWriter struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
	decided     bool
	eligible    bool
	buf         bytes.Buffer
	gz          *gzip.Writer
}

func (c *compressWriter) WriteHeader(status int) {
	if c.wroteHeader {
		return
	}
	c.wroteHeader = true
	c.status = status
	ct := c.Header().Get("Content-Type")
	c.eligible = status != http.StatusNoContent && status != http.StatusNotModified &&
		strings.HasPrefix(ct, "application/json") && c.Header().Get("Content-Encoding") == ""
	if !c.eligible {
		c.decided = true
		c.ResponseWriter.WriteHeader(status)
	}
}

func (c *compressWriter) Write(p []byte) (int, error) {
	if !c.wroteHeader {
		c.WriteHeader(http.StatusOK)
	}
	if c.decided {
		if c.gz != nil {
			return c.gz.Write(p)
		}
		return c.ResponseWriter.Write(p)
	}
	c.buf.Write(p)
	if c.buf.Len() >= minCompressBytes {
		c.startGzip()
	}
	return len(p), nil
}

func (c *compressWriter) startGzip() {
	c.decided = true
	h := c.Header()
	h.Set("Content-Encoding", "gzip")
	h.Del("Content-Length")
	c.ResponseWriter.WriteHeader(c.status)
	c.gz = gzipPool.Get().(*gzip.Writer)
	c.gz.Reset(c.ResponseWriter)
	_, _ = c.gz.Write(c.buf.Bytes())
	c.buf.Reset()
}

// finish flushes what is left: a small buffered body goes out plain.
func (c *compressWriter) finish() {
	if !c.wroteHeader {
		return
	}
	if !c.decided {
		c.ResponseWriter.WriteHeader(c.status)
		_, _ = c.ResponseWriter.Write(c.buf.Bytes())
		return
	}
	if c.gz != nil {
		_ = c.gz.Close()
		gzipPool.Put(c.gz)
	}
}

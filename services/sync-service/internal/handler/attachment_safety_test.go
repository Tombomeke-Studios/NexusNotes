package handler

import (
	"net/http/httptest"
	"strings"
	"testing"
)

var (
	pngHead    = []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR")
	htmlHead   = []byte("<!DOCTYPE html><html><script>alert(1)</script></html>")
	svgHead    = []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)
	svgXMLHead = []byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`)
	svgHTML    = []byte(`<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><html xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></html></foreignObject></svg>`)
	zipHead    = []byte("PK\x03\x04\x14\x00\x00\x00")
	pdfHead    = []byte("%PDF-1.7\n")
	junkHead   = []byte{0x00, 0x01, 0x02}
)

// notAllowlisted are types an attachment must never be stored or served as:
// documents that can run script (html, svg, every +xml flavour, js), plus
// formats that are merely not on the allowlist.
var notAllowlisted = []string{
	"text/html",
	"application/xhtml+xml",
	"text/xml",
	"application/xml",
	"image/svg+xml",
	"application/atom+xml",
	"application/rss+xml",
	"application/mathml+xml",
	"text/javascript",
	"application/javascript",
	"text/ecmascript",
	"application/ecmascript",
	"text/css",
	"application/json",
	"application/x-shockwave-flash",
	"multipart/x-mixed-replace",
	"image/avif",
	"image/x-icon",
	"application/octet-stream",
}

func TestResolveUploadType_TrustsTheSniffedImageOverTheDeclaredType(t *testing.T) {
	// A real PNG is stored as image/png whatever the client claims.
	if got := resolveUploadType("text/html", pngHead); got != "image/png" {
		t.Errorf("real PNG declared as html: got %q, want image/png", got)
	}
	if got := resolveUploadType("", pngHead); got != "image/png" {
		t.Errorf("real PNG with no declared type: got %q, want image/png", got)
	}
}

func TestResolveUploadType_RejectsSpoofedImageTypes(t *testing.T) {
	// HTML claiming to be an image must not keep the image type.
	if got := resolveUploadType("image/png", htmlHead); got != octetStream {
		t.Errorf("html declared as png: got %q, want %s", got, octetStream)
	}
}

func TestResolveUploadType_BinaryFormatsComeFromTheBytes(t *testing.T) {
	cases := []struct {
		name, declared string
		head           []byte
		want           string
	}{
		{"zip", "application/zip", zipHead, "application/zip"},
		{"zip declared the Windows way", "application/x-zip-compressed", zipHead, "application/zip"},
		{"pdf with parameters", "application/pdf; charset=binary", pdfHead, "application/pdf"},
		{"pdf with no declared type", "", pdfHead, "application/pdf"},
		{"pdf claim without pdf bytes", "application/pdf", htmlHead, octetStream},
		{"zip claim without zip bytes", "application/zip", junkHead, octetStream},
	}
	for _, c := range cases {
		if got := resolveUploadType(c.declared, c.head); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestResolveUploadType_KeepsDeclaredPlainTextTypes(t *testing.T) {
	// Plain text has no magic bytes; it is safe to keep because downloads are
	// always served with nosniff.
	for _, text := range []string{"text/plain", "text/markdown", "text/csv"} {
		if got := resolveUploadType(text+"; charset=utf-8", []byte("hello")); got != text {
			t.Errorf("declared %s: got %q", text, got)
		}
	}
}

func TestResolveUploadType_DefaultsGarbageToOpaqueBytes(t *testing.T) {
	for _, bad := range []string{"", "not a media type", "text/html\r\nX-Injected: 1"} {
		if got := resolveUploadType(bad, junkHead); got != octetStream {
			t.Errorf("declared %q: got %q, want %s", bad, got, octetStream)
		}
	}
}

func TestResolveUploadType_EverythingOffTheAllowlistIsNeutralised(t *testing.T) {
	for _, declared := range notAllowlisted {
		for _, head := range [][]byte{htmlHead, svgHead, junkHead} {
			if got := resolveUploadType(declared, head); got != octetStream {
				t.Errorf("declared %s with %q: got %q, want %s", declared, head[:3], got, octetStream)
			}
		}
	}
}

func TestResolveUploadType_SvgIsStoredAsOpaqueBytes(t *testing.T) {
	// An SVG is a script-capable document: opened as a page (or a blob URL) it
	// runs its script, so it never keeps its type, whatever it contains.
	for _, head := range [][]byte{svgHead, svgXMLHead, svgHTML} {
		for _, declared := range []string{"image/svg+xml", "", "image/png"} {
			if got := resolveUploadType(declared, head); got != octetStream {
				t.Errorf("svg declared %q: got %q, want %s", declared, got, octetStream)
			}
		}
	}
}

func TestResolveUploadType_OnlyReturnsServableTypes(t *testing.T) {
	// Whatever is stored must be served unchanged, so the two lists cannot drift.
	heads := [][]byte{pngHead, htmlHead, svgHead, zipHead, pdfHead, junkHead, []byte("hello")}
	declared := append([]string{"", "text/plain", "text/markdown", "text/csv", "image/png", "application/pdf"}, notAllowlisted...)
	for _, d := range declared {
		for _, head := range heads {
			stored := resolveUploadType(d, head)
			if served := servedType(stored); served != stored {
				t.Errorf("declared %q: stored %q but served as %q", d, stored, served)
			}
		}
	}
}

func TestSetAttachmentHeaders_AlwaysHardens(t *testing.T) {
	for _, mt := range []string{"image/png", "image/svg+xml", "application/pdf", "text/plain", "application/octet-stream"} {
		rec := httptest.NewRecorder()
		setAttachmentHeaders(rec.Header(), mt, "file.bin")
		h := rec.Header()
		if h.Get("X-Content-Type-Options") != "nosniff" {
			t.Errorf("%s: missing nosniff", mt)
		}
		csp := h.Get("Content-Security-Policy")
		if !strings.Contains(csp, "sandbox") || !strings.Contains(csp, "default-src 'none'") {
			t.Errorf("%s: CSP should sandbox and block all sources, got %q", mt, csp)
		}
	}
}

func TestSetAttachmentHeaders_OnlyRasterImagesAreInline(t *testing.T) {
	for _, mt := range []string{"image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"} {
		rec := httptest.NewRecorder()
		setAttachmentHeaders(rec.Header(), mt, "pic")
		if got := rec.Header().Get("Content-Disposition"); !strings.HasPrefix(got, "inline") {
			t.Errorf("%s should be inline, got %q", mt, got)
		}
	}

	for _, mt := range []string{"image/svg+xml", "application/pdf", "application/zip", "text/plain", "application/octet-stream"} {
		rec := httptest.NewRecorder()
		setAttachmentHeaders(rec.Header(), mt, "f")
		if got := rec.Header().Get("Content-Disposition"); !strings.HasPrefix(got, "attachment") {
			t.Errorf("%s should be served as attachment, got %q", mt, got)
		}
	}
}

func TestSetAttachmentHeaders_KeepsAllowlistedTypes(t *testing.T) {
	for _, mt := range []string{"image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "application/pdf", "application/zip", "text/plain", "text/markdown", "text/csv"} {
		rec := httptest.NewRecorder()
		setAttachmentHeaders(rec.Header(), mt+"; charset=utf-8", "f")
		if got := rec.Header().Get("Content-Type"); got != mt {
			t.Errorf("stored %s: Content-Type = %q, want %s", mt, got, mt)
		}
	}
}

func TestSetAttachmentHeaders_ServesLegacyRowsOffTheAllowlistAsOpaqueBytes(t *testing.T) {
	// Rows stored before the allowlist may still say svg, html, rss, ...; they
	// must be served as opaque bytes rather than as the stored type.
	for _, mt := range append([]string{"", "garbage"}, notAllowlisted...) {
		rec := httptest.NewRecorder()
		setAttachmentHeaders(rec.Header(), mt, "legacy")
		if got := rec.Header().Get("Content-Type"); got != octetStream {
			t.Errorf("legacy %q row: Content-Type = %q, want %s", mt, got, octetStream)
		}
		if got := rec.Header().Get("Content-Disposition"); !strings.HasPrefix(got, "attachment") {
			t.Errorf("legacy %q row should be an attachment, got %q", mt, got)
		}
	}
}

func TestSetAttachmentHeaders_FilenameCannotInjectHeaders(t *testing.T) {
	rec := httptest.NewRecorder()
	setAttachmentHeaders(rec.Header(), "application/zip", "evil\"\r\nSet-Cookie: x=1.zip")
	cd := rec.Header().Get("Content-Disposition")
	if strings.ContainsAny(cd, "\r\n") {
		t.Fatalf("header injection through the filename: %q", cd)
	}
	if rec.Header().Get("Set-Cookie") != "" {
		t.Fatal("filename injected a Set-Cookie header")
	}
}

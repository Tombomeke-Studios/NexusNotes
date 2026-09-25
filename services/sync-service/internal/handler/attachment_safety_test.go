package handler

import (
	"net/http/httptest"
	"strings"
	"testing"
)

var (
	pngHead  = []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR")
	htmlHead = []byte("<!DOCTYPE html><html><script>alert(1)</script></html>")
	svgHead  = []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)
	zipHead  = []byte("PK\x03\x04\x14\x00\x00\x00")
)

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
	if got := resolveUploadType("image/png", htmlHead); got != "application/octet-stream" {
		t.Errorf("html declared as png: got %q, want application/octet-stream", got)
	}
}

func TestResolveUploadType_KeepsPlainDeclaredTypesAndDefaultsGarbage(t *testing.T) {
	if got := resolveUploadType("application/zip", zipHead); got != "application/zip" {
		t.Errorf("zip: got %q", got)
	}
	if got := resolveUploadType("application/pdf; charset=binary", []byte("%PDF-1.7")); got != "application/pdf" {
		t.Errorf("parameters should be stripped: got %q", got)
	}
	for _, bad := range []string{"", "not a media type", "text/html\r\nX-Injected: 1"} {
		if got := resolveUploadType(bad, []byte{0x00, 0x01, 0x02}); got != "application/octet-stream" {
			t.Errorf("declared %q: got %q, want application/octet-stream", bad, got)
		}
	}
}

func TestResolveUploadType_ActiveDocumentTypesAreNeutralised(t *testing.T) {
	for _, active := range []string{"text/html", "application/xhtml+xml", "text/xml", "application/xml", "text/javascript", "application/javascript"} {
		if got := resolveUploadType(active, htmlHead); got != "application/octet-stream" {
			t.Errorf("declared %s: got %q, want application/octet-stream", active, got)
		}
	}
}

func TestResolveUploadType_SvgKeepsItsTypeSoInlinePreviewWorks(t *testing.T) {
	// SVG renders safely inside <img>; the download headers (below) stop it
	// running as a document. Its type must survive so the preview keeps working.
	if got := resolveUploadType("image/svg+xml", svgHead); got != "image/svg+xml" {
		t.Errorf("svg: got %q, want image/svg+xml", got)
	}
}

func TestSetAttachmentHeaders_AlwaysHardens(t *testing.T) {
	for _, mt := range []string{"image/png", "image/svg+xml", "application/pdf", "application/octet-stream"} {
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
	inline := httptest.NewRecorder()
	setAttachmentHeaders(inline.Header(), "image/png", "pic.png")
	if got := inline.Header().Get("Content-Disposition"); !strings.HasPrefix(got, "inline") {
		t.Errorf("png should be inline, got %q", got)
	}

	for _, mt := range []string{"image/svg+xml", "application/pdf", "application/zip", "application/octet-stream"} {
		rec := httptest.NewRecorder()
		setAttachmentHeaders(rec.Header(), mt, "f")
		if got := rec.Header().Get("Content-Disposition"); !strings.HasPrefix(got, "attachment") {
			t.Errorf("%s should be served as attachment, got %q", mt, got)
		}
	}
}

func TestSetAttachmentHeaders_ServesActiveTypesAsOpaqueBytes(t *testing.T) {
	// Even if a legacy row still says text/html, it must not be served as html.
	rec := httptest.NewRecorder()
	setAttachmentHeaders(rec.Header(), "text/html", "page.html")
	if got := rec.Header().Get("Content-Type"); got != "application/octet-stream" {
		t.Errorf("legacy html row: Content-Type = %q, want application/octet-stream", got)
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

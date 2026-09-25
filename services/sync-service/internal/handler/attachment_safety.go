package handler

import (
	"mime"
	"net/http"
	"strings"
)

const octetStream = "application/octet-stream"

// Attachments are stored and served only as one of a small allowlist of passive
// types; everything else (SVG, HTML, every +xml flavour, JavaScript, and any type
// not listed here) becomes application/octet-stream. An allowlist rather than a
// denylist, because the set of types a browser will run script in is open-ended.

// inlineImageTypes are the raster formats that are safe to display inline.
// http.DetectContentType recognises exactly these by their magic bytes.
var inlineImageTypes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/gif":  true,
	"image/webp": true,
	"image/bmp":  true,
}

// sniffedDocumentTypes are passive binary formats that are only stored when the
// file's own magic bytes say so (a claim alone is not enough).
var sniffedDocumentTypes = map[string]bool{
	"application/pdf": true,
	"application/zip": true,
}

// declaredTextTypes are plain-text formats with no magic bytes to check. They are
// kept when declared: every download carries nosniff, so a browser shows them as
// text whatever the bytes contain.
var declaredTextTypes = map[string]bool{
	"text/plain":    true,
	"text/markdown": true,
	"text/csv":      true,
}

// baseMediaType returns the lower-cased "type/subtype" of a Content-Type value
// without parameters, or "" when it is not a valid media type.
func baseMediaType(value string) string {
	mt, _, err := mime.ParseMediaType(value)
	if err != nil {
		return ""
	}
	return mt
}

// resolveUploadType decides the content type stored for an upload. The client's
// declared type is untrusted: raster images, PDF and ZIP are stored as what the
// file's bytes say whatever was declared, plain-text types are kept when
// declared, and everything else is stored as application/octet-stream.
func resolveUploadType(declared string, head []byte) string {
	sniffed := baseMediaType(http.DetectContentType(head))
	if inlineImageTypes[sniffed] || sniffedDocumentTypes[sniffed] {
		return sniffed
	}
	if decl := baseMediaType(declared); declaredTextTypes[decl] {
		return decl
	}
	return octetStream
}

// servedType maps a stored content type onto the allowlist. Uploads only ever
// store allowlisted types, but rows written before the allowlist may still say
// image/svg+xml or text/html; those are served as opaque bytes.
func servedType(mimeType string) string {
	mt := baseMediaType(mimeType)
	if inlineImageTypes[mt] || sniffedDocumentTypes[mt] || declaredTextTypes[mt] {
		return mt
	}
	return octetStream
}

// setAttachmentHeaders hardens a download response so a stored file can never be
// rendered as a same-origin document: an allowlisted content type, no MIME
// sniffing, a CSP that blocks every source and sandboxes the response, and
// "attachment" disposition for anything that is not a raster image.
func setAttachmentHeaders(h http.Header, mimeType, filename string) {
	mt := servedType(mimeType)
	disposition := "attachment"
	if inlineImageTypes[mt] {
		disposition = "inline"
	}
	value := mime.FormatMediaType(disposition, map[string]string{"filename": filename})
	if value == "" {
		value = disposition
	}
	h.Set("Content-Type", mt)
	h.Set("Content-Disposition", strings.TrimSpace(value))
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
}

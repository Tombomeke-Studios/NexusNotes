package handler

import (
	"mime"
	"net/http"
	"strings"
)

const octetStream = "application/octet-stream"

// inlineImageTypes are the raster formats that are safe to display inline.
// http.DetectContentType recognises exactly these by their magic bytes.
var inlineImageTypes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/gif":  true,
	"image/webp": true,
	"image/bmp":  true,
}

// activeTypes can run script or load resources when a browser renders them as a
// document, so an attachment must never be stored or served as one of these.
var activeTypes = map[string]bool{
	"text/html":              true,
	"application/xhtml+xml":  true,
	"text/xml":               true,
	"application/xml":        true,
	"text/javascript":        true,
	"application/javascript": true,
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
// declared type is untrusted: a real raster image is stored as what its bytes
// say, an image claim the bytes do not back up is downgraded, and active
// document types are neutralised. SVG keeps its type so inline previews still
// work; setAttachmentHeaders stops it running as a document on download.
func resolveUploadType(declared string, head []byte) string {
	if sniffed := baseMediaType(http.DetectContentType(head)); inlineImageTypes[sniffed] {
		return sniffed
	}
	decl := baseMediaType(declared)
	switch {
	case decl == "", inlineImageTypes[decl], activeTypes[decl]:
		return octetStream
	}
	return decl
}

// setAttachmentHeaders hardens a download response so a stored file can never be
// rendered as a same-origin document: no MIME sniffing, a CSP that blocks every
// source and sandboxes the response, and "attachment" disposition for anything
// that is not a raster image.
func setAttachmentHeaders(h http.Header, mimeType, filename string) {
	mt := baseMediaType(mimeType)
	if mt == "" || activeTypes[mt] {
		mt = octetStream
	}
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

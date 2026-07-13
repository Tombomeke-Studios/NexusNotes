// Package metrics defines the service's Prometheus instruments (#57) in one
// place so handlers, middleware and the WebSocket hub can share them without
// import cycles. Go runtime and process collectors come with the default
// registry for free.
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// HTTPRequests counts requests by route pattern (not raw path, to keep
	// label cardinality bounded), method and status class.
	HTTPRequests = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "nexusnotes_http_requests_total",
		Help: "HTTP requests by route pattern, method and status.",
	}, []string{"route", "method", "status"})

	// HTTPDuration observes request latency per route pattern.
	HTTPDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "nexusnotes_http_request_duration_seconds",
		Help:    "HTTP request latency by route pattern.",
		Buckets: prometheus.DefBuckets,
	}, []string{"route"})

	// WSConnections tracks currently connected WebSocket clients.
	WSConnections = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "nexusnotes_ws_connections",
		Help: "Currently connected WebSocket clients.",
	})

	// NoteOps counts note create/update/delete operations.
	NoteOps = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "nexusnotes_note_operations_total",
		Help: "Note operations by type.",
	}, []string{"op"})
)

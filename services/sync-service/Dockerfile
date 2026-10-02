FROM golang:1.25-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
# Release version reported by /health (repo-root VERSION file, passed by compose).
ARG VERSION=dev
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags "-X github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/buildinfo.Version=${VERSION}" \
    -o /sync-service ./cmd/server

FROM alpine:3.20

RUN apk --no-cache add ca-certificates \
    && addgroup -S -g 10001 nexus \
    && adduser -S -D -H -u 10001 -G nexus nexus

WORKDIR /app
COPY --from=builder /sync-service .
COPY migrations/ ./migrations/

# Run unprivileged (#327); the binary and migrations stay root-owned, read-only.
USER nexus:nexus

EXPOSE 8080

# Ready = able to reach the database (#327). busybox wget ships with alpine.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:${PORT:-8080}/ready || exit 1

CMD ["./sync-service"]

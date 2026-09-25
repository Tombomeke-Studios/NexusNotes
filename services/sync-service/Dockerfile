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

RUN apk --no-cache add ca-certificates

WORKDIR /app
COPY --from=builder /sync-service .
COPY migrations/ ./migrations/

EXPOSE 8080

CMD ["./sync-service"]

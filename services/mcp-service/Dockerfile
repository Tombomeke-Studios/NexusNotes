FROM golang:1.25-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /nexusnotes-mcp ./cmd/nexusnotes-mcp

FROM alpine:3.20

RUN apk --no-cache add ca-certificates \
    && addgroup -S -g 10001 nexus \
    && adduser -S -D -H -u 10001 -G nexus nexus

COPY --from=builder /nexusnotes-mcp /usr/local/bin/nexusnotes-mcp

USER nexus:nexus

# Streamable HTTP; every request brings its own MCP token.
ENV MCP_HTTP_ADDR=:8081
EXPOSE 8081

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8081/health || exit 1

ENTRYPOINT ["nexusnotes-mcp"]

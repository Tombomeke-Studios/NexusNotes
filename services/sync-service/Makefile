.PHONY: build test lint run migrate tidy

build:
	go build -o bin/sync-service ./cmd/server

test:
	go test -race ./...

lint:
	golangci-lint run

run:
	go run ./cmd/server

migrate:
	go run ./cmd/migrate

tidy:
	go mod tidy

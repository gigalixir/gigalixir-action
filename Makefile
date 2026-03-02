# Development commands using Docker

.PHONY: build dev shell test lint format all clean

# Build the development container
build:
	docker compose build dev

# Start a development shell
shell: build
	docker compose run --rm dev

# Run tests
test: build
	docker compose run --rm dev npm test

# Run linter
lint: build
	docker compose run --rm dev npm run lint

# Format code
format: build
	docker compose run --rm dev npm run format

# Check formatting
format-check: build
	docker compose run --rm dev npm run format:check

# Build the action (compile TypeScript)
build-action: build
	docker compose run --rm dev npm run build

# Run all checks (format, lint, test, build)
all: build
	docker compose run --rm dev npm run all

# Install/update dependencies
install: build
	docker compose run --rm dev npm install

# Clean up
clean:
	docker compose down --rmi local
	rm -rf node_modules dist coverage

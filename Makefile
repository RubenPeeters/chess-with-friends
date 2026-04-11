# ── Chess with Friends — developer shortcuts ──────────────────────────────────
# Usage: make <target>

.PHONY: up down restart build rebuild logs ps \
        migrate dev deploy caddy-reload

# ── Local stack ───────────────────────────────────────────────────────────────

## Start all services
up:
	docker compose up -d

## Stop all services
down:
	docker compose down

## Full down + up (fixes stale Docker Desktop WSL2 bind mounts)
restart:
	docker compose down && docker compose up -d

## Build without cache (all services)
build:
	docker compose build --no-cache

## Rebuild a single service and restart it, e.g. make rebuild svc=social
rebuild:
	docker compose build --no-cache $(svc) && docker compose up -d --no-deps $(svc)

## Reload Caddy config without restarting the container
caddy-reload:
	docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

## Tail logs for all services (or pass svc=api for a single one)
logs:
	docker compose logs -f $(svc)

## Show container status
ps:
	docker compose ps

# ── Database ──────────────────────────────────────────────────────────────────

## Apply any pending migrations. Idempotent — tracks applied files in the
## `_migrations` table, so it's safe to run on every deploy.
migrate:
	@./db/migrate.sh

# ── Frontend dev server ───────────────────────────────────────────────────────

## Start the Vite dev server
dev:
	cd frontend && npm run dev

# ── Deployment ────────────────────────────────────────────────────────────────

## Push to main and trigger CI/CD deploy
deploy:
	git push origin main

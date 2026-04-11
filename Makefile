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

## Apply all migrations in order
migrate:
	@for f in db/migrations/*.sql; do \
		echo "→ applying $$f"; \
		docker compose exec -T postgres psql -U chess -d chess -f /docker-entrypoint-initdb.d/$$(basename $$f); \
	done

## Run a database backup immediately (doesn't wait for the next cron tick)
backup-now:
	docker compose exec db-backup /app/backup.sh

## List recent backups in the S3 bucket
backup-list:
	docker compose exec db-backup sh -c 'AWS_ACCESS_KEY_ID="$$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$$S3_SECRET_KEY" AWS_DEFAULT_REGION="$$S3_REGION" aws s3 ls $${S3_ENDPOINT:+--endpoint-url=$$S3_ENDPOINT} "s3://$$S3_BUCKET/backups/" | sort'

# ── Frontend dev server ───────────────────────────────────────────────────────

## Start the Vite dev server
dev:
	cd frontend && npm run dev

# ── Deployment ────────────────────────────────────────────────────────────────

## Push to main and trigger CI/CD deploy
deploy:
	git push origin main

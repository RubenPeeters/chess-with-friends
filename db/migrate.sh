#!/usr/bin/env bash
#
# Apply any db/migrations/*.sql files that haven't already been recorded in
# the `_migrations` tracking table. Idempotent: already-applied files are
# skipped, so it's safe to run on every deploy.
#
# On the first run against an existing database, detects which of the
# historical migrations 001–004 have already been applied (based on the
# schema artifacts they create) and pre-seeds the tracking table so they
# aren't re-run.
#
# Designed to be run from the repo root, against the `postgres` container
# defined in docker-compose.yml. Example:
#
#     ./db/migrate.sh
#
set -euo pipefail

PSQL="docker compose exec -T postgres psql -U chess -d chess"

# ── 1. Tracking table + bootstrap for existing databases ─────────────────────
# Every branch below is idempotent: re-running the whole bootstrap costs
# nothing and won't duplicate rows (ON CONFLICT DO NOTHING).
$PSQL -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS _migrations (
    filename   TEXT        PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pre-seed historical migrations based on their distinguishing artifacts.
-- This only matters on the first run against a database that was
-- initialized before tracking existed — subsequent runs are no-ops.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'users') THEN
        INSERT INTO _migrations (filename) VALUES ('001_init.sql')
        ON CONFLICT DO NOTHING;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'invites'
                 AND column_name = 'addressee_id') THEN
        INSERT INTO _migrations (filename) VALUES ('002_invites_addressee.sql')
        ON CONFLICT DO NOTHING;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'rating_history') THEN
        INSERT INTO _migrations (filename) VALUES ('003_rating_history.sql')
        ON CONFLICT DO NOTHING;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'ratings'
                 AND column_name = 'game_type') THEN
        INSERT INTO _migrations (filename) VALUES ('004_ratings_per_type.sql')
        ON CONFLICT DO NOTHING;
    END IF;
END $$;
SQL

# ── 2. Apply any migration not yet in the tracking table ─────────────────────
for f in db/migrations/*.sql; do
    name=$(basename "$f")
    applied=$($PSQL -tAc "SELECT 1 FROM _migrations WHERE filename = '$name'" | tr -d '[:space:]')
    if [ -n "$applied" ]; then
        echo "✓ $name (already applied)"
        continue
    fi

    echo "→ applying $name"
    $PSQL -v ON_ERROR_STOP=1 -f "/docker-entrypoint-initdb.d/$name"
    $PSQL -v ON_ERROR_STOP=1 -c "INSERT INTO _migrations (filename) VALUES ('$name')"
done

echo "✓ migrations up to date"

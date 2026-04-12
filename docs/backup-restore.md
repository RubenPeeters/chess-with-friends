# Database backups & restore

## What gets backed up

The `db-backup` service (`services/db-backup/`) runs a daily `pg_dump` of the
whole `chess` database, gzips it, uploads it to
`s3://$S3_BUCKET/backups/chess-<UTC-timestamp>.sql.gz`, and prunes backups
older than `$BACKUP_KEEP_DAYS` (default 14 days).

The dump uses `--clean --if-exists`, so restoring it drops the existing
schema first — perfect for a clean recovery, destructive on a running DB.

## Configuration

All controlled via `.env` (see `.env.example`):

| Var | Default | Purpose |
|---|---|---|
| `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_ENDPOINT` | — | Target storage. `S3_ENDPOINT` is only set for B2 / other S3-compatible providers. |
| `BACKUP_SCHEDULE` | `0 3 * * *` | Cron expression (UTC). Default is 03:00 UTC daily. |
| `BACKUP_KEEP_DAYS` | `14` | Age cutoff for pruning. |
| `BACKUP_RUN_ON_STARTUP` | `0` | Set to `1` to run a backup immediately on container start (useful when testing). |

## Day-to-day

- **See recent backups**: `make backup-list`
- **Run one now**: `make backup-now`
- **Tail logs**: `make logs svc=db-backup`

## Restoring from a backup

This is destructive — it drops every table in the current database and
recreates them from the dump. **Always test in a staging environment
first.** On the live VPS, take a fresh manual backup before starting
(`make backup-now`) so you can get back to the current state if the
restore goes sideways.

### Step 1 — pick a backup

```bash
make backup-list
# 2026-04-11 03:00:00    12345  backups/chess-2026-04-11T03-00-00Z.sql.gz
# 2026-04-10 03:00:00    12123  backups/chess-2026-04-10T03-00-00Z.sql.gz
```

### Step 2 — download it locally

```bash
# From the repo root, inside the db-backup container:
docker compose exec -T db-backup sh -c '
  AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" \
  AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
  AWS_DEFAULT_REGION="$S3_REGION" \
  aws s3 cp ${S3_ENDPOINT:+"--endpoint-url=$S3_ENDPOINT"} \
    s3://$S3_BUCKET/backups/chess-2026-04-11T03-00-00Z.sql.gz -
' > /tmp/chess-restore.sql.gz
```

### Step 3 — stop app services (keep postgres running)

```bash
docker compose stop api game social
```

This prevents in-flight writes from interfering with the restore.

### Step 4 — pipe the dump into psql

```bash
gunzip -c /tmp/chess-restore.sql.gz | \
  docker compose exec -T postgres psql -U chess -d chess
```

`psql` will print errors as it drops / recreates tables — that's expected.
Look for the final exit status; if `psql` returns 0, the restore succeeded.

### Step 5 — start app services again

```bash
docker compose start api game social
```

### Step 6 — verify

- Hit `/api/social/history` for a known user and confirm the games list
  matches what you expect at the backup timestamp.
- Check `/api/social/friends` for a test user.
- `docker compose logs --tail=20 api game social` for any lingering errors.

## Disaster recovery from scratch

If the VPS itself is gone (new machine):

1. Provision a new VPS, install Docker, clone the repo, set `.env` with the
   same S3 credentials as the lost machine.
2. `docker compose up -d` — empty database boots.
3. Follow the restore procedure above with the latest S3 backup.
4. Point DNS at the new VPS.

## Troubleshooting

**"relation X already exists" during restore.** The dump uses `--clean
--if-exists`, which drops before creating, so this shouldn't happen unless
someone restored into a partially-initialised database. If it does, drop
the schema by hand first: `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`
and re-run the restore.

**Backups not uploading.** Check `make logs svc=db-backup`. Most likely
causes: wrong S3 credentials, wrong endpoint URL for B2, or postgres not
reachable (should never happen because the service has
`depends_on: { postgres: { condition: service_healthy } }`).

**Postgres client / server version mismatch.** The `db-backup` Dockerfile
pins `postgresql16-client` to match `postgres:16-alpine` from the main
compose file. If you bump the postgres image to 17+, update the Dockerfile
to match — `pg_dump` requires a client `>=` the server version.

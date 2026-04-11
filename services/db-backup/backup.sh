#!/usr/bin/env bash
#
# Dump the chess database, gzip it, upload to S3/B2, then prune backups older
# than ${BACKUP_KEEP_DAYS} (default: 14 days).
#
# Expects the following env vars (provided via docker-compose env_file / environment):
#   PGHOST, PGUSER, PGDATABASE, PGPASSWORD  — Postgres connection
#   S3_BUCKET, S3_REGION                    — target bucket
#   S3_ACCESS_KEY, S3_SECRET_KEY            — credentials (mapped to AWS_* below)
#   S3_ENDPOINT                             — optional, for B2 / other S3-compatible
#   BACKUP_KEEP_DAYS                        — optional, default 14
#
set -euo pipefail

KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
TIMESTAMP=$(date -u +%Y-%m-%dT%H-%M-%SZ)
DUMP_FILE="/tmp/chess-${TIMESTAMP}.sql.gz"
S3_KEY="backups/chess-${TIMESTAMP}.sql.gz"

# ── aws-cli env (no IAM roles here, just static creds) ────────────────────────
export AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY}"
export AWS_SECRET_ACCESS_KEY="${S3_SECRET_KEY}"
export AWS_DEFAULT_REGION="${S3_REGION}"

ENDPOINT_ARG=()
if [ -n "${S3_ENDPOINT:-}" ]; then
    ENDPOINT_ARG=(--endpoint-url="${S3_ENDPOINT}")
fi

# ── Dump ──────────────────────────────────────────────────────────────────────
echo "[backup] $(date -u +%FT%TZ) starting pg_dump"

pg_dump \
    --host="$PGHOST" \
    --username="$PGUSER" \
    --dbname="$PGDATABASE" \
    --no-owner \
    --no-privileges \
    --clean \
    --if-exists \
    --format=plain \
    | gzip -9 > "$DUMP_FILE"

SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo "[backup] dumped ${SIZE} — uploading to s3://${S3_BUCKET}/${S3_KEY}"

# ── Upload ────────────────────────────────────────────────────────────────────
aws s3 cp "${ENDPOINT_ARG[@]}" "$DUMP_FILE" "s3://${S3_BUCKET}/${S3_KEY}"
rm -f "$DUMP_FILE"

# ── Prune backups older than KEEP_DAYS ────────────────────────────────────────
# Filename format: chess-YYYY-MM-DDTHH-MM-SSZ.sql.gz  (the T delimiter and the
# hyphen-separated time are ISO-8601 with colons replaced so the filename is
# cross-filesystem-safe). We reconstruct the real ISO timestamp and compare to
# a cutoff epoch.
CUTOFF_EPOCH=$(date -u -d "${KEEP_DAYS} days ago" +%s)
echo "[backup] pruning backups older than ${KEEP_DAYS} days (< $(date -u -d @${CUTOFF_EPOCH} +%FT%TZ))"

aws s3 ls "${ENDPOINT_ARG[@]}" "s3://${S3_BUCKET}/backups/" | while read -r LINE; do
    KEY=$(echo "$LINE" | awk '{print $4}')
    [ -z "$KEY" ] && continue

    # Extract "2026-04-11T19-00-00Z" from "chess-2026-04-11T19-00-00Z.sql.gz"
    TS=$(echo "$KEY" | sed -n 's/^chess-\(.*\)\.sql\.gz$/\1/p')
    [ -z "$TS" ] && continue

    # Convert to proper ISO by replacing hyphens in the time portion with colons
    ISO=$(echo "$TS" | sed 's/T\([0-9]\{2\}\)-\([0-9]\{2\}\)-\([0-9]\{2\}\)Z/T\1:\2:\3Z/')
    FILE_EPOCH=$(date -u -d "$ISO" +%s 2>/dev/null || echo 0)
    [ "$FILE_EPOCH" -eq 0 ] && continue

    if [ "$FILE_EPOCH" -lt "$CUTOFF_EPOCH" ]; then
        echo "[backup] deleting old backup: $KEY"
        aws s3 rm "${ENDPOINT_ARG[@]}" "s3://${S3_BUCKET}/backups/${KEY}"
    fi
done

echo "[backup] $(date -u +%FT%TZ) done"

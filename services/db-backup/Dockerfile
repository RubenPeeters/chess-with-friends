# ── Chess-with-friends database backup container ──────────────────────────────
# Runs pg_dump + gzip + aws s3 cp on a cron schedule, then prunes old backups.
# Keeps postgres-client pinned to the same major version as the postgres service
# (16) because pg_dump requires a client >= server version.

FROM alpine:3.19

RUN apk add --no-cache \
        bash \
        postgresql16-client \
        aws-cli \
        tzdata \
        coreutils

WORKDIR /app

COPY backup.sh entrypoint.sh ./
RUN chmod +x backup.sh entrypoint.sh

# Crond is busybox in alpine — read from /var/spool/cron/crontabs/root.
# The entrypoint writes the schedule there at startup.
ENTRYPOINT ["./entrypoint.sh"]

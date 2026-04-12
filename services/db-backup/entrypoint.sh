#!/usr/bin/env bash
#
# Container entrypoint: installs the cron schedule, optionally runs a backup
# immediately, then runs crond in the foreground so the container stays up.
#
set -euo pipefail

SCHEDULE="${BACKUP_SCHEDULE:-0 3 * * *}"  # default: daily at 03:00 UTC
LOG_FILE="/var/log/backup.log"

echo "[entrypoint] scheduling backups: ${SCHEDULE}"

# Busybox crond in alpine reads /var/spool/cron/crontabs/root
mkdir -p /var/spool/cron/crontabs
# Env vars aren't inherited into cron jobs — write them into the crontab
# directly so the backup script sees them.
{
    env | grep -E '^(PG|S3_|BACKUP_)' | sed 's/^/export /'
    echo ""
    echo "${SCHEDULE} . /etc/profile.d/env.sh; /app/backup.sh >> ${LOG_FILE} 2>&1"
} > /tmp/crontab

# Move env exports to a profile script the cron job can source.
# `|| true` prevents set -e from aborting if no matching lines exist
# (e.g. misconfigured compose with no PG/S3/BACKUP vars).
mkdir -p /etc/profile.d
grep '^export ' /tmp/crontab > /etc/profile.d/env.sh || true
grep -v '^export ' /tmp/crontab > /var/spool/cron/crontabs/root

touch "$LOG_FILE"

if [ "${BACKUP_RUN_ON_STARTUP:-0}" = "1" ]; then
    echo "[entrypoint] running backup once at startup (BACKUP_RUN_ON_STARTUP=1)"
    /app/backup.sh || echo "[entrypoint] startup backup failed — crond will still start"
fi

echo "[entrypoint] starting crond"
crond -f -l 8 &
CROND_PID=$!

# Tail the log so `docker logs db-backup` shows backup output
tail -F "$LOG_FILE" &
TAIL_PID=$!

# Forward signals to crond for clean shutdown
trap "kill -TERM $CROND_PID $TAIL_PID 2>/dev/null; exit 0" TERM INT
wait $CROND_PID

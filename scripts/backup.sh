#!/usr/bin/env bash
# Backup: one database dump contains everything (records, audit log, uploaded evidence and logo).
# Schedule with cron, e.g.  0 2 * * *  /path/to/isss-finance/scripts/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && source .env
STAMP=$(date +%Y%m%d-%H%M%S)
DEST=${BACKUP_DIR:-./backups}
mkdir -p "$DEST"
pg_dump --format=custom --no-owner "$DATABASE_URL" > "$DEST/isss-finance-$STAMP.dump"
find "$DEST" -name 'isss-finance-*.dump' -mtime +${BACKUP_KEEP_DAYS:-30} -delete
echo "Backup written to $DEST/isss-finance-$STAMP.dump. Copy it off this machine (e.g. Google Drive)."

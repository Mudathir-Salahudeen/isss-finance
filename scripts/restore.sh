#!/usr/bin/env bash
# Restore a backup made by backup.sh.  Usage: scripts/restore.sh backups/isss-finance-XXXX.dump
# WARNING: replaces the current database contents.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && source .env
[ -f "${1:-}" ] || { echo "Dump file not found: ${1:-}"; exit 1; }
read -p "This will REPLACE all data in the database. Type RESTORE to continue: " ok
[ "$ok" = "RESTORE" ] || exit 1
pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" "$1"
echo "Restore complete. Open the app and check the audit log and latest receipts."

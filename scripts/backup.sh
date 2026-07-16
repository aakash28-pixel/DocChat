#!/usr/bin/env bash
# Back up the backend's persistent data: uploaded PDFs + the ChromaDB index.
# (Postgres is backed up automatically by Supabase — nothing to do here.)
#
# Run on the server, e.g. nightly via cron:
#   0 3 * * *  /app/scripts/backup.sh >> /var/log/docchat-backup.log 2>&1
#
# Optionally set S3_BUCKET (and have `aws` configured) to push offsite.
set -euo pipefail

DATA_DIR="${DATA_DIR:-/data}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
archive="$BACKUP_DIR/docchat-data-$stamp.tar.gz"

echo "[$(date)] backing up $DATA_DIR → $archive"
tar -czf "$archive" -C "$DATA_DIR" .

# offsite copy (optional)
if [ -n "${S3_BUCKET:-}" ]; then
  echo "[$(date)] uploading to s3://$S3_BUCKET/"
  aws s3 cp "$archive" "s3://$S3_BUCKET/"
fi

# prune old local backups
find "$BACKUP_DIR" -name 'docchat-data-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete
echo "[$(date)] done. kept last $RETENTION_DAYS days."

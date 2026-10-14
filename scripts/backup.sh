#!/usr/bin/env sh
# Daily MySQL backup for YASH MOBILE POS (Linux server). Add to cron: 30 23 * * * /opt/yash-pos/scripts/backup.sh
set -eu
DB="${DB_NAME:-yash_pos}"
OUT="${BACKUP_DIR:-$(dirname "$0")/../backups}"
KEEP="${KEEP_DAYS:-30}"
mkdir -p "$OUT"
STAMP=$(date +%Y%m%d-%H%M%S)
# credentials from ~/.my.cnf ([mysqldump] user=... password=...), never on the command line
mysqldump --single-transaction --routines --triggers --default-character-set=utf8mb4 "$DB" | gzip > "$OUT/$DB-$STAMP.sql.gz"
tar -czf "$OUT/uploads-$STAMP.tar.gz" -C "$(dirname "$0")/../server" uploads 2>/dev/null || true
find "$OUT" -type f -mtime +"$KEEP" -delete
echo "Backup written: $OUT/$DB-$STAMP.sql.gz"

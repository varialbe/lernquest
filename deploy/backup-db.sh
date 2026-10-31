#!/usr/bin/env bash
# Konsistentes SQLite-Backup (auch im laufenden Betrieb, WAL) nach ~/backups, 14 Tage Rotation.
set -euo pipefail
DB="${DATABASE_PATH:-$HOME/lernquest/data/lernquest.db}"
DEST="$HOME/backups/lernquest"
mkdir -p "$DEST"
OUT="$DEST/lernquest-$(date +%Y%m%d-%H%M%S).db"
sqlite3 "$DB" ".backup '$OUT'"
sqlite3 "$OUT" "pragma integrity_check" | grep -qx ok
gzip -9 "$OUT"
find "$DEST" -name 'lernquest-*.db.gz' -mtime +14 -delete
echo "Backup: $OUT.gz ($(du -h "$OUT.gz" | cut -f1))"

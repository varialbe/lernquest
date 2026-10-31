#!/usr/bin/env bash
# Verschlüsselte Kopie außer Haus: privates Repo varialbe/lernquest-backups, jede Version = ein Commit.
#  täglich:  lernquest.tar.age  (neuestes DB-Backup, .env, CREDENTIALS.local.md)
#  sonntags: n8n.tar.age        (n8n-Datenbank + Konfiguration inkl. Verschlüsselungsschlüssel)
# Verschlüsselt mit age an den öffentlichen Schlüssel; den privaten Schlüssel hast du außerhalb des Servers.
set -euo pipefail
ROOT="${LERNQUEST_ROOT:-$HOME/lernquest}"
LOCAL="$HOME/backups/lernquest"
REPO="${BACKUP_REPO_DIR:-$HOME/backups/lernquest-offsite}"
RECIPIENT="${BACKUP_AGE_RECIPIENT_FILE:-$HOME/.config/lernquest/backup-age.pub}"
N8N_VOLUME="${N8N_VOLUME:-n8n_n8n_data}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
STAMP="$(date +%F)"

# --- LernQuest: DB + Secrets ---
DB="$(ls -t "$LOCAL"/lernquest-*.db.gz | head -1)"
mkdir -p "$TMP/lernquest"
cp "$DB" "$TMP/lernquest/lernquest.db.gz"
cp "$ROOT/.env" "$TMP/lernquest/env"
[ -f "$ROOT/CREDENTIALS.local.md" ] && cp "$ROOT/CREDENTIALS.local.md" "$TMP/lernquest/"
printf 'Erstellt: %s\nDB-Backup: %s\n' "$(date -Is)" "$(basename "$DB")" > "$TMP/lernquest/INFO.txt"
tar -C "$TMP" -czf "$TMP/lernquest.tar.gz" lernquest
age -R "$RECIPIENT" -o "$REPO/lernquest.tar.age" "$TMP/lernquest.tar.gz"

# --- n8n: wöchentlich (oder wenn noch keine Kopie existiert) ---
if [ "$(date +%u)" = 7 ] || [ ! -f "$REPO/n8n.tar.age" ]; then
  DATA="$(docker volume inspect -f '{{ .Mountpoint }}' "$N8N_VOLUME")"
  mkdir -p "$TMP/n8n"
  # SQLite konsistent sichern (n8n läuft weiter), den Rest des Volumes ohne die Live-DB-Dateien
  sudo -n sqlite3 "$DATA/database.sqlite" ".backup '$TMP/n8n/database.sqlite'"
  sudo -n tar -C "$DATA" --exclude='database.sqlite*' -cf - . | tar -C "$TMP/n8n" -xf -
  sudo -n chown -R "$(id -u):$(id -g)" "$TMP/n8n"
  tar -C "$TMP" -czf "$TMP/n8n.tar.gz" n8n
  age -R "$RECIPIENT" -o "$REPO/n8n.tar.age" "$TMP/n8n.tar.gz"
fi

# --- versionieren + hochladen ---
cd "$REPO"
{
  echo "# LernQuest-Backups (verschlüsselt)"
  echo
  echo "Letzte Sicherung: $STAMP. Jede Version ist ein Commit (\`git log\`). Wiederherstellen: siehe README im Repo varialbe/lernquest, Abschnitt „Backups“."
  echo
  echo "| Datei | Größe | Stand |"
  echo "|---|---|---|"
  for f in lernquest.tar.age n8n.tar.age; do
    [ -f "$f" ] && echo "| \`$f\` | $(du -h "$f" | cut -f1) | $(date -r "$f" +%F) |"
  done
} > README.md
git add -A
git diff --cached --quiet || git commit -qm "backup $STAMP"
git push -q origin HEAD:main
echo "Offsite-Backup $STAMP: $(du -h lernquest.tar.age | cut -f1) LernQuest, $(du -h n8n.tar.age | cut -f1) n8n → github.com/varialbe/lernquest-backups"

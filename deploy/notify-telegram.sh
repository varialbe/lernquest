#!/usr/bin/env bash
# Kurze Telegram-Nachricht (für systemd OnFailure=). Ohne Token/Chat-ID: nur ins Journal.
set -uo pipefail
MSG="${1:-LernQuest: unbekannter Fehler}"
if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
  echo "Telegram nicht konfiguriert: $MSG" >&2
  exit 0
fi
curl -fsS -m 20 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=${MSG}" >/dev/null || echo "Telegram-Versand fehlgeschlagen: $MSG" >&2

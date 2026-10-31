# n8n – „LernQuest Nightly“

n8n läuft per Docker Compose, **nur auf `127.0.0.1:5678`** (Host-Netzwerk + `N8N_LISTEN_ADDRESS=127.0.0.1`), Zeitzone Europe/Berlin, Daten im Volume `n8n_n8n_data`.

## Zugriff (SSH-Tunnel)
```bash
ssh -N -L 5678:127.0.0.1:5678 varialbe@varialbe.xyz
# dann im Browser: http://localhost:5678
```
Login: siehe `~/lernquest/CREDENTIALS.local.md` auf dem Server (chmod 600, nicht im Git).

## Starten / Aktualisieren
```bash
cd ~/lernquest/n8n
docker compose --env-file ../.env up -d      # PIPELINE_TOKEN kommt aus ../.env
docker compose --env-file ../.env pull && docker compose --env-file ../.env up -d   # Update
```

## Workflow
`workflows/lernquest-nightly.json`:

```
Jede Nacht 00:00 ─┐
Manuell testen ───┴─► Lauf starten (POST /run) ─► Gestartet? ──nein──► Trigger-Fehler melden (POST /notify)
                                                     │ja (202, oder 409 = läuft schon → diesen Lauf beobachten)
                                                     ▼
                                   ┌──► 60 s warten ─► Status abfragen (GET /status/:runId) ─► Fertig? ──ja──► Ergebnis
                                   │                                                            │nein
                                   └──────────────nein──────── Zu lange (> 6 h)? ◄──────────────┘
                                                                     │ja
                                                                     ▼
                                                               Timeout melden
```

Die **Telegram-Zusammenfassung** (Status, Notizen, Level/Fragen, Fehler, Dauer, Tokens) schickt die Pipeline selbst am Ende jedes Laufs. n8n meldet nur Fehler, die die Pipeline selbst nicht melden kann (Trigger nicht erreichbar, Lauf hängt). `POST /notify` sendet per Telegram bzw. – ohne `TELEGRAM_CHAT_ID` – in die Admin-Notification-Tabelle der App.

### Import (z. B. nach Neuinstallation)
```bash
docker exec lernquest-n8n n8n import:workflow --input=/workflows/lernquest-nightly.json
docker exec lernquest-n8n n8n publish:workflow --id=lernquestNightly01
docker restart lernquest-n8n
```

### Export (nach Änderungen in der UI)
```bash
docker exec lernquest-n8n n8n export:workflow --id=lernquestNightly01 --pretty --output=/tmp/wf.json
docker cp lernquest-n8n:/tmp/wf.json ~/lernquest/n8n/workflows/lernquest-nightly.json
```

### Manuell testen
In der UI den Workflow öffnen → „Execute workflow“ (startet am Knoten „Manuell testen“).

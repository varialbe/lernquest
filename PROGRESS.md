# LernQuest – Fortschritt

> Neue Session? Lies `PLAN.md` und diese Datei. Code wird lokal (Windows, `C:\Users\Ali Massad\lernquest`) bearbeitet und per `tar | ssh` nach `~/lernquest` auf dem VPS gespiegelt; **git, Builds, Tests und Dienste laufen nur auf dem VPS**. `content/`, `data/` und `.env` existieren ausschließlich auf dem VPS.

## 👉 Was du tun musst
1. **Telegram-Chat-ID**: Die angegebene ID `9191502090` ist die ID des Bots selbst (steht vorne im Token) – Telegram lehnt das ab („bot can't send messages to the bot“). So geht's:
   - In Telegram **@lernquest_bot** öffnen und **/start** senden (oder den Bot in einen Kanal/eine Gruppe aufnehmen und dort etwas posten).
   - Auf dem Server: `cd ~/lernquest && pnpm pipeline telegram-setup` – liest die Chat-ID einmalig aus, trägt sie in `.env` ein und schickt eine Testnachricht.
   - Bis dahin landen alle Zusammenfassungen in der Admin-Notification-Tabelle (sichtbar im Admin-Bereich der App).
2. Den Bot-Token hast du im Chat geteilt – wenn du auf Nummer sicher gehen willst: bei @BotFather `/revoke` und den neuen Token in `~/lernquest/.env` (`TELEGRAM_BOT_TOKEN=`) eintragen.

## Stand
- Phase 0 ✔
- Phase 2 ✔ – n8n 2.45.7 läuft (127.0.0.1:5678, ~450 MB), Owner angelegt (Zugang in `CREDENTIALS.local.md`), Workflow „LernQuest Nightly“ importiert + aktiv.
- Phase 1 ✔ – Pipeline inkl. Obsidian-Parser, Konzeptgraph, Telegram-Reports, Watchdog. 17 Pipeline- + 8 Shared-Tests grün. Echtlauf DS VO1: 44 Fragen in 3:38 min (alle mit gültiger Überschrift, 3 Diagramm-Fragen). Dienst `lernquest-pipeline` aktiv (≈100 MB RSS), Timer `lernquest-watchdog.timer` (00:30) aktiv.

## Entscheidungen
- **Laufzeit TS ohne Build**: API/Pipeline laufen per `tsx` (kein Compile-Schritt).
- **Eine SQLite-DB** (`data/lernquest.db`, WAL) für API und Pipeline; Drizzle-Migrationen in `apps/api/drizzle/`, beim Öffnen angewandt.
- **Stabile IDs vergibt die Pipeline**, nicht Codex: `ds-01`, `ds-01-l2`, `ds-01-l2-q05`. Optionen deterministisch gemischt (Seed = Frage-ID).
- **Unit-Nummer** = nächste freie Nummer im Modul (chronologisch verarbeitet), nicht die VO-Nummer aus dem Dateinamen (robust gegen „VO2 (ZÜ)“, Tippfehler-Dateien).
- **Nur `*.md`** in `<Modul>/01_Vorlesungen/` gilt als Vorlesung; Bilder/Anhänge/`.obsidian` werden nie als „neu“ gewertet.
- **Bilder**: vorhandene, ≥3 KB, beschriftete Bilder gehen an `codex -i` (SVG→PNG via sharp, max. 8). `![[Pasted image …]]` sind im Studium-Repo nicht committet → im Report als „Bild fehlt im Studium-Repo“ markiert (⚑).
- **LaTeX-Reparatur**: verlorene Backslashes (`\f`rac, `\t`imes, `\n`eg …) werden deterministisch repariert, bevor Zod validiert.
- **Umbenennung**: gleicher sha256 → nur Pfad aktualisieren. Umbenennung mit geändertem Inhalt einer bereits verarbeiteten Datei = Änderung (→ `REGENERATE_ON_MODIFY`), sonst neu.
- **Fehlgeschlagene Dateien** werden in späteren Läufen erneut versucht (max. 3×), danach nur per `regenerate`.
- **Rate-Limit von Codex**: wird erkannt (429/„usage limit“/…), kein Retry, Lauf stoppt, restliche Dateien folgen im nächsten Lauf; zählt nicht als Fehlversuch; Telegram-Nachricht mit 🚦.
- **Benachrichtigung**: Pipeline schickt nach jedem Lauf selbst die Telegram-Zusammenfassung (Status, Notizen, Level/Fragen, Fehler, Dauer, Tokens). Warnungen/Fehler zusätzlich in der Admin-Tabelle. n8n nutzt `POST /notify` des Trigger-Dienstes nur für eigene Fehlerpfade (Trigger nicht erreichbar, Timeout). Statt E-Mail/SMTP (Wunsch vom 31.10.).
- **Trigger-Dienst** startet Läufe als losgelöste Kindprozesse (`KillMode=process`), damit ein Dienst-Neustart laufende Generierungen nicht abbricht. Verwaiste „running“-Läufe werden beim Start als abgebrochen markiert.
- **n8n mit `network_mode: host`** und `N8N_LISTEN_ADDRESS=127.0.0.1` statt `host-gateway`: so muss der Pipeline-Trigger nur auf 127.0.0.1 lauschen.

## Nächster Schritt
- Phase 3: Backend. (Backfill läuft in tmux `lq-backfill`, Log `data/backfill.log`.) n8n-Testlauf über den manuellen Trigger folgt in Phase 7.

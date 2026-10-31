# LernQuest – Fortschritt

> Neue Session? Lies `PLAN.md` und diese Datei. **Quelle der Wahrheit ist das Git-Repo `~/lernquest` auf dem VPS** (gepusht nach `varialbe/lernquest`). Dort laufen git, Builds, Tests und Dienste. Die lokale Kopie unter `C:\Users\Ali Massad\lernquest` ist nur ein Spiegel (`git archive`-Stand), kein Repo. `.env`, `data/` und `CREDENTIALS.local.md` existieren nur auf dem VPS.

## 👉 Was du tun musst
1. ~~Telegram-Chat-ID~~ ✔ erledigt am 31.10. (Chat „Ray“, `pnpm pipeline telegram-setup`, Dienst neu gestartet).
2. Den Bot-Token hast du im Chat geteilt – wenn du auf Nummer sicher gehen willst: bei @BotFather `/revoke` und den neuen Token in `~/lernquest/.env` (`TELEGRAM_BOT_TOKEN=`) eintragen.

## Stand (31.10.2026) – alle Phasen abgeschlossen
- Nachtrag 31.10. (Wunsch „einmal richtig kompilieren“): Üben-Hub mit Schwächen (Konzept-Trefferquoten), Klausur-Check (20 Fragen, Timer, Note), asynchronen Duellen, Tagesaufgaben. Push für neue Units (ab 08:00) und Duelle. iOS: Live-Updates (selbst gehostet), lokale Erinnerungen, Haptik, Statusleiste. 68 Tests grün (12 shared, 37 API, 19 Pipeline), Feature-Screenshots hell/dunkel geprüft. Migration 0001 (rein additiv, Backup davor in `~/backups/lernquest/pre-migration-0001-*.db`).
- Phase 7 ✔: Backfill aller 18 Vorlesungen (DS 6, EIP 5, ERA 7), 0 Fehler, je 44–45 Fragen + Praxis-Level (10–12 Fragen, davon 3 Schätzfragen). 976 aktive Fragen. n8n-Testlauf über „Manuell testen“ (`n8n execute`): Trigger → Lauf → Status-Polling → Ergebnis „nichts Neues“, Telegram-Nachricht gesendet. README mit Betrieb, Troubleshooting, Fragetyp, Modell, Praxis-Bereich.
- Phase 6 ✔: Capacitor-iOS (SPM), Workflow `ios-ipa.yml` (manuell oder Tag `v*`). Testlauf am 31.10. grün: unsignierte IPA 9,3 MB (Info.plist, AppIcon, Web-Build inkl. Assets, API-Basis `https://lern.varialbe.xyz`). Sideloading: `docs/ios-sideloading.md`.
- Phase 5 ✔: https://lern.varialbe.xyz live. Eigene vhosts `lernquest.conf` + `lernquest-le-ssl.conf`, Zertifikat per webroot (Renew-Hook nur für dieses Zertifikat), Brotli, HSTS, CSP, Cache-Header. Backup-Timer 03:30 → `~/backups/lernquest` (14 Tage). Apache-Backup vor der Änderung: `~/backups/apache2-before-lernquest-*.tgz`. `/ai/` weiterhin 200.
- Phase 4 ✔: Frontend inkl. Praxis-Tab und Schätz-Regler. 51 generierte Grafiken (Maskottchen Lumo in 6 Posen, 8 Pets × 3 Stufen, Accessoires, Items, Badges) per Kontaktabzug geprüft, App-Icons (PWA, maskable, Apple-Touch, iOS). Playwright: 10 Screenshot-Tests hell/dunkel (inkl. Praxis + Regler, kein horizontaler Overflow) und E2E-Flow grün.
- Phase 3 ✔: API (Fastify, 127.0.0.1:3460) als `lernquest-api`. 31 API-Tests grün. Seed: Admin `admin`, `testuser`, Einladungscode (am 31.10. `mateen` zum normalen Spieler gemacht) (Zugang in `CREDENTIALS.local.md`).
- Phase 2 ✔: n8n 2.45.7 (127.0.0.1:5678), Workflow „LernQuest Nightly“ aktiv (00:00 Europe/Berlin).
- Phase 1 ✔: Pipeline inkl. Obsidian-Parser, Konzeptgraph, Praxis-Level, Telegram-Reports, Watchdog (00:30). 19 Pipeline- + 12 Shared-Tests grün.
- Phase 0 ✔
- **Ressourcen** (31.10., Ruhezustand): API ≈ 80 MB, Trigger-Dienst ≈ 40 MB, n8n ≈ 330 MB, zusammen ≈ 450 MB (Ziel < 2 GB). RAM gesamt 2,0 / 11 GiB belegt. Disk: data 17 MB, Web 10 MB.

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
- **Assets**: Codex-Imagegen speichert Bilder in `~/.codex/generated_images` (Schreiben ins Arbeitsverzeichnis scheitert an der Sandbox) – `scripts/gen-assets.mjs` übernimmt jeweils das neueste Bild, trimmt, skaliert, WebP. Eigenes Maskottchen „Lumo“ (lavendelfarbene Würfel-Kreatur); Pet „Lambda“ ist ein Chamäleon statt Eulen-Küken (keine Eule → kein Duolingo-Klon).
- **Abschnitts-Link** zeigt auf `SOURCE_LINK_BASE` (Standard: GitHub-Ansicht des privaten Studium-Repos + Überschriften-Anker). Freunde ohne Repo-Zugriff sehen dort nichts – der Abschnittsname steht trotzdem in der App.
- **n8n mit `network_mode: host`** und `N8N_LISTEN_ADDRESS=127.0.0.1` statt `host-gateway`: so muss der Pipeline-Trigger nur auf 127.0.0.1 lauschen.

- **Antworten im Client**: Level-Payload enthält die richtigen Antworten (sofortiges Feedback, Offline-Spielen). Gewertet wird trotzdem nur serverseitig: Der Client schickt die Erstversuch-Auswahl aller Fragen, der Server prüft gegen die DB und berechnet XP/Coins/Streak. Unvollständige Abgaben werden abgelehnt.
- **Passwort-Reset**: Admin erzeugt ein temporäres Passwort (einmalig angezeigt), alle Sessions werden widerrufen, Nutzer muss beim nächsten Login ein neues setzen.
- **Achievements** werden aus Statistiken berechnet (keine eigene Tabelle), **Freundesliste** entfällt (geschlossene Gruppe = alle sehen sich).
- **Liga**: Tiers Bronze→Diamant, Auswertung der Vorwoche beim ersten Request/Tick nach Montag 00:00 Berlin (genau einmal, `league_weeks`).
- **Praxis-Level**: eigene Level-Art `bonus` statt eigenem Datenmodell. Fortschritt, Leitner, Meldungen und Admin funktionieren dadurch unverändert. Nicht im Lernpfad und nicht in „Modul abgeschlossen“. Schätzfragen werden gleichmäßig im Level verteilt, weil Codex sie sonst ans Ende stellt.
- **Schätzfragen-Toleranz** prüft Zod hart (Antwort im Bereich, Toleranz ≤ ⅓ der Spanne, linear ≤ 400 Schritte, log nur mit `min > 0`). Sonst wären Fragen „immer richtig“ oder nicht treffbar.
- **Code-Highlighting** über eigenes Mini-Rehype-Plugin auf `lowlight` mit nur java/c/python/bash/asm (rehype-highlight bündelt immer ~37 Sprachen).
- **PWA-Icons unter `/app-icons/`**: Apache hat global `Alias /icons/` (autoindex). Die globale Konfiguration bleibt unangetastet.
- **Runden statt freier Abgaben**: Schwächen, Klausur-Check und Duelle laufen über `quiz_runs`. Der Server legt die Fragen fest und wertet genau einmal, sonst könnte man (Antworten liegen im Client) beliebig XP farmen. Zusätzlich Tageslimits für Belohnungen.
- **Live-Updates selbst gehostet** (capgo-Plugin, manueller Modus) statt Capgo-Cloud: keine Fremdabhängigkeit, Manifest über die API wegen CORS. Prüfsumme wird nicht an das Plugin übergeben (Format plugin-versionsabhängig, ein Fehler würde jedes Update blockieren); Integrität über HTTPS.
- **Lokale statt Server-Push in der iOS-App**: Sideloading mit kostenloser Apple-ID erlaubt kein APNs.
- **Offsite-Backups** ins private Repo `varialbe/lernquest-backups`, mit `age` verschlüsselt (öffentlicher Schlüssel auf dem Server reicht zum Verschlüsseln). n8n nur wöchentlich, damit das Repo klein bleibt (ca. 250 KB pro Tag). Wiederherstellung am 31.10. getestet: frischer Klon, entschlüsselt, alle Tabellen identisch mit live.
- **Mermaid wird mit precacht** (≈ 9 MB Precache, einmalig im Hintergrund), damit Diagramm-Fragen offline funktionieren.

## Offene Punkte / Ideen
- **Backup-Schlüssel sichern:** `~/.config/lernquest/backup-age.key` gehört zusätzlich in deinen Passwort-Manager (`ssh varialbe@varialbe.xyz cat ~/.config/lernquest/backup-age.key`). Ohne ihn sind die Offsite-Backups unbrauchbar.
- Duell-Benachrichtigungen kommen nur per Web-Push (PWA). In der iOS-App sieht man offene Duelle beim Öffnen (Badge im Üben-Hub); echte Pushs bräuchten APNs und damit einen bezahlten Account.
- Live-Update-Pfad auf einem echten iPhone noch nicht beobachtet (kein Gerät hier). Prüfen: Nach einem Deploy zeigt Profil → „App-Version“ beim übernächsten Öffnen den neuen Commit-Hash.
- Optional: Bot-Token rotieren (siehe oben).
- Abschnitts-Links öffnen GitHub, funktionieren also nur mit Zugriff auf das private Studium-Repo.
- `![[Pasted image …]]` aus DS VO5 und ERA VO7 sind nicht im Studium-Repo committet. Diese Bilder fehlen Codex (⚑ im Report). Werden sie committet: `pnpm pipeline regenerate "<pfad>"`.
- IPA neu bauen: Actions → „iOS IPA (unsigned)“ → Run workflow, oder Tag `v*` pushen (kostet macOS-Minuten).
- Ideen: Push-Erinnerung testen, sobald jemand Push aktiviert hat; Praxis-Level im E2E-Flow mitspielen.

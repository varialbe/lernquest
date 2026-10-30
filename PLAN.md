# LernQuest – Plan

Duolingo-artiges Lernquiz, automatisch aus `varialbe/studium` generiert. Läuft auf dem VPS (`varialbe.xyz`, Ubuntu 24.04, 6 vCPU, 12 GB).

## Befunde aus Phase 0
- Quellen sind **Obsidian-Markdown-Mitschriften**, keine PDFs: `DS/01_Vorlesungen/Diskrete Strukturen VO<n>.md`, `EIP/01_Vorlesungen/EIP VO<n>.md`, `ERA/01_Vorlesungen/Einführung in die Rechnerarchitektur VO<n>[ (ZÜ)].md`.
- Repo wird automatisch alle 15 min per „Studium-Backup“-Commit aktualisiert; Dateien kommen einzeln hinzu, teils umbenannt/gelöscht (Tippfehler-Dateien, eine PDF wurde wieder entfernt).
- Reihenfolge = Datum des ersten Hinzufügens des aktuellen Dateiinhalts (git log --diff-filter=A --follow), Tiebreak VO-Nummer.
- PDF/PPTX/Bilder werden trotzdem unterstützt (pdftotext -layout pro Seite, pptx via unzip, Bilder an `codex exec -i`).
- DNS `lern.varialbe.xyz` → 173.249.7.47 (Server) ✔ → eigene Subdomain mit Let's Encrypt (certbot certonly --webroot, eigene vhost-Datei).
- Freie Ports: API 127.0.0.1:3460, Pipeline-Trigger 127.0.0.1:3461, n8n 127.0.0.1:5678.
- Codex CLI 0.166, eingeloggt (ChatGPT), `gpt-5.6-luna` + xhigh funktioniert, `--output-schema`, `-i`, Feature `image_generation` aktiv.

## Phasen
- [x] Phase 0 – Erkunden, Tools installieren (pnpm 10.18, poppler-utils, bubblewrap), Plan
- [ ] Phase 1 – Pipeline (Diff-Erkennung, Extraktion, Codex Generate + Review, Zod, content/, Git, DB-Import, Report, CLI, Trigger-Dienst)
- [ ] Phase 2 – n8n (Docker Compose, Workflow „LernQuest Nightly“, Export, Owner-Account)
- [ ] Phase 3 – Backend (Auth+Invites, Admin, Progress, Unlocks, Leitner, Ökonomie, Pets, Shop, Ligen, Reports, Push, Seed, Tests)
- [ ] Phase 4 – Frontend (Lernpfad, Quiz, Abschluss, Pets, Shop, Liga, Profil, Admin, PWA, Assets, Playwright-Screenshots + E2E)
- [ ] Phase 5 – Deployment (systemd, Apache-vhost, certbot, Header/Kompression, Backup-Timer, Smoke-Tests)
- [ ] Phase 6 – iOS (Capacitor, GitHub Action unsignierte IPA, Sideloading-Doku)
- [ ] Phase 7 – Backfill aller Vorlesungen, n8n-Testlauf, README, Abschluss

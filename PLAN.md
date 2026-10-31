# LernQuest – Plan

Duolingo-artiges Lernquiz, automatisch aus `varialbe/studium` generiert. Läuft auf dem VPS (`varialbe.xyz`, Ubuntu 24.04, 6 vCPU, 12 GB).

## Befunde aus Phase 0
- Quellen sind **Obsidian-Markdown-Mitschriften** mit Mermaid, Callouts, LaTeX und Frontmatter: `DS/01_Vorlesungen/Diskrete Strukturen VO<n>.md`, `EIP/01_Vorlesungen/EIP VO<n>.md`, `ERA/01_Vorlesungen/Einführung in die Rechnerarchitektur VO<n>[ (ZÜ)].md`.
- Bilder: Markdown-Links `![Alt](../04_Materialien/x.png|svg)` (beschriftet, im Repo) und `![[Pasted image ….png]]` (nicht im Repo committet → werden im Report markiert).
- Noch keine `[[Wikilinks]]` zwischen Notizen – der Konzeptgraph ist trotzdem implementiert.
- Repo wird automatisch alle 15 min per „Studium-Backup“-Commit aktualisiert; Dateien kommen einzeln hinzu, teils umbenannt/gelöscht.
- Reihenfolge = erstes Hinzufügen (git log --diff-filter=A --follow), Tiebreak VO-Nummer.
- DNS `lern.varialbe.xyz` → 173.249.7.47 ✔ → eigene Subdomain mit Let's Encrypt (certbot certonly --webroot, eigene vhost-Datei).
- Ports: API 127.0.0.1:3460, Pipeline-Trigger 127.0.0.1:3461, n8n 127.0.0.1:5678.
- Codex CLI 0.166, eingeloggt, `gpt-5.6-luna` + xhigh ✔, `--output-schema`, `-i`. Erster Echtlauf: ~3,5 min pro Datei (Generate 91 s + Review 104 s).

## Korrektur vom 31.10. (Obsidian statt PDF) – umgesetzt in Phase 1
- [x] Kein pdftotext; nur `*.md` in den Vorlesungsordnern gilt als „neu“; `.obsidian/`, Bilder, Anhänge werden ignoriert.
- [x] `source = {file, heading}`; Überschrift wird gegen die echten Überschriften der Notiz abgeglichen. App zeigt Abschnitts-Link (Phase 4).
- [x] Parser (`pipeline/src/obsidian.ts`): Frontmatter (YAML), `[[Wikilinks]]` inkl. `#Heading`/`|Alias`, `![[Embeds]]`, Markdown-Bilder, Callouts, Mermaid, LaTeX; Code-Blöcke werden beim Link-Parsen maskiert.
- [x] Konzeptgraph: Wikilinks werden im Vault aufgelöst; verlinkte Notizen gehen als Kontext in Generate/Review, verlinkte frühere Units werden bevorzugt wiederholt; `links`/`tags` stehen in der Unit und in der DB.
- [x] Fragetyp `diagram` (Prompt enthält ```mermaid); Zod prüft den Block.
- [x] Mermaid im Frontend lazy-loaded rendern, Dark-Mode-Theme (Phase 4).
- [x] Eingebettete Bilder: vorhandene, nicht winzige, beschriftete Bilder → `codex -i` (SVG→PNG via sharp, max. 8); fehlende/ignorierte Bilder werden im Report pro Notiz markiert (⚑).

## Phasen
- [x] Phase 0 – Erkunden, Tools installieren (pnpm 10.18, bubblewrap), Plan
- [x] Phase 1 – Pipeline (Diff-Erkennung, Obsidian-Parser, Codex Generate + Review, Zod, content/, Git, DB-Import, Report, CLI, Trigger-Dienst)
- [x] Phase 2 – n8n (Docker Compose, Workflow „LernQuest Nightly“, Export, Owner-Account)
- [x] Phase 3 – Backend (Auth+Invites, Admin, Progress, Unlocks, Leitner, Ökonomie, Pets, Shop, Ligen, Reports, Push, Seed, Tests)
- [x] Phase 4 – Frontend (Lernpfad, Quiz inkl. KaTeX/Code/Mermaid, Abschnitts-Links, Abschluss, Pets, Shop, Liga, Profil, Admin, PWA, Assets, Playwright-Screenshots + E2E)
- [x] Phase 5 – Deployment (systemd, Apache-vhost, certbot, Header/Kompression, Backup-Timer, Smoke-Tests)
- [x] Phase 6 – iOS (Capacitor, GitHub Action unsignierte IPA, Sideloading-Doku)
- [x] Phase 7 – Backfill aller Vorlesungen, n8n-Testlauf, README, Abschluss

## Ergänzung vom 31.10. (Praxis-Bereich) – umgesetzt
- [x] Level-Art `bonus` (Level 5 je Unit, außerhalb des Lernpfads, frei nach „Grundlagen“), Tab „Praxis“.
- [x] Transferfragen („Welcher Alltagsfall …?“) und Fragetyp `estimate` mit Schieberegler (linear/log, Toleranz), gewertet über `checkAnswer`.
- [x] Eigener Prompt + Review + Schema; `pnpm pipeline bonus`; Backfill für alle 18 Units.

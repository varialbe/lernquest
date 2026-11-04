# AGENTS.md – Regeln für KI-Agenten (Codex, Claude) in diesem Repo

LernQuest: Lern-App für DS, EIP, ERA. Überblick, Betrieb und Architektur: `README.md`, Stand: `PROGRESS.md`.
Quelle der Wahrheit ist das Repo `~/lernquest` auf dem VPS (Dienste, Daten, `.env` liegen nur dort).

## ⚠️ Pflicht: Wissenssammlung und Voraussetzungen immer aktuell halten

Zu jeder Unit gehören **drei** Dinge, die zusammenpassen müssen:

| Was | Datei | Erzeugt von |
|---|---|---|
| Unit (Level, Fragen) | `content/<modul>/<nr>-<slug>.json` | `pnpm pipeline run` / `regenerate` |
| Wissenssammlung (Begriffe, Konzepte) | `wissen/<modul>/<unit-id>.json` | `pnpm pipeline knowledge <unit-id>` |
| Voraussetzungen („Dafür brauchst du“, Lernpfad „Von Grund auf“) | `wissen/<modul>/_voraussetzungen.json` | läuft in `knowledge` mit (`pipeline/src/prereqs.ts`) |

**Immer, wenn du neue Inhalte hinzufügst oder bestehende änderst** (neue Unit, Unit neu generiert, Wissenseinträge ergänzt/umbenannt/gelöscht, Begriffe zusammengelegt), müssen die Voraussetzungen danach stimmen:

1. Wissenssammlung **nicht von Hand** in `wissen/*.json` editieren, sondern neu erzeugen: `pnpm pipeline knowledge <unit-id>`. Das schreibt Wissenssammlung **und** Voraussetzungen dieser Unit neu.
2. Wurde eine **frühere** Unit neu erzeugt, ändern sich ihre Eintrags-IDs (`ds-03-k07` kann danach ein anderer Begriff sein). Spätere Units, die darauf verweisen, werden automatisch als veraltet markiert – danach `pnpm pipeline knowledge` (ohne Argument) laufen lassen, bis nichts mehr fehlt.
3. **Zum Schluss immer prüfen:** `pnpm pipeline wissen-check` muss `✓` melden (Exit 0). Er findet fehlende/veraltete Wissenssammlungen, fehlende Voraussetzungen, Kanten auf unbekannte Einträge oder spätere Units und Zyklen.
4. Regeln für Voraussetzungen (prüft `applyPrereqs` deterministisch, gilt aber auch für Vorschläge): Kanten sind `essential` (zum Verstehen nötig), `background` (hilfreicher Kontext) oder `related` (Verwandtschaft/Kontrast). Nur Einträge derselben oder **früherer** Units desselben Moduls, kein Selbstbezug und keine doppelten Kanten. Limits: höchstens 5 essential, 4 background und 4 related. Zyklen sind nur bei essential/background verboten. `why` muss konkret sagen, welcher Teil von X wofür in Y gebraucht wird; generische Floskeln werden verworfen. Transitive essential-Kanten werden zu background, wenn ihre Begründung nichts Eigenständiges beiträgt; wenn das Background-Limit voll ist, werden sie entfernt. Manuell geprüfte Kanten im Graphen mit `"locked": true` markieren; `knowledge` und Migration lassen sie stehen. v1-Graphen liest die App als legacy-essential; die semantische Migration läuft separat mit `pnpm pipeline prereqs-migrate`.
5. Bestätigte Alias-Beziehungen erhalten alle Eintrags-IDs. Der kanonische Eintrag muss früher eingeführt sein (Unit, dann Eintragsreihenfolge); auch nach Alias-Auflösung dürfen keine essential/background-Zyklen entstehen. Die Gold-Evaluation berichtet aliasbereinigte und rohe ID-Precision/Recall separat.
6. Ändert sich das Format (Felder in `packages/shared/src/knowledge.ts`), müssen Pipeline (`pipeline/src/knowledge.ts`, `prereqs.ts`), API (`apps/api/src/lib/knowledge.ts`, `cards.ts`) und App (`apps/web/src/pages/Knowledge.tsx`, `Cards.tsx`) mitziehen.

Der normale Lauf (`pnpm pipeline run`, nachts per n8n oder im Telegram-Bot per 🔄) erzeugt für neue Units Wissenssammlung + Voraussetzungen automatisch und holt Fehlendes nach (bis zu `KNOWLEDGE_CATCH_UP` Units pro Lauf). Manuelle Änderungen musst du selbst nachziehen (siehe oben).

Karteikarten-Fortschritt (`card_items`) hängt an den Eintrags-IDs: Eine neu erzeugte Wissenssammlung setzt die Karten dieser Unit zurück. Nur neu erzeugen, wenn es inhaltlich nötig ist.

## Englisch mit den Inhalten synchron halten

- Deutsche Units und Wissenssammlungen bleiben die Quelle. Englische Fassungen liegen in `content/<modul>/en/` und `wissen/<modul>/en/`; übersetzte Kantenbegründungen in `<unit-id>.prereqs.json` werden gegen Originalkanten und Quellhash geprüft; IDs und Lernfortschritt sind sprachunabhängig.
- Nach Änderungen an Unit, Wissen oder Voraussetzungsbegründungen: `pnpm pipeline translate <unit-id>` (betroffene spätere Units ebenfalls nachziehen). Der normale Lauf übersetzt neue/veraltete Inhalte bis `TRANSLATE_CATCH_UP` (Standard wie `KNOWLEDGE_CATCH_UP`).
- Vor dem Deploy: `pnpm pipeline wissen-check` und `pnpm pipeline translate-check --strict`. Übersetzungen müssen aktuell sein und den deterministischen Validator bestehen: gleiche Struktur, IDs, Antworten, Zahlen, Formeln, Code und Lückenmarker. Original-JSONs und Metadaten nicht zur Umgehung der Prüfung verändern.
- Übersetzungen ausschließlich über die Pipeline erzeugen/reparieren; eine Übersetzung setzt keine Karten zurück. Die API fällt bei fehlenden, veralteten oder ungültigen Übersetzungen auf Deutsch zurück.
- **Mermaid-Diagramme werden mitübersetzt**: Die Pipeline schickt nur die sichtbaren Beschriftungen (Knoten, Kanten, Subgraph-Titel) als Felder `<pfad>#m<k>` ans Modell (`packages/shared/src/mermaid.ts`) und setzt das Diagramm deterministisch wieder zusammen; der Validator vergleicht das Diagramm-Skelett ohne Beschriftungen. Diagramm-Code nie von Hand übersetzen. Nach Änderungen an der Übersetzungslogik bestehende Fassungen mit `pnpm pipeline translate <id> --force` neu erzeugen (der Validator hält alte, deutsche Diagramme für gültig).

## Formatierung und Rechtschreibung

- `pnpm pipeline lint --strict` muss vor jedem Deploy `✓` melden. Er rendert alle Texte (DE + EN) wie die App (GFM + remark-math + KaTeX) und findet kaputte Formeln, vergessene `$`, LaTeX außerhalb von Formeln, Markdown-Reste und deutsche Reste im Englischen. Das Quality-Gate behandelt Formatfehler einer Frage wie einen durchgefallenen Blind-Test (Reparatur).
- Lücken `___` dürfen in Formeln stehen (`$F_{n+2}=___$`); die App teilt die Formel an der Lücke (`apps/web/src/components/Markdown.tsx`, `gapsInMath`).
- Rechtschreib-/Grammatikfehler über `pnpm pipeline proofread <unit-id …>|--all --lang de|en|both [--dry-run]` korrigieren, nicht von Hand. Er ändert nur Wortlaut (Formeln, Code, Lücken, IDs, Diagrammstruktur byte-gleich, höchstens 25 % (DE) bzw. 40 % (EN) geänderte Wörter pro Feld), importiert geänderte deutsche Units in die DB und schreibt einen Bericht nach `data/reports/proofread-*.json`. Reihenfolge: erst `--lang de`, dann `translate --all` (deutsche Änderungen machen die Übersetzung veraltet), dann `--lang en`. Karten bleiben erhalten (IDs unverändert).

## Weitere Regeln

- **Formeln** in allen Lerntexten nur als `$…$` / `$$…$$` (KaTeX), nie `\(…\)` oder `\[…\]`. Code in Backticks.
- **Fragen müssen ohne Vorlesung lösbar sein** (`pipeline/prompts/_self-contained.md`); nach Änderungen an Fragen: `pnpm pipeline audit <unit-id>`.
- **Tests** vor jedem Deploy: `pnpm test` und `pnpm -r --if-present typecheck`. Neue API-Routen brauchen Auth (sonst wird `apps/api/test/security.test.ts` rot).
- **Datenschutz**: Werden neue personenbezogene Daten gespeichert, neue Mitteilungen verschickt oder neue Daten lokal gespeichert, die Datenschutzerklärung (`apps/web/src/pages/Legal.tsx`, `UPDATED`) im selben Schritt anpassen. Keine Cookies, kein Tracking.
- **App-Struktur**: Die Anzahl der Tabs unten bleibt gleich; neue Funktionen in bestehende Tabs einbauen (z. B. Üben).
- **DB-Änderungen** nur additiv per Drizzle-Migration (`pnpm db:generate`), vorher Backup nach `~/backups/lernquest/`.
- **Deploy**: `deploy/deploy-web.sh` (Web + iOS-Live-Update), nach API-Änderungen `sudo systemctl restart lernquest-api`. Neues IPA nur bei nativen Änderungen.
- Läuft gerade eine Pipeline (`curl 127.0.0.1:3461/health` → `running`), nicht auf `main` im VPS-Repo arbeiten (die Pipeline committet dort) – Worktree oder Branch benutzen.

<!-- prompt-version: v1 · Platzhalter: {{MODULE}} {{MODULE_NAME}} {{FILE}} {{UNIT_NUMBER}} {{QUESTIONS_PER_LEVEL}} {{SOURCE_KIND}} {{PREVIOUS_UNITS}} {{SOURCE}} -->
Du bist Didaktik-Experte und Tutor an der TUM. Erstelle aus der folgenden Vorlesungsdatei eine Lern-Unit für eine Quiz-App im Stil von Duolingo.

## Kontext
- Modul: **{{MODULE}} – {{MODULE_NAME}}**
- Datei: `{{FILE}}` ({{SOURCE_KIND}}) – das ist Unit Nr. {{UNIT_NUMBER}} dieses Moduls.
- Bisherige Units dieses Moduls (Titel, Kernkonzepte, Kernaussagen, Quelldatei):

{{PREVIOUS_UNITS}}

## Aufgabe
Erzeuge genau **4 Level** in dieser Reihenfolge, je **{{QUESTIONS_PER_LEVEL}} Fragen**:
1. `basics` – „Grundlagen“: Definitionen, Begriffe, Notation wiedererkennen (difficulty 1–2).
2. `apply` – „Anwenden“: Begriffe auf konkrete Beispiele anwenden, kleine Rechnungen/Umformungen (difficulty 2–3).
3. `deepen` – „Vertiefen“: Zusammenhänge, Sonderfälle, Voraussetzungen, typische Fallen (difficulty 3–4).
4. `boss` – „Boss“: gemischte, anspruchsvolle Fragen über die ganze Vorlesung (difficulty 4–5). Wenn es bisherige Units gibt, sollen **2–4 Boss-Fragen Stoff aus früheren Units** wiederholen bzw. mit dem neuen Stoff verknüpfen – nur auf Basis der oben genannten Kernaussagen, und mit `source.file` = Quelldatei der früheren Unit.

Fragetypen (`type`) – nutze eine abwechslungsreiche Mischung, passend zum Fach:
- `single`: genau eine richtige Antwort, 4 Optionen.
- `multi`: „Wähle alle richtigen Aussagen“ – 4–5 Optionen, 2–3 davon richtig. Im Prompt explizit sagen, dass mehrere richtig sein können.
- `truefalse`: Aussage beurteilen. Optionen exakt `[{"id":"true","text":"Wahr"},{"id":"false","text":"Falsch"}]`.
- `cloze`: Lückentext, die Lücke im Prompt ist `___` (genau eine), 4 Optionen zum Einsetzen.
- `code_output`: „Was gibt dieser Code aus?“ – Code in ```-Fence mit Sprache (vor allem EIP; nur Sprachen/Konstrukte, die im Material vorkommen). Der Code muss exakt so laufen, wie die Antwort behauptet – rechne ihn Schritt für Schritt nach.
- `calc`: Rechen-/Umwandlungsaufgabe mit 4 Antwortoptionen (vor allem ERA/DS, z. B. Zahlensysteme, Zweierkomplement, Mengen, Logik). Rechne jede Option nach.

Für jede Frage:
- `prompt`: Deutsch, Markdown; Formeln in `$…$` (KaTeX-kompatibel, keine `\(`-Syntax), Code in Fences. Kurz und eindeutig.
- `options`: IDs `a`, `b`, `c`, … (bei truefalse `true`/`false`). Distraktoren müssen **plausibel** sein (typische Studentenfehler, Verwechslungen, Vorzeichen-/Off-by-one-Fehler), aber **eindeutig falsch**. Keine absurden Optionen, keine „Alle oben genannten“.
- `correct`: Liste der richtigen Options-IDs (bei allen Typen außer `multi` genau eine).
- `explanation`: 1–3 Sätze, lehrreich: warum richtig, und gegebenenfalls warum der typische Fehler falsch ist.
- `source`: `file` = Quelldatei, `page` = Seitennummer bei PDF/PPTX (sonst `null`), `section` = passende Überschrift aus der Mitschrift (sonst `null`).
- `difficulty`: 1–5. `concepts`: 1–3 Konzepte aus der Liste unten.

Außerdem auf Unit-Ebene:
- `title`: prägnanter deutscher Titel des Hauptthemas (ohne „VO 3“), `slug`: kebab-case ASCII (ä→ae usw.).
- `summary`: 2–4 Sätze, worum es geht.
- `concepts`: 5–15 Kernkonzepte. `keyFacts`: 8–20 präzise Kernaussagen (Definitionen, Sätze, Regeln), die später als Kontext für Wiederholungsfragen dienen.
- `review`: `{"checked":0,"fixed":0,"removed":0,"notes":""}`.

## Harte Regeln
- Sprache Deutsch, Fachbegriffe und Notation **wie in der Mitschrift**.
- **Nichts erfinden**: Jede Frage muss durch das Material belegt sein. Keine Fakten aus Allgemeinwissen, die der Mitschrift widersprechen oder dort fehlen. Stellen, die in der Mitschrift als „Unklar / zu prüfen“ markiert sind, nicht abfragen. Organisatorisches (Termine, Klausurregeln) nicht abfragen.
- Keine Frage darf doppelt vorkommen; keine Frage darf die Antwort einer anderen verraten.
- Antworte ausschließlich mit dem JSON-Objekt gemäß Schema.

## Vorlesungsmaterial
{{SOURCE}}

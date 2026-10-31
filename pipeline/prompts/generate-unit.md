<!-- prompt-version: v3 · Platzhalter: {{MODULE}} {{MODULE_NAME}} {{FILE}} {{UNIT_NUMBER}} {{QUESTIONS_PER_LEVEL}} {{TOPIC}} {{TAGS}} {{HEADINGS}} {{IMAGES}} {{PREVIOUS_UNITS}} {{LINKED_NOTES}} {{SOURCE}} -->
Du bist Didaktik-Experte und Tutor an der TUM. Erstelle aus der folgenden Vorlesungsmitschrift (Obsidian-Markdown) eine Lern-Unit für eine Quiz-App im Stil von Duolingo.

## Kontext
- Modul: **{{MODULE}} – {{MODULE_NAME}}**
- Datei: `{{FILE}}` – das ist Unit Nr. {{UNIT_NUMBER}} dieses Moduls.
- Thema laut Frontmatter: {{TOPIC}} · Tags: {{TAGS}}
- Die Mitschrift ist Obsidian-Markdown: Callouts (`> [!info]`, `> [!tip]`, `> [!warning]`, `> [!example]`), LaTeX in `$…$`/`$$…$$`, Mermaid-Diagramme in ```mermaid-Blöcken, Wikilinks wurden als „(→ Notiz „…“)“ aufgelöst.
- Angehängte Bilder: {{IMAGES}}

Überschriften der Mitschrift (für `source.heading` – exakt so übernehmen):
{{HEADINGS}}

Bisherige Units dieses Moduls (Titel, Kernkonzepte, Kernaussagen, Quelldatei; mit „verlinkt“ markierte Units verweist diese Notiz per Wikilink):

{{PREVIOUS_UNITS}}

Per Wikilink verlinkte Notizen (Konzeptgraph – nur als Kontext und für Wiederholungsfragen):

{{LINKED_NOTES}}

## Aufgabe
Erzeuge genau **4 Level** in dieser Reihenfolge, je **{{QUESTIONS_PER_LEVEL}} Fragen**:
1. `basics` – „Grundlagen“: Definitionen, Begriffe, Notation wiedererkennen (difficulty 1–2).
2. `apply` – „Anwenden“: Begriffe auf konkrete Beispiele anwenden, kleine Rechnungen/Umformungen (difficulty 2–3).
3. `deepen` – „Vertiefen“: Zusammenhänge, Sonderfälle, Voraussetzungen, typische Fallen (difficulty 3–4).
4. `boss` – „Boss“: gemischte, anspruchsvolle Fragen über die ganze Vorlesung (difficulty 4–5). Wenn es bisherige Units oder verlinkte Notizen gibt, sollen **2–4 Boss-Fragen Stoff daraus wiederholen** bzw. mit dem neuen Stoff verknüpfen (verlinkte zuerst) – nur auf Basis der oben angegebenen Kernaussagen/Auszüge, mit `source.file` = Pfad der früheren Unit bzw. Notiz.

Fragetypen (`type`) – nutze eine abwechslungsreiche Mischung, passend zum Fach:
- `single`: genau eine richtige Antwort, 4 Optionen.
- `multi`: „Wähle alle richtigen Aussagen“ – 4–5 Optionen, 2–3 davon richtig. Im Prompt explizit sagen, dass mehrere richtig sein können.
- `truefalse`: Aussage beurteilen. Optionen exakt `[{"id":"true","text":"Wahr"},{"id":"false","text":"Falsch"}]`.
- `cloze`: Lückentext, die Lücke im Prompt ist `___` (genau eine), 4 Optionen zum Einsetzen.
- `code_output`: „Was gibt dieser Code aus?“ – Code in ```-Fence mit Sprache (vor allem EIP; nur Sprachen/Konstrukte aus der Mitschrift). Rechne den Code Schritt für Schritt nach.
- `calc`: Rechen-/Umwandlungsaufgabe mit 4 Optionen (vor allem ERA/DS, z. B. Zahlensysteme, Zweierkomplement, Mengen, Logik). Rechne jede Option nach.
- `diagram`: Frage zu einem Mermaid-Diagramm. Das Diagramm steht in `context` (type `mermaid`, aus der Mitschrift übernommen oder vereinfacht/abgewandelt, gültige Mermaid-Syntax, kurze Knotentexte, keine Styles/Farben, max. ca. 15 Knoten). Beispiele: „Welcher Schritt fehlt im Ablauf?“, „Was beschreibt dieses Diagramm?“, „Welche Kante ist falsch?“. Wenn die Mitschrift Mermaid-Diagramme enthält, erzeuge pro Unit insgesamt 2–5 `diagram`-Fragen; sonst keine.

Für jede Frage:
- `context`: Graph/Code/Tabelle zur Frage oder `null` (siehe „Selbsttragende Fragen“). `verify`: Python-Prüfskript oder `null`.
- `prompt`: Deutsch, Markdown; Formeln in `$…$` (KaTeX-kompatibel, keine `\(`-Syntax), Code/Mermaid in Fences. Kurz und eindeutig. Keine Callout-Syntax im Prompt.
- `options`: IDs `a`, `b`, `c`, … (bei truefalse `true`/`false`). Distraktoren müssen **plausibel** sein (typische Studentenfehler, Verwechslungen, Vorzeichen-/Off-by-one-Fehler), aber **eindeutig falsch**. Keine absurden Optionen, keine „Alle oben genannten“.
- `correct`: Liste der richtigen Options-IDs (bei allen Typen außer `multi` genau eine).
- `explanation`: 1–3 Sätze, lehrreich: warum richtig, und gegebenenfalls warum der typische Fehler falsch ist.
- `source`: `file` = Repo-Pfad der Quelle (normalerweise `{{FILE}}`), `heading` = die **genaue** Überschrift aus der Liste oben, unter der der Stoff steht (bei früheren Units/verlinkten Notizen `null`, falls unbekannt).
- `difficulty`: 1–5. `concepts`: 1–3 Konzepte aus der Liste unten.

Außerdem auf Unit-Ebene:
- `title`: prägnanter deutscher Titel des Hauptthemas (ohne „VO 3“), `slug`: kebab-case ASCII (ä→ae usw.).
- `summary`: 2–4 Sätze, worum es geht.
- `concepts`: 5–15 Kernkonzepte. `keyFacts`: 8–20 präzise Kernaussagen (Definitionen, Sätze, Regeln), die später als Kontext für Wiederholungsfragen dienen.
- `review`: `{"checked":0,"fixed":0,"removed":0,"notes":""}`.

{{SELF_CONTAINED}}

## Harte Regeln
- Sprache Deutsch, Fachbegriffe und Notation **wie in der Mitschrift**.
- **Nichts erfinden**: Jede Frage muss durch die Mitschrift (oder angehängte Bilder) belegt sein. Keine Fakten aus Allgemeinwissen, die dort fehlen oder ihr widersprechen. Stellen, die als „Unklar / zu prüfen“ markiert sind, nicht abfragen. Organisatorisches (Termine, Klausurregeln) nicht abfragen.
- Fragen sind **inhaltlich** formuliert, nie als Meta-Frage über das Dokument („Was nennt die Mitschrift …?“, „Laut Vorlesung …“ vermeiden). Boss-Fragen sind echte Transfer-/Kombinationsaufgaben, keine Faktenabfrage.
- Keine Frage darf doppelt vorkommen; keine Frage darf die Antwort einer anderen verraten.
- Antworte ausschließlich mit dem JSON-Objekt gemäß Schema.

## Vorlesungsmitschrift `{{FILE}}`
{{SOURCE}}

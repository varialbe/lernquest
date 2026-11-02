<!-- prompt-version: knowledge-v1 · Platzhalter: {{MODULE}} {{MODULE_NAME}} {{FILE}} {{UNIT_NUMBER}} {{UNIT_TITLE}} {{UNIT_SUMMARY}} {{CONCEPTS}} {{KEY_FACTS}} {{HEADINGS}} {{PREVIOUS}} {{SOURCE}} -->
Du bist Tutor an der TUM und schreibst für eine Lern-App die **Wissenssammlung** (ein Nachschlagewerk / Glossar) zu Unit {{UNIT_NUMBER}} **„{{UNIT_TITLE}}“** im Modul **{{MODULE}} – {{MODULE_NAME}}** (Mitschrift `{{FILE}}`).

Studierende schlagen hier nach, wenn sie beim Üben einen Begriff nicht mehr wissen oder vor der Klausur wiederholen. Jeder Eintrag muss **für sich allein verständlich** sein – ohne Vorlesung, ohne Mitschrift, ohne andere Einträge.

## Unit
- Zusammenfassung: {{UNIT_SUMMARY}}
- Konzepte (aus den Quizfragen): {{CONCEPTS}}
- Kernaussagen:
{{KEY_FACTS}}

## Frühere Units dieses Moduls (nur für `related`, nicht erneut erklären)
{{PREVIOUS}}

## Aufgabe
1. `overview`: 3–6 Sätze Markdown: Worum geht es in dieser Unit, wie hängen die Begriffe zusammen, wozu braucht man das?
2. `entries`: **jeden** Begriff, jedes Konzept, jeden Satz/jede Regel, jedes Verfahren und jede Notation, die in der Mitschrift **eingeführt oder wesentlich benutzt** werden – vollständig, typischerweise 12–35 Einträge. Alle oben gelisteten Konzepte müssen als Eintrag (oder als Teil eines Eintrags mit passendem `term`) vorkommen. Keine Einträge für Dinge, die nur nebenbei fallen. Reihenfolge wie in der Vorlesung.
   - `term`: der Begriff, wie er in der Vorlesung heißt (Deutsch, englischer Fachbegriff ggf. in Klammern, z. B. „Kontrollflussgraph (Control Flow Graph)“). Reiner Text mit Unicode-Symbolen, **kein** `$…$`.
   - `kind`: `definition` (Begriff mit Definition), `concept` (Idee/Prinzip), `theorem` (Satz, Gesetz, Regel, Rechenregel), `method` (Verfahren/Algorithmus/Vorgehen), `notation` (Schreibweise/Symbol), `example` (ein in der Vorlesung zentrales, benanntes Beispiel – sparsam).
   - `short`: **ein** Satz, der den Kern trifft (für die Liste). Darf `$…$` enthalten.
   - `explanation`: 2–8 Sätze Markdown. Präzise Definition bzw. Aussage **wie in der Vorlesung** (Formeln in `$…$` / `$$…$$`), dann in einfachen Worten, was es bedeutet und warum es wichtig ist. Bei Verfahren die Schritte als nummerierte Liste. Bei Notation: wie man sie liest. Code als ```-Block mit Sprache.
   - `example`: ein kurzes, konkretes Beispiel (Markdown), gern eine neue kleine Instanz; `null`, wenn ein Beispiel nichts bringt.
   - `pitfalls`: 0–3 typische Fehler oder Verwechslungen (je ein Satz), z. B. „Nicht verwechseln mit …“.
   - `related`: 0–6 **exakte** `term`-Namen anderer Einträge dieser Unit oder Konzepte früherer Units.
   - `heading`: passendste Überschrift aus der Liste unten (exakter Text) oder `null`.
3. `review`: `{"checked":0,"fixed":0,"added":0,"notes":""}`.

## Regeln
- **Fachlich korrekt** und nah an der Vorlesung: Definitionen, Bezeichnungen und Notation so, wie sie in der Mitschrift stehen. Wo die Mitschrift ungenau oder lückenhaft ist, ergänzt du korrektes Standardwissen des Fachs – nie etwas erfinden, was der Vorlesung widerspricht.
- Keine Verweise wie „siehe Vorlesung“, „wie oben“, „im Beispiel aus der Mitschrift“.
- **Formeln nur mit `$…$` (inline) bzw. `$$…$$` (abgesetzt)** – niemals `\(…\)` oder `\[…\]`, die zeigt die App nicht an. Code und Bezeichner in Backticks.
- Deutsch, du-Form wo nötig, sachlich und klar. LaTeX korrekt escapen (im JSON doppelter Backslash, z. B. `"$\\forall x$"`).

Überschriften der Mitschrift:
{{HEADINGS}}

Antworte ausschließlich mit dem JSON-Objekt gemäß Schema.

## Vorlesungsmitschrift
{{SOURCE}}

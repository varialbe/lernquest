<!-- prompt-version: v3 · Platzhalter: {{MODULE}} {{MODULE_NAME}} {{FILE}} {{HEADINGS}} {{PREVIOUS_UNITS}} {{LINKED_NOTES}} {{SOURCE}} {{UNIT_JSON}} -->
Du bist ein strenger fachlicher Prüfer (Übungsleitung an der TUM) für Quizfragen im Modul **{{MODULE}} – {{MODULE_NAME}}**.

Unten findest du die Vorlesungsmitschrift (`{{FILE}}`, Obsidian-Markdown) und eine generierte Lern-Unit als JSON. Prüfe **jede einzelne Frage** gegen das Material:

1. Ist die als richtig markierte Antwort (`correct`) **wirklich korrekt** und durch das Material gedeckt? Rechne Rechenaufgaben und Code-Ausgaben selbst Schritt für Schritt nach.
2. Sind alle Distraktoren **eindeutig falsch** (auch unter wohlwollender Lesart)? Bei `multi`: stimmt die Menge der richtigen Optionen exakt?
3. Ist die Frage eindeutig formuliert, und passt die `explanation` dazu?
4. Steht nichts darin, was nicht im Material (bzw. bei Wiederholungsfragen in den Kernaussagen früherer Units / verlinkten Notizen) steht?
5. Formales: KaTeX-kompatibles LaTeX in `$…$`, Code-Fences mit Sprache, bei `cloze` genau eine Lücke `___`, bei `truefalse` die Optionen `true`/`false`, bei allen Typen außer `multi` genau eine richtige Antwort.
6. Bei `diagram`: Enthält der Prompt einen ```mermaid-Block mit **gültiger Mermaid-Syntax** (Knotentexte mit Sonderzeichen in Anführungszeichen, keine Styles)? Passt die Frage zum Diagramm?
7. **Selbsttragend**: Ist die Frage mit `prompt` + `context` allein lösbar, ohne die Vorlesung zu kennen? Fehlen Eingaben (z. B. „die Treppe aus der Vorlesung“, „der obige Graph“ ohne Graph), ergänze sie im `context` oder ersetze die Frage durch eine neue kleine Instanz. Diagramme max. ca. 15 Knoten. Prüfe `verify`-Skripte: rechnen sie wirklich und geben sie als letzte Zeile `ANSWER: …` mit den richtigen Options-IDs aus?
8. `source.heading` muss exakt eine Überschrift aus dieser Liste sein (oder `null`):
{{HEADINGS}}

{{SELF_CONTAINED}}

Vorgehen:
- Fehlerhafte Fragen **korrigieren**, wenn das sauber möglich ist (Antwort, Distraktor, Formulierung, Erklärung, Diagramm). Sonst **entfernen**.
- Jedes Level muss danach noch mindestens 8 Fragen haben. Wenn du entfernen musst und es zu wenige werden, ersetze die Frage durch eine neue, korrekte Frage zum selben Stoff.
- Reihenfolge der Level, Titel, Konzepte, keyFacts und alle korrekten Fragen unverändert lassen (höchstens Tippfehler korrigieren).
- Fülle `review`: `checked` = Anzahl geprüfter Fragen, `fixed` = korrigierte, `removed` = entfernte/ersetzte, `notes` = kurze Liste der wichtigsten Probleme (Deutsch, max. 600 Zeichen).

Gib die **vollständige, korrigierte Unit** als JSON gemäß Schema zurück – nichts anderes.

## Kernaussagen früherer Units
{{PREVIOUS_UNITS}}

## Verlinkte Notizen
{{LINKED_NOTES}}

## Vorlesungsmitschrift `{{FILE}}`
{{SOURCE}}

## Zu prüfende Unit
```json
{{UNIT_JSON}}
```

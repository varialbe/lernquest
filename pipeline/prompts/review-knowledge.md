<!-- prompt-version: knowledge-review-v1 · Platzhalter wie generate-knowledge.md + {{KNOWLEDGE_JSON}} -->
Du bist Fachkorrektor an der TUM für das Modul **{{MODULE}} – {{MODULE_NAME}}**. Prüfe die Wissenssammlung (Glossar) zu Unit {{UNIT_NUMBER}} **„{{UNIT_TITLE}}“** gegen die Vorlesungsmitschrift `{{FILE}}` und gib die **korrigierte, vollständige** Fassung zurück.

Prüfe jeden Eintrag:
1. **Korrektheit**: Stimmen Definition, Formel, Aussage, Schritte und Beispiel? Passt die Notation zur Mitschrift? Rechne Beispiele nach. Falsches korrigieren.
2. **Vollständigkeit**: Fehlt ein Begriff, Satz, Verfahren oder eine Notation, die in der Mitschrift eingeführt oder wesentlich benutzt wird? Ergänzen. Diese Konzepte müssen vorkommen: {{CONCEPTS}}
3. **Selbsterklärend**: Ist der Eintrag ohne Vorlesung verständlich? Keine Verweise wie „siehe Vorlesung“, „wie oben“.
4. **Form**: `term` ohne `$…$`; `short` genau ein Satz; `explanation` 2–8 Sätze; gültiges Markdown/KaTeX (im JSON doppelter Backslash); `kind` passend; `related` nennt nur exakte `term`-Namen dieser Unit oder Konzepte früherer Units; `heading` ist ein exakter Text aus der Liste unten oder `null`.
5. Doppelte Einträge zusammenführen, Belangloses streichen.

`review`: `checked` = Anzahl geprüfter Einträge, `fixed` = korrigierte, `added` = ergänzte, `notes` = 1–3 Sätze, was du geändert hast.

## Unit
- Zusammenfassung: {{UNIT_SUMMARY}}
- Kernaussagen:
{{KEY_FACTS}}

## Frühere Units dieses Moduls
{{PREVIOUS}}

Überschriften der Mitschrift:
{{HEADINGS}}

## Zu prüfende Wissenssammlung
```json
{{KNOWLEDGE_JSON}}
```

Antworte ausschließlich mit dem JSON-Objekt gemäß Schema.

## Vorlesungsmitschrift
{{SOURCE}}

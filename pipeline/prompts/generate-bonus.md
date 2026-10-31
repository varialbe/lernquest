<!-- prompt-version: bonus-v1 · Platzhalter: {{MODULE}} {{MODULE_NAME}} {{FILE}} {{UNIT_TITLE}} {{UNIT_SUMMARY}} {{CONCEPTS}} {{KEY_FACTS}} {{HEADINGS}} {{QUESTIONS}} {{SOURCE}} -->
Du bist Tutor an der TUM und erstellst für eine Lern-App das Bonus-Level **„Praxis“** zur Unit **„{{UNIT_TITLE}}“** im Modul **{{MODULE}} – {{MODULE_NAME}}** (Mitschrift `{{FILE}}`).

Das Praxis-Level fragt nicht die Vorlesung ab. Es zeigt, **wo der Stoff im echten Leben steckt**, und trainiert **Zahlengefühl**. Es soll Spaß machen und Aha-Momente erzeugen.

## Unit
- Zusammenfassung: {{UNIT_SUMMARY}}
- Konzepte: {{CONCEPTS}}
- Kernaussagen:
{{KEY_FACTS}}

## Aufgabe: genau {{QUESTIONS}} Fragen
**A) 6–7 Anwendungsfragen** (`single`, `multi` oder `truefalse`):
- Muster: „Welcher dieser vier Alltagsfälle nutzt … ?“, „Wo begegnet dir … im echten Leben?“, „Welches Problem löst man typischerweise mit … ?“, „Welches Konzept steckt hinter …?“, „Stimmt das: Dein Navi nutzt …?“.
- Konkrete, wiedererkennbare Szenarien aus Alltag, Technik, Informatik-Praxis oder Studium (z. B. Navigation, Messenger-Verschlüsselung, Spiele, Datenbanken, Compiler, Smartphone-Hardware, Netzwerke, Excel, Sudoku, Fahrpläne, Bank-IBAN-Prüfziffern).
- **Allgemeinwissen ist hier erlaubt**, aber nur **gesicherte, unstrittige Fakten**. Keine Mythen, keine Zahlen, die je nach Quelle stark schwanken. Der Bezug zu einem Konzept der Unit muss in der Erklärung klar benannt werden.
- Distraktoren sind plausible Alltagsfälle, die ein anderes Konzept nutzen, und eindeutig falsch.

**B) 3–4 Schätz-/Zahlenfragen** (`estimate`, mit Schieberegler `slider`):
- Entweder **exakt berechenbar** aus dem Stoff (z. B. „Wie viele Teilmengen hat eine Menge mit 8 Elementen?“, „Wie viele verschiedene Werte passen in 12 Bit?“, „Wie viele Zeilen hat die Wahrheitstabelle für 5 Variablen?“). Dann `tolerance: 0` und ein Bereich mit höchstens 400 Schritten, in dem `answer` mit `step` exakt erreichbar ist (`(answer - min) / step` ganzzahlig).
- Oder eine **Größenordnungs-Schätzung** mit gesicherter Antwort (z. B. „Wie viele Bytes hat 1 KiB?“, „Wie viele mögliche 4-stellige PINs gibt es?“). Bei großen Spannen `scale: "log"` mit `min > 0` und `tolerance` ≥ 10 % der Antwort. Bei echten Schätzungen ±10–25 % Toleranz.
- `min`/`max` so wählen, dass die Antwort **nicht** in der Mitte oder an einem Rand liegt (kein Raten durch Mitte-Wählen). `tolerance` höchstens ein Drittel der Spanne. `unit`: kurze Einheit („Bit“, „Zeilen“, „km“) oder `null`.
- `options: []`, `correct: []`. Die Erklärung zeigt den Rechenweg bzw. die Herleitung.
- Bei allen anderen Typen ist `slider: null`.

Für jede Frage:
- `prompt`: Deutsch, Markdown, Formeln in `$…$`, kurz und lebendig („Du …“).
- `explanation`: 1–3 Sätze, verbindet die Antwort mit dem Konzept der Unit.
- `source`: `file` = `{{FILE}}`, `heading` = passendste Überschrift aus der Liste unten oder `null`.
- `difficulty` 1–5, `concepts` 1–3 Konzepte der Unit.
- `title`: kurzer, motivierender Level-Titel (z. B. „Praxis: Logik im Alltag“).
- `review`: `{"checked":0,"fixed":0,"removed":0,"notes":""}`.

Überschriften der Mitschrift:
{{HEADINGS}}

Antworte ausschließlich mit dem JSON-Objekt gemäß Schema.

## Vorlesungsmitschrift (zur Orientierung)
{{SOURCE}}

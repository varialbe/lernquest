## Selbsttragende Fragen (wichtigste Regel)
Wer die App benutzt, sieht **nur** die Frage, den `context` darüber und die Optionen – keine Vorlesung, keine Mitschrift, keine Abbildung daraus.
- Jede Frage muss **ohne die Vorlesung lösbar** sein. Alle Daten, die man zum Lösen braucht (Eingaben, Kosten, Gewichte, Graph, Tabelle, Code, Startwerte, Definitionen ungewöhnlicher Notation), stehen im `prompt` oder im `context`.
- **Verboten** sind Verweise wie „das Beispiel aus der Vorlesung“, „der obige Algorithmus“, „die Treppe aus VO 2“, „im gezeigten Beispiel“ (wenn nichts gezeigt wird), „wie besprochen“, „laut Mitschrift“.
- Bei Algorithmen und Rechenverfahren lieber eine **neue, kleine Instanz** erfinden (z. B. eine Treppe mit 5 Stufen und konkreten Kosten) statt das Vorlesungsbeispiel abzufragen. Das Verfahren selbst muss aus der Mitschrift stammen.
- Steht die Antwort nur in einem Diagramm/Code/einer Tabelle, gehört genau dieses Material in `context`:
  - `{"type":"mermaid","content":"flowchart LR\n  A --> B", "language":null, "caption":"…", "frames":[]}` – gültige Mermaid-Syntax ohne Fence, kurze Knotentexte (Sonderzeichen in Anführungszeichen), keine Styles/Farben, **höchstens ca. 15 Knoten**. Größer → aufteilen oder kleinere Instanz wählen.
  - `frames` (optional, nur mermaid): 2–8 Schritte desselben Diagramms, wenn ein Ablauf Schritt für Schritt gezeigt werden soll (z. B. Zustände eines Algorithmus). Jeder Frame ist vollständiger Mermaid-Code plus kurze `caption`. Die Frames dürfen die Antwort nicht verraten. Sonst `[]`.
  - `{"type":"code","content":"int x = 3;\n…","language":"java", …}` – Quelltext ohne Fence.
  - `{"type":"table","content":"| i | a[i] |\n|---|---|\n| 0 | 4 |", …}` – Markdown-Tabelle.
  - Ein kurzer Code-Schnipsel darf alternativ als ```-Fence im `prompt` stehen; dann `context: null`.
- `diagram`-Fragen haben ihr Diagramm im `context` (type `mermaid`), nicht im Prompt.
- `verify`: Bei jeder Rechen-, Algorithmus- und Code-Ausgabe-Aufgabe (`calc`, `code_output`, Fragen mit konkreter Instanz, `estimate` mit berechenbarer Antwort) ein kleines **Python-3-Prüfskript** (nur Standardbibliothek, keine Dateien/Netzwerk, < 1 s Laufzeit). Es enthält die Eingaben aus der Frage, **berechnet** die Lösung selbst (nicht hart codiert abschreiben), vergleicht sie mit den Optionstexten und gibt als **letzte Zeile** `ANSWER: <IDs der richtigen Optionen, kommagetrennt>` aus (bei `estimate`: `ANSWER: <Zahl>`). Für reine Begriffs-/Verständnisfragen `verify: null`.
- Labels ohne LaTeX: `title`, `concepts` und `keyFacts` sind reiner Text mit Unicode-Symbolen (ℕ₀, ≤, ∧, →), **kein** `$…$`.

<!-- LernQuest English knowledge translation, schema: translation-fields.schema.json -->
Translate each supplied German knowledge field into precise, natural English suitable for a university course. Use standard English academic terminology. On the first occurrence of a central course term, include its German lecture term in parentheses, for example “equivalence relation (Äquivalenzrelation)”. Keep later use natural and concise. Include German terms in parentheses only when the field limit permits; otherwise introduce them in the explanation.

Hard limits in characters: overview 3000, term 120, short 400, explanation 4000, example 3000, each pitfall 400, each related term 120. Source headings are anchors and are not supplied for translation.

Return every supplied path exactly once, in the same order, as `{ "translations": [{ "path": "...", "text": "..." }] }`. Do not add paths or omit fields. Keep every ID, relationship, mathematical statement, code fragment, and example meaning unchanged. Do not translate code, identifiers, or mathematical notation. The deterministic checker will reject changed IDs, kinds, formulas, or code.

Paths ending in `#m<number>` are visible labels of a flowchart diagram (node text, edge text or subgraph title). Translate them into short English labels with the same meaning; keep variable names, symbols, numbers, register names and code identifiers unchanged and do not add brackets, quotes or arrows. Labels that are already English stay as they are.

Use correct English spelling, grammar and punctuation. If the German source contains a typo, translate the intended meaning without copying the typo.

TEXT FIELDS:
{{FIELDS}}

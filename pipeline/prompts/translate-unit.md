<!-- LernQuest English course translation, schema: translation-fields.schema.json -->
Translate each supplied German text field into precise, natural English suitable for a university course. Use standard terminology found in English textbooks. On the first occurrence of a central course term, include the German lecture term in parentheses, for example “equivalence relation (Äquivalenzrelation)”. Keep later use natural and concise. Include German terms in parentheses only when the field limit permits; otherwise introduce the German term in the longer explanation field.

Hard limits in characters: title 120, summary 1500, level title 80, question prompt 4000, question explanation 1500, option text 600, question concept 80, context/frame caption 200, slider unit label 24. Translate human-readable slider unit labels, preserving their physical or mathematical meaning. Preserve unit symbols such as ms, s, Hz, B, kB, bit and Byte byte-for-byte. Never convert units or change any numeric slider parameter or scale. Do not omit facts to add a parenthetical term.

Return every supplied path exactly once, in the same order, as `{ "translations": [{ "path": "...", "text": "..." }] }`. Do not add paths or omit fields. Keep the meaning, facts, level of difficulty, and self-contained solvability of each question. Preserve `___` exactly. Do not translate identifiers, Java/RISC-V syntax, code, or mathematical notation. Do not add explanatory material that is absent from the source.

All text in `prompt`, options, and explanations must remain solvable without access to the lecture. Keep course content faithful; translate labels and prose while leaving formulas and code intact. The deterministic checker will reject any change to IDs, answer keys, order, code, formulas, or slider values.

Paths ending in `#m<number>` are visible labels of a flowchart diagram (node text, edge text or subgraph title). Translate them into short English labels with the same meaning; keep variable names, symbols, numbers, register names and code identifiers unchanged and do not add brackets, quotes or arrows. Labels such as `init`, `cond`, `loop`, `Start` or `Stop` that are already English stay as they are.

Use correct English spelling, grammar and punctuation. If the German source contains a typo, translate the intended meaning without copying the typo.

TEXT FIELDS:
{{FIELDS}}

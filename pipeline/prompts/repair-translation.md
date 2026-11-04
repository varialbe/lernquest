<!-- Repair a rejected English translation -->
Repair the English text fields using the source and deterministic validation errors below. Return only the supplied SOURCE TEXT FIELDS paths, exactly once in the same order as `{ "translations": [{ "path": "...", "text": "..." }] }`. Fix every listed error while preserving meaning and following the translation rules. Do not change the source structure, IDs, answer keys, ordering, code, formulas, or slider values.

Copy every backtick span and dollar-delimited formula from SOURCE TEXT FIELDS byte-for-byte, including German words and punctuation inside them. Do not add new backticks or dollar spans. Natural prose outside those spans must be English. Preserve all numeric facts. Protected spans and placeholders must appear exactly once each, in the SAME OCCURRENCE ORDER as the source; rephrase the English clauses as needed to keep that order.

VALIDATION ERRORS:
{{ERRORS}}

SOURCE TEXT FIELDS:
{{FIELDS}}

PREVIOUS TRANSLATION:
{{CANDIDATE}}

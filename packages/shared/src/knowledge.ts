import { z } from 'zod';
import { ModuleId } from './quiz.ts';

/**
 * Wissenssammlung: pro Unit ein Nachschlagewerk aller Begriffe und Konzepte
 * (Datei `wissen/<modul>/<unit-id>.json`, erzeugt von der Pipeline).
 */
export const KNOWLEDGE_KINDS = ['definition', 'concept', 'theorem', 'method', 'notation', 'example'] as const;
export const KnowledgeKind = z.enum(KNOWLEDGE_KINDS);
export type KnowledgeKind = z.infer<typeof KnowledgeKind>;
export const KNOWLEDGE_KIND_LABEL: Record<KnowledgeKind, string> = {
  definition: 'Begriff',
  concept: 'Konzept',
  theorem: 'Satz/Regel',
  method: 'Verfahren',
  notation: 'Notation',
  example: 'Beispiel',
};

export const KnowledgeEntry = z.object({
  /** stabile ID innerhalb der Unit, z. B. "ds-01-k03" */
  id: z.string().min(1).max(40),
  term: z.string().trim().min(1).max(120),
  kind: KnowledgeKind,
  /** ein Satz, wird in der Liste angezeigt */
  short: z.string().trim().min(1).max(400),
  /** Markdown + KaTeX, die eigentliche Erklärung */
  explanation: z.string().trim().min(1).max(4000),
  /** optional: kurzes Beispiel (Markdown) */
  example: z.string().trim().max(3000).nullable(),
  /** typische Fehler / Verwechslungen */
  pitfalls: z.array(z.string().trim().min(1).max(400)).max(5),
  /** andere Einträge (Begriffe) dieser oder früherer Units */
  related: z.array(z.string().trim().min(1).max(120)).max(8),
  /** Überschrift der Mitschrift, aus der der Eintrag stammt */
  heading: z.string().max(200).nullable(),
});
export type KnowledgeEntry = z.infer<typeof KnowledgeEntry>;

export const UnitKnowledge = z.object({
  schemaVersion: z.literal(1),
  unitId: z.string().regex(/^[a-z]+-\d{2}$/),
  module: ModuleId,
  unitNumber: z.number().int().min(1),
  unitTitle: z.string().min(1),
  /** sha256 der Mitschrift, aus der die Unit stammt (veraltet, wenn die Unit neu generiert wurde) */
  sourceSha: z.string(),
  overview: z.string().trim().min(1).max(3000),
  entries: z.array(KnowledgeEntry).min(3).max(60),
  generator: z.object({ model: z.string(), effort: z.string(), promptVersion: z.string(), generatedAt: z.string() }),
});
export type UnitKnowledge = z.infer<typeof UnitKnowledge>;

/** GET /api/knowledge/:module */
export type KnowledgeModuleResponse = {
  module: ModuleId;
  units: { unitId: string; unitNumber: number; unitTitle: string; overview: string | null; entries: KnowledgeEntry[] }[];
};

/**
 * `\( … \)` → `$…$` und `\[ … \]` → `$$…$$` (KaTeX/remark-math kennen nur `$`).
 * Code (```-Blöcke und `…`) bleibt unverändert.
 */
export function normalizeMathDelimiters(s: string): string {
  if (!s.includes('\\(') && !s.includes('\\[')) return s;
  return s
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replace(/\\\[([\s\S]+?)\\\]/g, (_, m: string) => `$$${m.trim()}$$`)
            .replace(/\\\(([\s\S]+?)\\\)/g, (_, m: string) => `$${m.trim()}$`),
    )
    .join('');
}

/** Alle Texte eines Eintrags normalisieren */
export const normalizeEntryMath = (e: KnowledgeEntry): KnowledgeEntry => ({
  ...e,
  short: normalizeMathDelimiters(e.short),
  explanation: normalizeMathDelimiters(e.explanation),
  example: e.example == null ? null : normalizeMathDelimiters(e.example),
  pitfalls: e.pitfalls.map(normalizeMathDelimiters),
});

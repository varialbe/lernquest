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
  units: { unitId: string; unitNumber: number; unitTitle: string; overview: string | null; entries: KnowledgeEntryView[] }[];
  /** Karteikarten-IDs in Box 6; nur für den angemeldeten Nutzer. */
  masteredEntryIds?: string[];
  /** Alias-ID → kanonische ID; Lernpfade zeigen die kanonische Fassung genau einmal. */
  aliases?: Record<string, string>;
};
/** Eintrag + klassifizierte direkte Voraussetzungen. */
export type KnowledgeEntryView = KnowledgeEntry & { requires: PrereqLink[] };

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

/**
 * Voraussetzungen und hilfreiche Beziehungen des Wissensgraphen.
 * v1-Dateien werden beim Lesen verlustfrei als essential-Kanten mit `legacy: true` normalisiert.
 */
export const PREREQ_TYPES = ['essential', 'background', 'related'] as const;
export const PrereqType = z.enum(PREREQ_TYPES);
export type PrereqType = z.infer<typeof PrereqType>;
export const PrereqLink = z.object({
  id: z.string().min(1).max(40),
  type: PrereqType,
  why: z.string().trim().max(240),
  /** Die Link stammt aus einem v1-Graphen; wird nach Neugenerierung entfernt. */
  legacy: z.boolean().default(false),
  /** Manuell fixierte Kante; Erzeugung und Migration dürfen sie nicht ändern. */
  locked: z.boolean().default(false),
}).superRefine((link, ctx) => {
  if (!link.legacy && !link.why) ctx.addIssue({ code: 'custom', path: ['why'], message: 'Neue Kanten brauchen eine Begründung.' });
});
export type PrereqLink = z.infer<typeof PrereqLink>;
const PrereqLinks = z.array(PrereqLink).max(13).superRefine((links, ctx) => {
  const counts = { essential: 0, background: 0, related: 0 };
  const ids = new Set<string>();
  links.forEach((link, i) => {
    counts[link.type]++;
    if (ids.has(link.id)) ctx.addIssue({ code: 'custom', path: [i, 'id'], message: 'Doppelte Kante' });
    ids.add(link.id);
  });
  if (counts.essential > 5 && !(counts.essential <= 6 && links.every((link) => link.type === 'essential' && link.legacy))) {
    ctx.addIssue({ code: 'custom', message: 'Maximal 5 essential-Kanten' });
  }
  if (counts.background > 4) ctx.addIssue({ code: 'custom', message: 'Maximal 4 background-Kanten' });
  if (counts.related > 4) ctx.addIssue({ code: 'custom', message: 'Maximal 4 related-Kanten' });
});
const GraphUnits = z.record(z.string(), z.object({
  knowledgeAt: z.string(),
  generatedAt: z.string(),
  model: z.string(),
  /** Version des Klassifikations-Prompts, fehlt bei v1. */
  promptVersion: z.string().optional(),
}));
const KnowledgeGraphV1 = z.object({
  schemaVersion: z.literal(1),
  module: ModuleId,
  units: GraphUnits,
  requires: z.record(z.string(), z.array(z.object({ id: z.string().min(1).max(40), why: z.string().trim().max(240) }).strict()).max(6)),
});
const KnowledgeGraphV2 = z.object({
  schemaVersion: z.literal(2),
  module: ModuleId,
  units: GraphUnits,
  requires: z.record(z.string(), PrereqLinks),
  /** Alias-ID → kanonische ID; Einträge selbst bleiben unverändert erhalten. */
  aliases: z.record(z.string(), z.string().min(1).max(40)).default({}),
});
export const KnowledgeGraph = z.union([KnowledgeGraphV1, KnowledgeGraphV2]).transform((graph) => {
  if (graph.schemaVersion === 2) return { ...graph, schemaVersion: 2 as const, aliases: graph.aliases ?? {} };
  return {
    schemaVersion: 2 as const,
    module: graph.module,
    units: graph.units,
    aliases: {},
    requires: Object.fromEntries(Object.entries(graph.requires).map(([id, links]) => [id, links.map((link) => ({ ...link, type: 'essential' as const, legacy: true, locked: false }))])),
  };
});
export type KnowledgeGraph = z.infer<typeof KnowledgeGraph>;

// ---------- Karteikarten ----------
export const CardReviewReq = z.object({ entryId: z.string().min(1).max(40), known: z.boolean() });
export type CardsOverview = { modules: { id: ModuleId; total: number; due: number; fresh: number; learning: number; mastered: number }[] };
export type CardSession = {
  module: ModuleId;
  unitId: string | null;
  /** box: null = neue Karte */
  cards: { entry: KnowledgeEntryView; unitId: string; unitNumber: number; unitTitle: string; box: number | null }[];
  /** weitere fällige Karten, die nicht mehr in diese Runde gepasst haben */
  dueLeft: number;
};

// ---------- Wochenrückblick ----------
export type RecapResponse = { title: string; body: string; url: string };

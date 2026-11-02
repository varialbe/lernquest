import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KnowledgeEntry, MODULE_INFO, normalizeMathDelimiters, UnitKnowledge, type Unit } from '@lernquest/shared';
import { codexJson } from './codex.ts';
import { config } from './config.ts';
import { FENCE, fill, fixLatexEscapes, formatHeadings, matchHeading, template } from './generate.ts';
import type { Heading } from './obsidian.ts';

/**
 * Wissenssammlung pro Unit: Glossar aller Begriffe/Konzepte/Sätze/Verfahren der Vorlesung.
 * Generieren (CODEX_EFFORT) → Fachkorrektur (CODEX_REVIEW_EFFORT) → wissen/<modul>/<unit-id>.json
 */
export const KNOWLEDGE_PROMPT_VERSION = 'k1';

type RawEntry = Omit<KnowledgeEntry, 'id'>;
type RawKnowledge = { overview: string; entries: RawEntry[]; review: { checked: number; fixed: number; added: number; notes: string } };
export type PrevUnit = { number: number; title: string; concepts: string[] };
export type KnowledgeResult = { knowledge: UnitKnowledge; tokens: number; review: RawKnowledge['review']; dropped: string[] };

export const knowledgeFile = (unitId: string) => join(config.knowledgeDir, unitId.split('-')[0]!, `${unitId}.json`);

export function readKnowledge(unitId: string): UnitKnowledge | null {
  const f = knowledgeFile(unitId);
  if (!existsSync(f)) return null;
  try {
    return UnitKnowledge.parse(JSON.parse(readFileSync(f, 'utf8')));
  } catch {
    return null;
  }
}

/** Fehlt die Wissenssammlung oder stammt sie von einer älteren Fassung der Unit? */
export const knowledgeStale = (unit: Pick<Unit, 'id' | 'source'>) => readKnowledge(unit.id)?.sourceSha !== unit.source.sha256;

/** Alle Units aus content/ (für die Planung im Modus `knowledge`). */
export function allContentUnits(): Unit[] {
  const out: Unit[] = [];
  if (!existsSync(config.contentDir)) return out;
  for (const mod of readdirSync(config.contentDir).sort()) {
    const dir = join(config.contentDir, mod);
    if (!statSync(dir).isDirectory()) continue; // z. B. content/.gitkeep
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      try {
        out.push(JSON.parse(readFileSync(join(dir, f), 'utf8')) as Unit);
      } catch {
        /* kaputte Datei – meldet der Import */
      }
    }
  }
  return out;
}

/** Rohausgabe von Codex → validierte Einträge mit stabilen IDs. */
export function normalizeKnowledge(raw: RawKnowledge, unit: Unit, headings: Heading[]): { knowledge: UnitKnowledge; dropped: string[] } {
  const dropped: string[] = [];
  const entries: KnowledgeEntry[] = [];
  const seen = new Set<string>();
  const clean = (s: string | null | undefined) => (s == null ? s : normalizeMathDelimiters(fixLatexEscapes(s)).trim());
  for (const e of raw.entries ?? []) {
    const key = (e.term ?? '').trim().toLowerCase();
    if (!key || seen.has(key)) {
      dropped.push(`doppelt/leer: ${e.term}`);
      continue;
    }
    const r = KnowledgeEntry.safeParse({
      id: `${unit.id}-k${String(entries.length + 1).padStart(2, '0')}`,
      term: e.term.replace(/\$/g, '').trim(),
      kind: e.kind,
      short: clean(e.short),
      explanation: clean(e.explanation),
      example: e.example?.trim() ? clean(e.example) : null,
      pitfalls: (e.pitfalls ?? []).map((p) => clean(p)!).filter(Boolean).slice(0, 5),
      related: (e.related ?? []).map((x) => x.replace(/\$/g, '').trim()).filter((x) => x && x.toLowerCase() !== key).slice(0, 8),
      heading: matchHeading(headings, e.heading),
    });
    if (r.success) {
      entries.push(r.data);
      seen.add(key);
    } else dropped.push(`${e.term}: ${r.error.issues[0]?.message}`);
  }
  const knowledge = UnitKnowledge.parse({
    schemaVersion: 1,
    unitId: unit.id,
    module: unit.module,
    unitNumber: unit.number,
    unitTitle: unit.title,
    sourceSha: unit.source.sha256,
    overview: clean(raw.overview) || unit.summary,
    entries,
    generator: { model: config.codexModel, effort: config.codexEffort, promptVersion: KNOWLEDGE_PROMPT_VERSION, generatedAt: new Date().toISOString() },
  });
  return { knowledge, dropped };
}

export async function generateKnowledge(
  unit: Unit,
  note: { text: string; headings: Heading[] } | null,
  previous: PrevUnit[],
  workDir: string,
  log: (m: string) => void,
): Promise<KnowledgeResult> {
  const headings = note?.headings ?? [];
  const vars = {
    MODULE: unit.module,
    MODULE_NAME: MODULE_INFO[unit.module].name,
    FILE: unit.source.file,
    UNIT_NUMBER: String(unit.number),
    UNIT_TITLE: unit.title,
    UNIT_SUMMARY: unit.summary,
    CONCEPTS: unit.concepts.join(', '),
    KEY_FACTS: unit.keyFacts.map((f) => `- ${f}`).join('\n'),
    HEADINGS: formatHeadings(headings),
    PREVIOUS: previous.length ? previous.map((p) => `- Unit ${p.number} „${p.title}“: ${p.concepts.join(', ')}`).join('\n') : '_(keine)_',
    SOURCE: note ? `${FENCE}markdown\n${note.text.slice(0, 80_000)}\n${FENCE}` : '_(Mitschrift nicht verfügbar – nutze Zusammenfassung, Konzepte und Kernaussagen)_',
  };
  mkdirSync(workDir, { recursive: true });
  log(`  → Wissenssammlung (effort ${config.codexEffort})`);
  const draft = await codexJson({ prompt: fill(template('generate-knowledge.md'), vars), effort: config.codexEffort, workDir, label: 'knowledge-generate', log, schema: config.knowledgeSchemaFile });
  log(`  → Wissens-Review (effort ${config.codexReviewEffort})`);
  const reviewed = await codexJson({
    prompt: fill(template('review-knowledge.md'), { ...vars, KNOWLEDGE_JSON: JSON.stringify(draft.data, null, 1) }),
    effort: config.codexReviewEffort,
    workDir,
    label: 'knowledge-review',
    log,
    schema: config.knowledgeSchemaFile,
  });
  const raw = reviewed.data as RawKnowledge;
  const { knowledge, dropped } = normalizeKnowledge(raw, unit, headings);
  return { knowledge, tokens: draft.tokens + reviewed.tokens, review: raw.review, dropped };
}

export function writeKnowledge(k: UnitKnowledge): string {
  const f = knowledgeFile(k.unitId);
  mkdirSync(join(f, '..'), { recursive: true });
  writeFileSync(f, JSON.stringify(k, null, 2) + '\n');
  return f;
}

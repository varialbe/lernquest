import { BONUS_KIND, LEVEL_TITLES, MODULE_INFO, Unit, type Question } from '@lernquest/shared';
import { codexJson } from './codex.ts';
import { config } from './config.ts';
import { FENCE, fill, formatHeadings, normalizeQuestion, template, type RawQuestion } from './generate.ts';
import type { Heading } from './obsidian.ts';

type RawBonus = { title: string; questions: RawQuestion[]; review: { checked: number; fixed: number; removed: number; notes: string } };

export type BonusResult = { unit: Unit; dropped: string[]; tokens: number; review: RawBonus['review'] };

/**
 * Praxis-Level (Bonus): Anwendungsfragen aus der echten Welt + Schätzfragen mit Schieberegler.
 * Generieren (CODEX_EFFORT) → Prüfen (CODEX_REVIEW_EFFORT) → als 5. Level an die Unit hängen.
 */
export async function generateBonus(unit: Unit, note: { text: string; headings: Heading[] } | null, workDir: string, log: (m: string) => void): Promise<BonusResult> {
  const mod = unit.module;
  const headings = note?.headings ?? [];
  const vars = {
    MODULE: mod,
    MODULE_NAME: MODULE_INFO[mod].name,
    FILE: unit.source.file,
    UNIT_TITLE: unit.title,
    UNIT_SUMMARY: unit.summary,
    CONCEPTS: unit.concepts.join(', '),
    KEY_FACTS: unit.keyFacts.map((f) => `- ${f}`).join('\n'),
    HEADINGS: formatHeadings(headings),
    QUESTIONS: String(config.bonusQuestions),
    SOURCE: note ? `${FENCE}markdown\n${note.text.slice(0, 60_000)}\n${FENCE}` : '_(Mitschrift nicht mehr verfügbar – nutze Zusammenfassung und Kernaussagen)_',
  };

  log(`  → Praxis-Level (effort ${config.codexEffort})`);
  const draft = await codexJson({ prompt: fill(template('generate-bonus.md'), vars), effort: config.codexEffort, workDir, label: 'bonus-generate', log, schema: config.bonusSchemaFile });
  log(`  → Praxis-Review (effort ${config.codexReviewEffort})`);
  const reviewed = await codexJson({
    prompt: fill(template('review-bonus.md'), { ...vars, LEVEL_JSON: JSON.stringify(draft.data, null, 1) }),
    effort: config.codexReviewEffort,
    workDir,
    label: 'bonus-review',
    log,
    schema: config.bonusSchemaFile,
  });

  const raw = reviewed.data as RawBonus;
  const dropped: string[] = [];
  const qs: Question[] = [];
  for (const rq of raw.questions ?? []) {
    if (!['single', 'multi', 'truefalse', 'estimate'].includes(rq.type)) {
      dropped.push(`bonus: Typ ${rq.type} im Praxis-Level nicht vorgesehen`);
      continue;
    }
    const qid = `${unit.id}-l5-q${String(qs.length + 1).padStart(2, '0')}`;
    const r = normalizeQuestion(rq, qid, { file: unit.source.file, headings, knownFiles: [unit.source.file], fallbackConcept: unit.concepts[0] ?? unit.title });
    if (r.ok) qs.push(r.question);
    else dropped.push(`bonus: ${r.error}`);
    if (qs.length === 12) break;
  }
  if (qs.length < 8) throw new Error(`Praxis-Level hat nur ${qs.length} gültige Fragen (mind. 8): ${dropped.slice(0, 3).join(' | ')}`);

  const level = { id: `${unit.id}-l5`, index: 5, kind: BONUS_KIND, title: raw.title?.trim().slice(0, 80) || LEVEL_TITLES.bonus, questions: qs };
  const next = Unit.parse({ ...unit, levels: [...unit.levels.slice(0, 4), level] });
  return { unit: next, dropped, tokens: draft.tokens + reviewed.tokens, review: raw.review };
}

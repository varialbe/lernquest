import { LEVEL_KINDS, type Unit } from '@lernquest/shared';
import { importUnit } from '../src/content/import.ts';
import { openDb, type DB } from '../src/db/index.ts';
import { invites } from '../src/db/schema.ts';

export function makeUnit(module: 'DS' | 'EIP' | 'ERA', number: number, opts: { questions?: number; variant?: string } = {}): Unit {
  const id = `${module.toLowerCase()}-${String(number).padStart(2, '0')}`;
  const n = opts.questions ?? 8;
  return {
    schemaVersion: 1,
    id,
    module,
    number,
    slug: `unit-${number}`,
    title: `Unit ${number}${opts.variant ?? ''}`,
    summary: 'Eine Zusammenfassung der Unit.',
    concepts: ['K'],
    keyFacts: ['F'],
    tags: [],
    links: [],
    source: { file: `${module}/01_Vorlesungen/VO${number}.md`, sha256: 'a'.repeat(64), commit: 'abc' },
    generator: { model: 'm', effort: 'x', reviewEffort: 'h', promptVersion: 'v2', generatedAt: '2026-10-31T00:00:00Z', review: { checked: 0, fixed: 0, removed: 0, notes: '' } },
    levels: LEVEL_KINDS.map((kind, li) => ({
      id: `${id}-l${li + 1}`,
      index: li + 1,
      kind,
      title: kind,
      questions: Array.from({ length: n }, (_, qi) => ({
        id: `${id}-l${li + 1}-q${String(qi + 1).padStart(2, '0')}`,
        type: 'single' as const,
        prompt: `Frage ${qi + 1}${opts.variant ?? ''}?`,
        options: [
          { id: 'a', text: 'eins' },
          { id: 'b', text: 'zwei' },
          { id: 'c', text: 'drei' },
        ],
        correct: ['b'],
        explanation: 'Weil zwei richtig ist.',
        source: { file: `${module}/01_Vorlesungen/VO${number}.md`, heading: 'Intro' },
        difficulty: 2,
        concepts: ['K'],
      })),
    })),
  };
}

export function testDb(): DB {
  const db = openDb(':memory:');
  importUnit(db, makeUnit('DS', 1));
  importUnit(db, makeUnit('DS', 2));
  db.insert(invites).values({ code: 'LQ-TEST-CODE', maxUses: 100 }).run();
  return db;
}

/** Antworten für ein Level: alle richtig bzw. die ersten `wrong` falsch. */
export function answersFor(unit: Unit, levelIdx: number, wrong = 0) {
  return unit.levels[levelIdx]!.questions.map((q, i) => ({ questionId: q.id, selected: i < wrong ? ['a'] : ['b'] }));
}

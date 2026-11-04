import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LEVEL_KINDS, type Unit, type UnitKnowledge } from '@lernquest/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.ts';
import { knowledgeTranslationFields, translateUnit, translationStatus, unitTranslationFields, validateKnowledgeTranslation, validateUnitTranslation, protectedTokens } from '../src/translate.ts';

function unitFixture(): Unit {
  const id = 'ds-01';
  return {
    schemaVersion: 1, id, module: 'DS', number: 1, slug: 'relations', title: 'Relationen', summary: 'Eine Zusammenfassung mit mindestens zehn Zeichen.', concepts: ['Relation'], keyFacts: ['Eine Relation verbindet Elemente.'], tags: [], links: [],
    source: { file: 'DS/01_Vorlesungen/VO1.md', sha256: 'a'.repeat(64), commit: 'abc' },
    generator: { model: 'fixture', effort: 'low', reviewEffort: 'low', promptVersion: 'v1', generatedAt: '2026-11-01T00:00:00.000Z', review: { checked: 1, fixed: 0, removed: 0, notes: '' } },
    levels: LEVEL_KINDS.map((kind, li) => ({
      id: `${id}-l${li + 1}`, index: li + 1, kind, title: kind,
      questions: Array.from({ length: 8 }, (_, qi) => ({
        id: `${id}-l${li + 1}-q${String(qi + 1).padStart(2, '0')}`, type: 'single' as const,
        prompt: qi === 0 ? 'Welche Aussage gilt für $A \\subseteq B$ und ___?' : `Frage ${qi + 1}: Was gilt?`,
        options: [{ id: 'a', text: 'falsch' }, { id: 'b', text: 'richtig' }, { id: 'c', text: 'unbestimmt' }], correct: ['b'],
        explanation: 'Weil die Definition diese Aussage verlangt.', source: { file: 'DS/01_Vorlesungen/VO1.md', heading: 'Relationen' }, difficulty: 2, concepts: ['Relation'],
        ...(qi === 1 ? { context: { type: 'code' as const, content: 'int answer = 42;', language: 'java', caption: 'Codebeispiel' } } : {}),
      })),
    })),
  };
}

function knowledgeFixture(): UnitKnowledge {
  return {
    schemaVersion: 1, unitId: 'ds-01', module: 'DS', unitNumber: 1, unitTitle: 'Relationen', sourceSha: 'a'.repeat(64), overview: 'Ein Überblick über die Begriffe.',
    entries: ['Relation', 'Äquivalenzrelation', 'Menge'].map((term, i) => ({ id: `ds-01-k0${i + 1}`, term, kind: 'definition' as const, short: `${term} in einem Satz.`, explanation: `Eine Erklärung mit $A \\subseteq B$.`, example: null, pitfalls: [], related: [], heading: null })),
    generator: { model: 'fixture', effort: 'low', promptVersion: 'k1', generatedAt: '2026-11-01T00:00:00.000Z' },
  };
}

const previousKnowledgeDir = config.knowledgeDir;
afterEach(() => { config.knowledgeDir = previousKnowledgeDir; });

describe('English translation validation', () => {
  it('accepts translated prose while preserving formulas, code, and cloze markers', () => {
    const source = unitFixture();
    const translated = structuredClone(source);
    for (const field of unitTranslationFields(source)) {
      const parts = field.path.split('.');
      let target = translated as unknown as Record<string, unknown>;
      for (const key of parts.slice(0, -1)) target = target[key] as Record<string, unknown>;
      target[parts.at(-1)!] = `English wording: ${field.text}`;
    }
    expect(validateUnitTranslation(source, translated)).toEqual([]);
    const knowledge = knowledgeFixture();
    const translatedKnowledge = structuredClone(knowledge);
    for (const field of knowledgeTranslationFields(knowledge)) {
      const parts = field.path.split('.');
      let target = translatedKnowledge as unknown as Record<string, unknown>;
      for (const key of parts.slice(0, -1)) target = target[key] as Record<string, unknown>;
      target[parts.at(-1)!] = `English wording: ${field.text}`;
    }
    expect(validateKnowledgeTranslation(knowledge, translatedKnowledge)).toEqual([]);
  });

  it('allows translated German words inside math \text{} and rejects changed formula bytes outside it', () => {
    const source = unitFixture();
    source.levels[0]!.questions[0]!.explanation = 'Menge $\\text{Teilmenge} \subseteq B$.';
    const accepted = structuredClone(source);
    accepted.levels[0]!.questions[0]!.explanation = 'Set $\\text{subset} \subseteq B$.';
    expect(validateUnitTranslation(source, accepted)).toEqual([]);
    const rejected = structuredClone(accepted);
    rejected.levels[0]!.questions[0]!.explanation = 'Set $\\text{subset} \not\subseteq B$.';
    expect(validateUnitTranslation(source, rejected).join(' ')).toContain('mathematical notation changed');
  });

  it('rejects altered correct IDs, missing options, and lost cloze markers', () => {
    const source = unitFixture();
    const changedAnswer = structuredClone(source);
    changedAnswer.levels[0]!.questions[0]!.correct = ['a'];
    expect(validateUnitTranslation(source, changedAnswer).join(' ')).toContain('correct changed');
    const missingOption = structuredClone(source);
    missingOption.levels[0]!.questions[0]!.options.pop();
    expect(validateUnitTranslation(source, missingOption).join(' ')).toContain('Optionen');
    const lostGap = structuredClone(source);
    lostGap.levels[0]!.questions[0]!.prompt = 'Welche Aussage gilt für $A \\subseteq B$?';
    expect(validateUnitTranslation(source, lostGap).join(' ')).toContain('cloze marker ___ changed');
  });

  it('preserves structural counts, source headings, slider data and contextual code', () => {
    const source = unitFixture();
    const extraConcept = structuredClone(source);
    extraConcept.concepts.push('Extra concept');
    expect(validateUnitTranslation(source, extraConcept).join(' ')).toContain('structure');
    const missingFact = structuredClone(source);
    missingFact.keyFacts.pop();
    expect(validateUnitTranslation(source, missingFact).join(' ')).toContain('structure');
    const changedCode = structuredClone(source);
    changedCode.levels[0]!.questions[1]!.context!.content = 'int answer = 43;';
    expect(validateUnitTranslation(source, changedCode).join(' ')).toContain('context code changed');
    const knowledge = knowledgeFixture();
    knowledge.entries[0]!.heading = 'Original heading';
    const changedHeading = structuredClone(knowledge);
    changedHeading.entries[0]!.heading = 'Translated heading';
    expect(validateKnowledgeTranslation(knowledge, changedHeading).join(' ')).toContain('immutable knowledge');
  });

  it('translates slider labels while preserving numeric semantics', () => {
    const source = unitFixture();
    const question = source.levels[0]!.questions[0]!;
    question.type = 'estimate';
    question.options = [];
    question.correct = [];
    question.slider = { min: 0, max: 100, step: 1, answer: 50, tolerance: 0, scale: 'linear', unit: 'Teilmengen' };
    const translated = structuredClone(source);
    translated.levels[0]!.questions[0]!.slider!.unit = 'subsets';
    expect(validateUnitTranslation(source, translated)).toEqual([]);
    translated.levels[0]!.questions[0]!.slider!.answer = 51;
    expect(validateUnitTranslation(source, translated).join(' ')).toContain('slider values changed');
  });

  it('preserves unit symbols even when other slider labels are translatable', () => {
    const source = unitFixture();
    const question = source.levels[0]!.questions[0]!;
    question.type = 'estimate'; question.options = []; question.correct = [];
    question.slider = { min: 0, max: 100, step: 1, answer: 50, tolerance: 0, scale: 'linear', unit: 'Byte' };
    const translated = structuredClone(source);
    translated.levels[0]!.questions[0]!.slider!.unit = 'kB';
    expect(validateUnitTranslation(source, translated).join(' ')).toContain('structure');
  });

  it('retains prefixes and mathematical values surrounding translated text', () => {
    expect(protectedTokens(String.raw`$\textbf{x} + 2$`)).not.toEqual(protectedTokens(String.raw`$\textbf{x} + 3$`));
    expect(protectedTokens(String.raw`$a + \text{Fall 1} + \text{erfüllt}$`)).toEqual(protectedTokens(String.raw`$a + \text{case 1} + \text{satisfied}$`));
    expect(protectedTokens(String.raw`$a + \text{Fall 1}$`)).not.toEqual(protectedTokens(String.raw`$b + \text{case 1}$`));
    expect(protectedTokens(String.raw`$\text{Fall 1}$`)).not.toEqual(protectedTokens(String.raw`$\text{case 2}$`));
  });

  it('runs with fixture responses and writes source hashes for stale detection', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lq-translate-'));
    const knowledgeDir = join(dir, 'wissen');
    const unitDir = join(dir, 'content', 'ds');
    mkdirSync(unitDir, { recursive: true });
    const unit = unitFixture();
    const knowledge = knowledgeFixture();
    const unitFile = join(unitDir, '01-relations.json');
    writeFileSync(unitFile, JSON.stringify(unit));
    config.knowledgeDir = knowledgeDir;
    const fieldsByCall = [unitTranslationFields(unit), knowledgeTranslationFields(knowledge)];
    let call = 0;
    const result = await translateUnit(unit, knowledge, unitFile, join(dir, 'work'), () => {}, async () => {
      const fields = fieldsByCall[call++]!;
      return { data: { translations: fields.map((field) => ({ path: field.path, text: `English: ${field.text}` })) }, tokens: 7 };
    });
    expect(call).toBe(2);
    expect(result.tokens).toBe(14);
    expect(JSON.parse(readFileSync(result.unitFile, 'utf8')).title).toBe('English: Relationen');
    expect(translationStatus(unit, knowledge, unitFile)).toEqual({ current: true, reason: '' });
  });
});

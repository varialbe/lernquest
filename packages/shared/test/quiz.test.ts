import { describe, expect, it } from 'vitest';
import { Question, Unit, checkAnswer, headingAnchor, isCorrect } from '../src/index.ts';

const base = {
  id: 'ds-01-l1-q01',
  type: 'single',
  prompt: 'Was ist $1+1$?',
  options: [
    { id: 'a', text: '1' },
    { id: 'b', text: '2' },
    { id: 'c', text: '3' },
  ],
  correct: ['b'],
  explanation: 'Weil eins plus eins zwei ist.',
  source: { file: 'DS/x.md', heading: 'Intro' },
  difficulty: 1,
  concepts: ['Addition'],
};

describe('Question schema', () => {
  it('accepts a valid single choice question', () => {
    expect(Question.safeParse(base).success).toBe(true);
  });
  it('rejects single choice with two correct answers', () => {
    expect(Question.safeParse({ ...base, correct: ['a', 'b'] }).success).toBe(false);
  });
  it('rejects unknown correct id', () => {
    expect(Question.safeParse({ ...base, correct: ['z'] }).success).toBe(false);
  });
  it('requires true/false options for truefalse', () => {
    expect(Question.safeParse({ ...base, type: 'truefalse' }).success).toBe(false);
    const tf = { ...base, type: 'truefalse', options: [{ id: 'true', text: 'Wahr' }, { id: 'false', text: 'Falsch' }], correct: ['true'] };
    expect(Question.safeParse(tf).success).toBe(true);
  });
  it('requires a gap in cloze prompts', () => {
    expect(Question.safeParse({ ...base, type: 'cloze' }).success).toBe(false);
    expect(Question.safeParse({ ...base, type: 'cloze', prompt: 'Eins plus eins ist ___.' }).success).toBe(true);
  });
  it('requires a mermaid block for diagram questions', () => {
    expect(Question.safeParse({ ...base, type: 'diagram' }).success).toBe(false);
    const d = { ...base, type: 'diagram', prompt: 'Welcher Knoten ist die Wurzel?\n\n```mermaid\ngraph TD; A-->B\n```' };
    expect(Question.safeParse(d).success).toBe(true);
  });
  it('builds heading anchors', () => {
    expect(headingAnchor('Natürliche Zahlen, Peano & Induktion')).toBe('natürliche-zahlen-peano--induktion');
  });
  it('compares selections as sets', () => {
    expect(isCorrect(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(isCorrect(['a', 'b'], ['a'])).toBe(false);
    expect(isCorrect(['a'], ['a', 'c'])).toBe(false);
  });
});

describe('estimate questions', () => {
  const est = {
    ...base,
    id: 'ds-01-l5-q01',
    type: 'estimate',
    prompt: 'Wie viele Teilmengen hat eine Menge mit 6 Elementen?',
    options: [],
    correct: [],
    slider: { min: 0, max: 100, step: 1, answer: 64, tolerance: 0, unit: null, scale: 'linear' },
  };
  it('accepts a valid slider and rejects options or missing slider', () => {
    expect(Question.safeParse(est).success).toBe(true);
    expect(Question.safeParse({ ...est, slider: undefined }).success).toBe(false);
    expect(Question.safeParse({ ...est, options: base.options }).success).toBe(false);
    expect(Question.safeParse({ ...base, slider: est.slider }).success).toBe(false);
  });
  it('rejects sliders that make guessing trivial or the answer unreachable', () => {
    expect(Question.safeParse({ ...est, slider: { ...est.slider, tolerance: 40 } }).success).toBe(false);
    expect(Question.safeParse({ ...est, slider: { ...est.slider, step: 5 } }).success).toBe(false); // 64 nicht in 5er-Schritten
    expect(Question.safeParse({ ...est, slider: { ...est.slider, max: 100000 } }).success).toBe(false); // zu viele Schritte
    expect(Question.safeParse({ ...est, slider: { min: 1, max: 1e9, step: 1, answer: 1e6, tolerance: 1e3, unit: null, scale: 'log' } }).success).toBe(false); // Log braucht ≥ 5 %
    expect(Question.safeParse({ ...est, slider: { min: 1, max: 1e9, step: 1, answer: 1e6, tolerance: 4e5, unit: 'Bytes', scale: 'log' } }).success).toBe(true);
  });
  it('checks values against the tolerance', () => {
    const q = Question.parse({ ...est, slider: { ...est.slider, tolerance: 2 } });
    expect(checkAnswer(q, ['64'])).toBe(true);
    expect(checkAnswer(q, ['62'])).toBe(true);
    expect(checkAnswer(q, ['61'])).toBe(false);
    expect(checkAnswer(q, ['abc'])).toBe(false);
    expect(checkAnswer(q, [])).toBe(false);
    expect(checkAnswer(Question.parse(base), ['b'])).toBe(true);
  });
});

describe('unit levels', () => {
  const lvl = (i: number, kind: string) => ({ id: `ds-01-l${i}`, index: i, kind, title: kind, questions: Array.from({ length: 8 }, (_, k) => ({ ...base, id: `ds-01-l${i}-q${k}` })) });
  const unit = {
    schemaVersion: 1, id: 'ds-01', module: 'DS', number: 1, slug: 'x', title: 'Titel', summary: 'Eine Zusammenfassung.', concepts: ['K'], keyFacts: [], tags: [], links: [],
    source: { file: 'f', sha256: 'a'.repeat(64), commit: 'c' },
    generator: { model: 'm', effort: 'e', reviewEffort: 'r', promptVersion: 'v', generatedAt: '', review: { checked: 0, fixed: 0, removed: 0, notes: '' } },
    levels: [lvl(1, 'basics'), lvl(2, 'apply'), lvl(3, 'deepen'), lvl(4, 'boss')],
  };
  it('allows an optional 5th bonus level only in last position', () => {
    expect(Unit.safeParse(unit).success).toBe(true);
    expect(Unit.safeParse({ ...unit, levels: [...unit.levels, lvl(5, 'bonus')] }).success).toBe(true);
    expect(Unit.safeParse({ ...unit, levels: [...unit.levels, lvl(5, 'boss')] }).success).toBe(false);
  });
});

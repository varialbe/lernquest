import { describe, expect, it } from 'vitest';
import { Question, headingAnchor, isCorrect } from '../src/index.ts';

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

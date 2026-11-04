import { describe, expect, it } from 'vitest';
import { mermaidLabels, mermaidSkeleton, replaceMermaidLabels, replaceTextMermaidLabels, textMermaidLabels, translatableLabel } from '../src/mermaid.ts';

const flow = `flowchart TD
  B["8×8-Brett: ein Feld fehlt"] --> Z[In Quadranten teilen]
  Z -->|ja| Q1(Fall eins)
  C{"R ∈ R?"} -- nein --> N((Widerspruch))
  S1([Start]) --> L1((loop)) --> X1(( )) --> L1
  subgraph reduzierbar
  p((p)) --> q((q))
  end
  subgraph g2[Zweite Gruppe]
  A>Signal] --> D[[Unterprogramm]]
  end
  classDef hot fill:#f96`;

describe('mermaid labels', () => {
  it('finds node, edge and subgraph labels without touching ids', () => {
    const texts = mermaidLabels(flow).filter(translatableLabel).map((l) => l.text);
    expect(texts).toEqual(['8×8-Brett: ein Feld fehlt', 'In Quadranten teilen', 'ja', 'Fall eins', 'nein', 'Widerspruch', 'Start', 'loop', 'reduzierbar', 'Zweite Gruppe', 'Signal', 'Unterprogramm']);
  });

  it('replaces labels, keeps the skeleton and quotes unsafe text', () => {
    const english = ['8×8 board: one square missing', 'Split into quadrants (4)', 'yes', 'Case one', 'no', 'Contradiction', 'Start', 'loop', 'reducible', 'Second group', 'Signal', 'Subroutine'];
    const out = replaceMermaidLabels(flow, english);
    expect(out).toContain('Z["Split into quadrants (4)"]');
    expect(out).toContain('subgraph reduzierbar["reducible"]');
    expect(out).toContain('-->|yes| Q1(Case one)');
    expect(out).toContain('-- no --> N((Contradiction))');
    expect(out).toContain('classDef hot fill:#f96');
    expect(mermaidSkeleton(out)).toBe(mermaidSkeleton(flow));
    expect(mermaidLabels(out).filter(translatableLabel).map((l) => l.text)).toEqual(english);
  });

  it('detects structural changes', () => {
    expect(mermaidSkeleton(flow.replace('Z -->|ja| Q1', 'Z -->|ja| Q2'))).not.toBe(mermaidSkeleton(flow));
    expect(mermaidSkeleton(flow.replace('[In Quadranten teilen]', '[Split]'))).toBe(mermaidSkeleton(flow));
  });

  it('handles mermaid fences inside markdown text', () => {
    const text = 'Betrachte:\n\n```mermaid\nflowchart LR\n  A["Alphabet"] --> W["Wörter"]\n```\n\nWas folgt?';
    expect(textMermaidLabels(text)).toEqual(['Alphabet', 'Wörter']);
    const out = replaceTextMermaidLabels(text, ['Alphabet', 'Words']);
    expect(out).toBe('Betrachte:\n\n```mermaid\nflowchart LR\n  A["Alphabet"] --> W["Words"]\n```\n\nWas folgt?');
  });
});

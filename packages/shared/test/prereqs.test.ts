import { describe, expect, it } from 'vitest';
import { buildLearningPaths, KnowledgeGraph, suggestSemanticDuplicates, type PrereqLink } from '../src/index.ts';

const edge = (id: string, type: PrereqLink['type'] = 'essential'): PrereqLink => ({ id, type, why: 'Die Definition wird für den Zielbegriff direkt verwendet.', legacy: false, locked: false });

describe('KnowledgeGraph v1/v2', () => {
  it('normalizes v1 edges as legacy essential edges', () => {
    const graph = KnowledgeGraph.parse({
      schemaVersion: 1,
      module: 'ERA',
      units: { 'era-01': { knowledgeAt: 'a', generatedAt: 'b', model: 'm' } },
      requires: { 'era-01-k02': [{ id: 'era-01-k01', why: 'Früher eingeführter Begriff.' }] },
    });
    expect(graph.schemaVersion).toBe(2);
    expect(graph.aliases).toEqual({});
    expect(graph.requires['era-01-k02']![0]).toMatchObject({ type: 'essential', legacy: true, locked: false });
  });

  it('validates v2 per-type limits and duplicate ids', () => {
    const links = Array.from({ length: 6 }, (_, i) => ({ id: `ds-01-k0${i + 1}`, type: 'essential', why: 'Eine konkrete Teildefinition wird direkt verwendet.', legacy: false, locked: false }));
    const invalid = KnowledgeGraph.safeParse({ schemaVersion: 2, module: 'DS', units: {}, requires: { 'ds-02-k01': links }, aliases: {} });
    expect(invalid.success).toBe(false);
    const duplicate = KnowledgeGraph.safeParse({ schemaVersion: 2, module: 'DS', units: {}, requires: { 'ds-02-k01': [edge('ds-01-k01'), edge('ds-01-k01', 'related')] }, aliases: {} });
    expect(duplicate.success).toBe(false);
  });
});

describe('Lernpfadberechnung', () => {
  it('does not count optional background edges between core entries as essential depth', () => {
    const entries = [
      { id: 'a', unitNumber: 1, order: 0, requires: [edge('b', 'background')] },
      { id: 'b', unitNumber: 1, order: 1, requires: [] },
      { id: 'target', unitNumber: 2, order: 0, requires: [edge('a'), edge('b')] },
    ];
    const paths = buildLearningPaths('target', entries);
    expect(paths.core).toEqual({ ids: ['a', 'b', 'target'], depth: 2 });
    expect(paths.extended).toEqual({ ids: ['b', 'a', 'target'], depth: 3, backgroundIds: [] });
  });

  it('zeigt gemeinsame Vorgänger einmal, ordnet topologisch und trennt essential von background', () => {
    const entries = [
      { id: 'a', unitNumber: 1, order: 0, requires: [] },
      { id: 'b', unitNumber: 1, order: 1, requires: [edge('a')] },
      { id: 'c', unitNumber: 1, order: 2, requires: [edge('a'), edge('b-alias')] },
      { id: 'background', unitNumber: 1, order: 3, requires: [] },
      { id: 'related', unitNumber: 1, order: 4, requires: [] },
      { id: 'target', unitNumber: 2, order: 0, requires: [edge('b'), edge('c'), edge('background', 'background'), edge('related', 'related')] },
      { id: 'b-alias', unitNumber: 2, order: 1, requires: [] },
    ];
    const paths = buildLearningPaths('target', entries, { 'b-alias': 'b' });
    expect(paths.core.ids).toEqual(['a', 'b', 'c', 'target']);
    expect(new Set(paths.core.ids).size).toBe(paths.core.ids.length);
    expect(paths.extended.ids).toEqual(['a', 'b', 'c', 'background', 'target']);
    expect(paths.extended.backgroundIds).toEqual(['background']);
    expect(paths.core.depth).toBe(4);
    expect(paths.extended.depth).toBe(4);
  });

  it('only suggests alias candidates with substantial shared multiword names', () => {
    const suggestions = suggestSemanticDuplicates([
      { id: 'a', term: 'Program Counter' },
      { id: 'b', term: 'Program Counter und Kontrollfluss' },
      { id: 'c', term: 'Stack' },
      { id: 'd', term: 'Stackframe' },
      { id: 'd2', term: 'Stackframe' },
      { id: 'e', term: 'Relation' },
      { id: 'f', term: 'Äquivalenzrelation' },
    ]);
    expect(suggestions.map((pair) => [pair.left, pair.right])).toContainEqual(['a', 'b']);
    expect(suggestions.map((pair) => [pair.left, pair.right])).toContainEqual(['d', 'd2']);
    expect(suggestions.some((pair) => pair.left === 'c' || pair.right === 'c')).toBe(false);
    expect(suggestions.some((pair) => pair.left === 'e' || pair.right === 'e')).toBe(false);
  });
});

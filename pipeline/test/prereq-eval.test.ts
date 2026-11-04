import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateGraphs, evaluatePrereqs } from '../src/prereq-eval.ts';
import type { KnowledgeGraph, ModuleId, PrereqLink } from '@lernquest/shared';

describe('Voraussetzungs-Evaluation', () => {
  it('counts confirmed prerequisite aliases as the same concept and reports raw IDs separately', () => {
    const graphs = new Map<ModuleId, KnowledgeGraph>((['DS', 'EIP', 'ERA'] as const).map((module) => [module, {
      schemaVersion: 2, module, units: {}, requires: {}, aliases: {},
    }]));
    const edge = (id: string): PrereqLink => ({ id, type: 'essential', why: 'Die direkte Definition erläutert diesen Begriff.', legacy: false, locked: false });
    const era = graphs.get('ERA')!;
    era.requires['era-10-k02'] = [edge('era-06-k13'), edge('era-06-k03')];
    era.aliases = { 'era-10-k01': 'era-06-k13', 'era-10-k23': 'era-06-k03' };
    const metrics = evaluateGraphs(graphs, {
      expectedDuplicatePairs: [], orderConstraints: [], mustEssentialChains: [],
      entries: [{ id: 'era-10-k02', mustEssential: ['era-10-k01'], allowedEssential: ['era-10-k01'], mustNotEssential: ['era-10-k23'], note: 'Stack is essential; PC is not.' }],
    });
    expect(metrics).toMatchObject({ precision: 0.5, recall: 1, rawPrecision: 0, rawRecall: 0, missing: 0, unnecessary: 1 });
  });

  it('includes the Stackframe regression and preserves the required essential chain', () => {
    const gold = JSON.parse(readFileSync(join(process.cwd(), 'eval/prereqs/gold.json'), 'utf8'));
    const stackframe = gold.entries.find((entry: { id: string }) => entry.id === 'era-10-k02');
    expect(stackframe.mustEssential).toContain('era-10-k01');
    expect(stackframe.mustNotEssential).toEqual(expect.arrayContaining(['era-10-k10', 'era-10-k23', 'era-10-k16']));
    expect(gold.entries.some((entry: { id: string }) => entry.id === 'era-06-k12')).toBe(true);
    const report = evaluatePrereqs();
    expect(report.rows[0]!.metrics.cycles).toBe(0);
    expect(report.rows[0]!.metrics.chainsExpected).toBe(3);
    expect(report.text).toContain('Aktuell (Baseline)');
  });
});

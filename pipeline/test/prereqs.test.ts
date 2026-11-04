import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { UnitKnowledge } from '@lernquest/shared';

const dir = mkdtempSync(join(tmpdir(), 'lq-prereq-'));
let P: typeof import('../src/prereqs.ts');

const unit = (n: number, terms: string[], at = '2026-11-02T00:00:00Z'): UnitKnowledge => ({
  schemaVersion: 1,
  unitId: `ds-0${n}`,
  module: 'DS',
  unitNumber: n,
  unitTitle: `Unit ${n}`,
  sourceSha: `sha${n}`,
  overview: 'o',
  entries: terms.map((term, i) => ({ id: `ds-0${n}-k0${i + 1}`, term, kind: 'definition', short: 's', explanation: 'e', example: null, pitfalls: [], related: [], heading: null })),
  generator: { model: 'm', effort: 'x', promptVersion: 'k1', generatedAt: at },
});
const save = (k: UnitKnowledge) => writeFileSync(join(dir, 'ds', `${k.unitId}.json`), JSON.stringify(k));
const link = (id: string, ...req: string[]) => ({ id, requires: req.map((r) => ({ id: r, type: 'essential' as const, why: 'Die Definition dieses Eintrags wird im Zielbegriff direkt verwendet.' })) });

beforeAll(async () => {
  const { config } = await import('../src/config.ts');
  config.knowledgeDir = dir;
  mkdirSync(join(dir, 'ds'), { recursive: true });
  P = await import('../src/prereqs.ts');
});

describe('voraussetzungen', () => {
  it('keeps canonical aliases earlier and rejects cycles introduced by alias resolution', () => {
    const u1 = unit(1, ['Erster Begriff', 'Zwischenbegriff', 'Alias']);
    const u2 = unit(2, ['Späterer Begriff', 'B', 'C']);
    const empty = { schemaVersion: 2 as const, module: 'DS' as const, units: {}, requires: {}, aliases: {} };
    const reversed = P.buildPrereqsGraph(empty, u2, { links: [], aliases: [{ id: 'ds-01-k01', canonicalId: 'ds-02-k01', confirmed: true }] }, [u1, u2]);
    expect(reversed.graph.aliases).toEqual({});
    expect(reversed.dropped.join()).toContain('kanonischer Eintrag muss früher stehen');
    const cycled = P.buildPrereqsGraph(empty, u1, {
      links: [link('ds-01-k01', 'ds-01-k02'), link('ds-01-k02', 'ds-01-k03')],
      aliases: [{ id: 'ds-01-k03', canonicalId: 'ds-01-k01', confirmed: true }],
    }, [u1]);
    expect(cycled.graph.aliases).toEqual({});
    expect(cycled.dropped.join()).toContain('Alias erzeugt Lernpfad-Zyklus');
    expect(P.hasCanonicalPrereqCycle(cycled.graph.requires, { 'ds-01-k03': 'ds-01-k01' })).toBe(true);
    const existingAlias = P.buildPrereqsGraph({ ...empty, aliases: { 'ds-01-k03': 'ds-01-k01' } }, u1, {
      links: [link('ds-01-k01', 'ds-01-k02'), link('ds-01-k02', 'ds-01-k03')],
    }, [u1]);
    expect(P.hasCanonicalPrereqCycle(existingAlias.graph.requires, existingAlias.graph.aliases)).toBe(false);
    expect(existingAlias.dropped.join()).toContain('Alias erzeugt Lernpfad-Zyklus');
  });

  it('proposes exact repeated terms as aliases without merging Stack and Stackframe', () => {
    const sample = unit(1, ['Stack', 'Stackframe', 'Stackframe']);
    expect(P.semanticDuplicateCandidates(sample.entries)).toEqual([{ left: 'ds-01-k02', right: 'ds-01-k03', score: 1 }]);
  });

  it('keeps only valid edges: no unknown ids, no later units, no cycles (edges to earlier entries win)', () => {
    const u1 = unit(1, ['Menge', 'Element', 'Teilmenge']);
    const u2 = unit(2, ['Potenzmenge', 'Mächtigkeit', 'Partition']);
    save(u1);
    save(u2);
    const r = P.applyPrereqs(u1, { links: [link('ds-01-k01', 'ds-01-k03'), link('ds-01-k02', 'ds-01-k01'), link('ds-01-k03', 'ds-01-k01', 'ds-01-k02', 'ds-02-k01', 'zz-01-k01')] }, [u1, u2]);
    expect(r.dropped.join(' | ')).toMatch(/ds-01-k03 → ds-02-k01: spätere Unit.*unbekannter Eintrag|unbekannter Eintrag.*spätere Unit/);
    expect(r.dropped.join()).toContain('ds-01-k01 → ds-01-k03: Zyklus');
    const g = P.readGraph('DS');
    expect(g.requires['ds-01-k01']).toEqual([]);
    expect(g.requires['ds-01-k03']!.map((l) => [l.id, l.type])).toEqual([['ds-01-k02', 'essential'], ['ds-01-k01', 'background']]);
    P.applyPrereqs(u2, { links: [link('ds-02-k01', 'ds-01-k03')] }, [u1, u2]);
    expect(P.checkKnowledge([{ id: 'ds-01', module: 'DS', source: { sha256: 'sha1' } }, { id: 'ds-02', module: 'DS', source: { sha256: 'sha2' } }])).toEqual([]);
  });

  it('marks later units stale when an earlier unit gets a new knowledge collection', () => {
    const u1 = unit(1, ['Menge', 'Element', 'Teilmenge'], '2026-11-03T00:00:00Z'); // neu generiert
    const u2 = unit(2, ['Potenzmenge', 'Mächtigkeit', 'Partition']);
    save(u1);
    P.applyPrereqs(u1, { links: [] }, [u1, u2]);
    expect(P.prereqsStale(u2)).toBe(true);
    expect(P.checkKnowledge([{ id: 'ds-02', module: 'DS', source: { sha256: 'sha2' } }])).toEqual(['ds-02: Voraussetzungen fehlen oder passen nicht zur aktuellen Wissenssammlung']);
  });

  it('rejects generic reasons, honors per-type limits, allows related cycles, and removes transitive essential edges when background is full', () => {
    const u1 = unit(1, ['Menge', 'Teilmenge', 'Potenzmenge', 'Begriff', 'Kern', 'Ast', 'Blatt', 'Knoten', 'Wurzel']);
    save(u1);
    const raw = {
      links: [
        { id: 'ds-01-k01', requires: [{ id: 'ds-01-k02', type: 'related' as const, why: 'Diese Begriffe sind ein hilfreicher Kontrast.' }] },
        { id: 'ds-01-k02', requires: [{ id: 'ds-01-k01', type: 'essential' as const, why: 'Die Teilmengenbeschreibung verwendet die zugrunde liegende Menge.' }] },
        { id: 'ds-01-k04', requires: [{ id: 'ds-01-k05', type: 'essential' as const, why: 'Die vorherige Teildefinition wird hier direkt verwendet.' }] },
        { id: 'ds-01-k05', requires: [{ id: 'ds-01-k04', type: 'related' as const, why: 'Diese Begriffe dienen als gegenseitige Beispiele.' }] },
        { id: 'ds-01-k08', requires: [{ id: 'ds-01-k09', type: 'related' as const, why: 'Diese Bezeichnungen stehen im Kontrast zueinander.' }] },
        { id: 'ds-01-k09', requires: [{ id: 'ds-01-k08', type: 'related' as const, why: 'Diese Bezeichnungen stehen im Kontrast zueinander.' }] },
        { id: 'ds-01-k03', requires: [
          { id: 'ds-01-k02', type: 'essential' as const, why: 'Eine Potenzmenge besteht aus allen Teilmengen.' },
          { id: 'ds-01-k01', type: 'essential' as const, why: 'Eine Potenzmenge besteht aus allen Teilmengen.' },
          { id: 'ds-01-k04', type: 'background' as const, why: 'Dieser Begriff liefert historischen Kontext.' },
          { id: 'ds-01-k05', type: 'background' as const, why: 'Dieser Kern liefert architektonischen Kontext.' },
          { id: 'ds-01-k06', type: 'background' as const, why: 'Dieser Ast liefert weiteren Kontext.' },
          { id: 'ds-01-k07', type: 'background' as const, why: 'Dieses Blatt liefert einen Überblick.' },
          { id: 'ds-01-k08', type: 'essential' as const, why: 'Grundlage für diesen Begriff.' },
          { id: 'ds-01-k09', type: 'related' as const, why: 'Eine verwandte Bezeichnung mit anderen Inhalten.' },
        ] },
      ],
    };
    const result = P.buildPrereqsGraph({ schemaVersion: 2, module: 'DS', units: {}, requires: {}, aliases: {} }, u1, raw, [u1]);
    expect(result.dropped.join('\n')).toContain('generische Begründung');
    const powerSet = result.graph.requires['ds-01-k03']!;
    expect(powerSet.filter((r) => r.type === 'essential').map((r) => r.id)).toEqual(['ds-01-k02']);
    expect(powerSet.some((r) => r.id === 'ds-01-k01')).toBe(false);
    expect(result.dropped.join('\n')).toContain('transitive essential-Kante entfernt');
    expect(powerSet.filter((r) => r.type === 'background')).toHaveLength(4);
    expect(result.graph.requires['ds-01-k01']!.some((r) => r.id === 'ds-01-k02' && r.type === 'related')).toBe(true);
    expect(result.graph.requires['ds-01-k02']!.some((r) => r.id === 'ds-01-k01' && r.type === 'essential')).toBe(true);
    expect(result.graph.requires['ds-01-k08']!.some((r) => r.id === 'ds-01-k09' && r.type === 'related')).toBe(true);
    expect(result.graph.requires['ds-01-k09']!.some((r) => r.id === 'ds-01-k08' && r.type === 'related')).toBe(true);

    const smaller = P.buildPrereqsGraph({ schemaVersion: 2, module: 'DS', units: {}, requires: {}, aliases: {} }, u1, {
      links: [
        { id: 'ds-01-k01', requires: [] },
        { id: 'ds-01-k02', requires: [{ id: 'ds-01-k01', type: 'essential', why: 'Ein Teilmengenbegriff verwendet eine Menge als Ausgangsobjekt.' }] },
        { id: 'ds-01-k03', requires: [
          { id: 'ds-01-k02', type: 'essential', why: 'Alle Teilmengen werden als Kandidaten gebildet.' },
          { id: 'ds-01-k01', type: 'essential', why: 'Alle Teilmengen werden als Kandidaten gebildet.' },
        ] },
      ],
    }, [u1]);
    expect(smaller.graph.requires['ds-01-k03']!.find((r) => r.id === 'ds-01-k01')?.type).toBe('background');
  });

  it('preserves manually locked edges and normalizes v1 input as legacy essential', async () => {
    const first = unit(1, ['Menge', 'Teilmenge', 'Potenzmenge']);
    save(first);
    const v1 = { schemaVersion: 1, module: 'DS', units: {}, requires: { 'ds-01-k03': [{ id: 'ds-01-k01', why: 'Die Definition wird im Zielbegriff direkt verwendet.' }] } };
    writeFileSync(join(dir, 'ds', '_voraussetzungen.json'), JSON.stringify(v1));
    const legacy = P.readGraph('DS');
    expect(legacy.schemaVersion).toBe(2);
    expect(legacy.requires['ds-01-k03']![0]).toMatchObject({ type: 'essential', legacy: true });
    const manual = structuredClone(legacy);
    manual.requires['ds-01-k03']![0]!.locked = true;
    const built = P.buildPrereqsGraph(manual, first, { links: [link('ds-01-k03', 'ds-01-k02')] }, [first]);
    expect(built.graph.requires['ds-01-k03']).toEqual([manual.requires['ds-01-k03']![0]]);
  });
});

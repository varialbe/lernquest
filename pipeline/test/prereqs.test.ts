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
const link = (id: string, ...req: string[]) => ({ id, requires: req.map((r) => ({ id: r, why: 'weil' })) });

beforeAll(async () => {
  const { config } = await import('../src/config.ts');
  config.knowledgeDir = dir;
  mkdirSync(join(dir, 'ds'), { recursive: true });
  P = await import('../src/prereqs.ts');
});

describe('voraussetzungen', () => {
  it('keeps only valid edges: no unknown ids, no later units, no cycles (edges to earlier entries win)', () => {
    const u1 = unit(1, ['Menge', 'Element', 'Teilmenge']);
    const u2 = unit(2, ['Potenzmenge']);
    save(u1);
    save(u2);
    const r = P.applyPrereqs(u1, { links: [link('ds-01-k01', 'ds-01-k03'), link('ds-01-k02', 'ds-01-k01'), link('ds-01-k03', 'ds-01-k01', 'ds-01-k02', 'ds-02-k01', 'zz-01-k01')] }, [u1, u2]);
    expect(r.dropped.join(' | ')).toMatch(/ds-01-k03 → ds-02-k01: spätere Unit.*unbekannter Eintrag|unbekannter Eintrag.*spätere Unit/);
    expect(r.dropped.join()).toContain('ds-01-k01 → ds-01-k03: Zyklus');
    const g = P.readGraph('DS');
    expect(g.requires['ds-01-k01']).toEqual([]);
    expect(g.requires['ds-01-k03']!.map((l) => l.id)).toEqual(['ds-01-k01', 'ds-01-k02']);
    P.applyPrereqs(u2, { links: [link('ds-02-k01', 'ds-01-k03')] }, [u1, u2]);
    expect(P.checkKnowledge([{ id: 'ds-01', module: 'DS', source: { sha256: 'sha1' } }, { id: 'ds-02', module: 'DS', source: { sha256: 'sha2' } }])).toEqual([]);
  });

  it('marks later units stale when an earlier unit gets a new knowledge collection', () => {
    const u1 = unit(1, ['Menge', 'Element', 'Teilmenge'], '2026-11-03T00:00:00Z'); // neu generiert
    const u2 = unit(2, ['Potenzmenge']);
    save(u1);
    P.applyPrereqs(u1, { links: [] }, [u1, u2]);
    expect(P.prereqsStale(u2)).toBe(true);
    expect(P.checkKnowledge([{ id: 'ds-02', module: 'DS', source: { sha256: 'sha2' } }])).toEqual(['ds-02: Voraussetzungen fehlen oder passen nicht zur aktuellen Wissenssammlung']);
  });
});

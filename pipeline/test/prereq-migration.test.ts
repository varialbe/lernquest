import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { UnitKnowledge } from '@lernquest/shared';

const root = mkdtempSync(join(tmpdir(), 'lq-prereq-migration-'));
let config: typeof import('../src/config.ts').config;
let run: typeof import('../src/prereq-migration.ts').runPrereqMigration;
let options: typeof import('../src/prereq-migration.ts').parseMigrationOptions;

const unit: UnitKnowledge = {
  schemaVersion: 1,
  unitId: 'ds-01', module: 'DS', unitNumber: 1, unitTitle: 'Mengen', sourceSha: 'sha', overview: 'Überblick',
  entries: ['Menge', 'Teilmenge', 'Potenzmenge'].map((term, index) => ({
    id: `ds-01-k0${index + 1}`, term, kind: 'definition' as const, short: `${term} kurz.`, explanation: `${term} erklärt.`,
    example: null, pitfalls: [], related: [], heading: null,
  })),
  generator: { model: 'test', effort: 'high', promptVersion: 'k1', generatedAt: '2026-11-03T00:00:00.000Z' },
};
const knowledgeDir = join(root, 'wissen');
const dataDir = join(root, 'data');
const graphFile = join(knowledgeDir, 'ds', '_voraussetzungen.json');
const knowledgeFile = join(knowledgeDir, 'ds', 'ds-01.json');
const stamp = 'fixture-run';
const fixture = async () => ({
  links: [
    { id: 'ds-01-k01', requires: [] },
    { id: 'ds-01-k02', requires: [{ id: 'ds-01-k01', type: 'essential' as const, why: 'Eine Teilmenge besteht aus Elementen einer festgelegten Menge.' }] },
    { id: 'ds-01-k03', requires: [{ id: 'ds-01-k02', type: 'essential' as const, why: 'Die Potenzmenge enthält alle Teilmengen.' }] },
  ],
  aliases: [],
});

beforeAll(async () => {
  const imported = await import('../src/config.ts');
  config = imported.config;
  config.knowledgeDir = knowledgeDir;
  config.dataDir = dataDir;
  mkdirSync(join(knowledgeDir, 'ds'), { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(knowledgeFile, JSON.stringify(unit, null, 2));
  writeFileSync(graphFile, JSON.stringify({
    schemaVersion: 1, module: 'DS', units: {},
    requires: { 'ds-01-k02': [{ id: 'ds-01-k01', why: 'Ein Teilmengenbegriff verwendet eine Menge.' }] },
  }, null, 2) + '\n');
  for (const module of ['eip', 'era']) {
    mkdirSync(join(knowledgeDir, module), { recursive: true });
    writeFileSync(join(knowledgeDir, module, '_voraussetzungen.json'), JSON.stringify({ schemaVersion: 1, module: module.toUpperCase(), units: {}, requires: {} }));
  }
  const migration = await import('../src/prereq-migration.ts');
  run = migration.runPrereqMigration;
  options = migration.parseMigrationOptions;
});

describe('Voraussetzungs-Migration', () => {
  it('rejects incomplete model classifications without replacing any graph', async () => {
    const original = readFileSync(graphFile, 'utf8');
    await expect(run({ stamp: 'incomplete', module: 'DS', dryRun: true }, async () => ({ links: [] }))).rejects.toThrow('Klassifikation fehlt');
    expect(readFileSync(graphFile, 'utf8')).toBe(original);
    expect(existsSync(join(dataDir, 'prereq-migration', 'incomplete', 'manifest.json'))).toBe(true);
    expect(existsSync(join(dataDir, 'prereq-migration', 'incomplete', 'ds-01.json'))).toBe(false);
  });

  it('supports dry-run, resume, apply without new LLM calls, idempotence, and rollback', async () => {
    const originalGraph = readFileSync(graphFile, 'utf8');
    const originalKnowledge = readFileSync(knowledgeFile, 'utf8');
    const result = await run({ stamp, module: 'DS', dryRun: true }, fixture);
    expect(result).toMatchObject({ stamp, unitCount: 1 });
    expect(readFileSync(graphFile, 'utf8')).toBe(originalGraph);
    expect(readFileSync(knowledgeFile, 'utf8')).toBe(originalKnowledge);
    const { evaluatePrereqs } = await import('../src/prereq-eval.ts');
    expect(evaluatePrereqs(result.directory).rows).toHaveLength(2);

    const resumed = await run({ stamp, module: 'DS', dryRun: true, resume: true }, async () => { throw new Error('Resume hat die gespeicherte Antwort nicht übersprungen.'); });
    expect(resumed).toMatchObject({ stamp, unitCount: 1 });

    const applied = await run({ stamp, module: 'DS', apply: true });
    expect(applied.message).toContain('angewandt');
    const appliedBytes = readFileSync(graphFile, 'utf8');
    expect(JSON.parse(appliedBytes).schemaVersion).toBe(2);
    expect(JSON.parse(appliedBytes).requires['ds-01-k03'][0].type).toBe('essential');
    expect((await run({ stamp, module: 'DS', apply: true })).message).toContain('bereits angewandt');
    expect(readFileSync(graphFile, 'utf8')).toBe(appliedBytes);

    await run({ rollback: stamp });
    expect(readFileSync(graphFile, 'utf8')).toBe(originalGraph);
    expect(readFileSync(knowledgeFile, 'utf8')).toBe(originalKnowledge);
  });

  it('parses selected modules, units, resume, apply, and rollback flags', () => {
    expect(options(['--module', 'era', '--unit', 'era-10', '--dry-run', '--stamp', 'x', '--resume'])).toMatchObject({ module: 'ERA', unit: 'era-10', dryRun: true, stamp: 'x', resume: true });
    expect(options(['--apply', '--stamp', 'x'])).toMatchObject({ apply: true, stamp: 'x' });
    expect(options(['--rollback', 'x'])).toMatchObject({ rollback: 'x' });
  });
});

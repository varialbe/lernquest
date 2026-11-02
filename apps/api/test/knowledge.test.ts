import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { KnowledgeModuleResponse, UnitKnowledge } from '@lernquest/shared';
import { buildApp } from '../src/app.ts';
import { FETCH_TEXT } from '../src/lib/botPipeline.ts';
import { testDb } from './helpers.ts';

const dir = mkdtempSync(join(tmpdir(), 'lq-wissen-'));
let app: FastifyInstance;
let token: string;

const knowledge: UnitKnowledge = {
  schemaVersion: 1,
  unitId: 'ds-01',
  module: 'DS',
  unitNumber: 1,
  unitTitle: 'Unit 1',
  sourceSha: 'a'.repeat(64),
  overview: 'Worum es geht.',
  entries: ['Menge', 'Teilmenge', 'Potenzmenge'].map((term, i) => ({
    id: `ds-01-k0${i + 1}`,
    term,
    kind: 'definition' as const,
    short: `${term} kurz.`,
    explanation: `${term} ausführlich mit $A \\subseteq B$.`,
    example: null,
    pitfalls: [],
    related: [],
    heading: null,
  })),
  generator: { model: 'm', effort: 'x', promptVersion: 'k1', generatedAt: '2026-11-02T00:00:00Z' },
};

beforeAll(async () => {
  process.env.KNOWLEDGE_DIR = dir;
  mkdirSync(join(dir, 'ds'), { recursive: true });
  writeFileSync(join(dir, 'ds/ds-01.json'), JSON.stringify(knowledge));
  writeFileSync(join(dir, 'ds/ds-02.json'), '{"kaputt": true}'); // ungültig → wie „noch nicht da“
  app = await buildApp(testDb());
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { inviteCode: 'LQ-TEST-CODE', username: 'wissen', email: 'w@test.local', displayName: 'W', password: 'geheim1234', acceptPrivacy: true } });
  token = res.json().token;
});

describe('wissenssammlung', () => {
  it('lists every unit of the module with its entries, units without a valid file stay empty', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/knowledge/ds', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json<KnowledgeModuleResponse>();
    expect(body.module).toBe('DS');
    expect(body.units.map((u) => [u.unitId, u.entries.length])).toEqual([
      ['ds-01', 3],
      ['ds-02', 0],
    ]);
    expect(body.units[0]!.overview).toBe('Worum es geht.');
    expect(body.units[1]!.overview).toBeNull();
  });

  it('rejects unknown modules and anonymous requests', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/knowledge/xyz', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/knowledge/ds' })).statusCode).toBe(401);
  });
});

describe('bot: freitext startet den lauf', () => {
  it.each(['hol die neuen Sachen', 'Hole neue Inhalte', 'fetch', 'update bitte', 'gibt es neue Vorlesungen?'])('„%s“ → holen', (t) => expect(FETCH_TEXT.test(t)).toBe(true));
  it.each(['Hallo', 'Newsletter schreiben', 'wie viele Abonnenten?'])('„%s“ → Menü', (t) => expect(FETCH_TEXT.test(t)).toBe(false));
});

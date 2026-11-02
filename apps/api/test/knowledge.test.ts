import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CardSession, CardsOverview, KnowledgeModuleResponse, RecapResponse, UnitKnowledge } from '@lernquest/shared';
import { nextCard } from '../src/lib/cards.ts';
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

describe('karteikarten', () => {
  const h = () => ({ authorization: `Bearer ${token}` });
  it('serves new cards in lecture order, schedules them with leitner and counts them in the overview', async () => {
    const s = (await app.inject({ method: 'GET', url: '/api/cards/ds', headers: h() })).json<CardSession>();
    expect(s.cards.map((c) => [c.entry.id, c.box])).toEqual([
      ['ds-01-k01', null],
      ['ds-01-k02', null],
      ['ds-01-k03', null],
    ]);
    const known = await app.inject({ method: 'POST', url: '/api/cards/review', headers: h(), payload: { entryId: 'ds-01-k01', known: true } });
    expect(known.json()).toMatchObject({ box: 1 });
    await app.inject({ method: 'POST', url: '/api/cards/review', headers: h(), payload: { entryId: 'ds-01-k02', known: false } });
    const o = (await app.inject({ method: 'GET', url: '/api/cards', headers: h() })).json<CardsOverview>();
    expect(o.modules.find((m) => m.id === 'DS')).toMatchObject({ total: 3, fresh: 1, learning: 2, mastered: 0, due: 0 });
    // nur die noch neue Karte kommt heute wieder
    expect((await app.inject({ method: 'GET', url: '/api/cards/ds', headers: h() })).json<CardSession>().cards.map((c) => c.entry.id)).toEqual(['ds-01-k03']);
  });
  it('rejects unknown cards', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/cards/review', headers: h(), payload: { entryId: 'ds-01-k99', known: true } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/cards/review', headers: h(), payload: { entryId: 'quatsch', known: true } })).statusCode).toBe(400);
  });
  it('climbs the boxes and parks mastered cards for 30 days', () => {
    let b: number | null = null;
    const days: number[] = [];
    for (let i = 0; i < 7; i++) {
      const n = nextCard(b, true, '2026-11-02');
      b = n.box;
      days.push(Math.round((Date.parse(n.dueDay) - Date.parse('2026-11-02')) / 86_400_000));
    }
    expect(days).toEqual([1, 2, 4, 7, 14, 30, 30]);
    expect(nextCard(6, false, '2026-11-02')).toEqual({ box: 1, dueDay: '2026-11-03' });
  });
});

describe('wochenrückblick', () => {
  it('summarises the week (quiet week → nudge towards due cards)', async () => {
    const r = (await app.inject({ method: 'GET', url: '/api/recap', headers: { authorization: `Bearer ${token}` } })).json<RecapResponse>();
    expect(r.title).toContain('Deine Woche');
    expect(r.body.length).toBeGreaterThan(10);
  });
  it('can be switched off in the settings', async () => {
    const me = await app.inject({ method: 'PATCH', url: '/api/me/settings', headers: { authorization: `Bearer ${token}` }, payload: { weeklyRecap: false } });
    expect(me.json().settings.weeklyRecap).toBe(false);
  });
});

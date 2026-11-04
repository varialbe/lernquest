import { createHash } from 'node:crypto';
import { Unit, UnitKnowledge } from '@lernquest/shared';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { translatedUnit } from '../src/lib/content-locale.ts';
import { unitKnowledge, knowledgeForModule } from '../src/lib/knowledge.ts';
import { detectLocale } from '../src/lib/locale.ts';
import { users } from '../src/db/schema.ts';
import { testDb, makeUnit } from './helpers.ts';

const contentDir = mkdtempSync(join(tmpdir(), 'lq-content-locale-'));
const knowledgeDir = mkdtempSync(join(tmpdir(), 'lq-knowledge-locale-'));
const db = testDb();
let app: FastifyInstance;
let token: string;

beforeAll(async () => {
  process.env.CONTENT_DIR = contentDir;
  process.env.KNOWLEDGE_DIR = knowledgeDir;
  const dsDir = join(contentDir, 'ds');
  mkdirSync(join(dsDir, 'en'), { recursive: true });
  const ds1 = makeUnit('DS', 1);
  const ds2 = makeUnit('DS', 2);
  writeFileSync(join(dsDir, '01-unit-1.json'), JSON.stringify(ds1));
  writeFileSync(join(dsDir, '02-unit-2.json'), JSON.stringify(ds2));
  const en1 = structuredClone(ds1);
  en1.title = 'Relations and sets';
  en1.summary = 'An English summary of this lecture unit.';
  en1.levels[0]!.title = 'Foundations';
  en1.levels[0]!.questions[0]!.prompt = 'Which statement is correct?';
  writeFileSync(join(dsDir, 'en', '01-unit-1.json'), JSON.stringify(en1));
  writeFileSync(join(dsDir, 'en', '01-unit-1.json.meta.json'), JSON.stringify({ sourceUnitHash: createHash('sha256').update(JSON.stringify(Unit.parse(ds1))).digest('hex') }));
  const stale = structuredClone(ds2);
  stale.title = 'Stale English title';
  stale.generator.generatedAt = '2020-01-01T00:00:00.000Z';
  writeFileSync(join(dsDir, 'en', '02-unit-2.json'), JSON.stringify(stale));
  writeFileSync(join(dsDir, 'en', '02-unit-2.json.meta.json'), JSON.stringify({ sourceUnitHash: createHash('sha256').update(JSON.stringify(Unit.parse(ds2))).digest('hex') }));
  app = await buildApp(db);
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers: { 'x-lq-locale': 'en', 'x-lq-device-locale': 'de' },
    payload: { username: 'locale', email: 'locale@test.local', displayName: 'Locale', password: 'geheim1234', acceptPrivacy: true },
  });
  token = login.json().token;
});

const auth = () => ({ authorization: `Bearer ${token}` });

describe('locale preference and translated content', () => {
  it('stores a language override only for an authenticated user', async () => {
    const row = db.select().from(users).where(eq(users.username, 'locale')).get()!;
    expect(row).toMatchObject({ locale: 'en', deviceLocale: 'de' });
    expect((await app.inject({ url: '/api/me', headers: auth() })).json().settings.locale).toBe('en');
    expect((await app.inject({ method: 'PATCH', url: '/api/me/settings', payload: { locale: 'de' } })).statusCode).toBe(401);
    const changed = await app.inject({ method: 'PATCH', url: '/api/me/settings', headers: auth(), payload: { locale: null } });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().settings.locale).toBeNull();
  });

  it('serves English path and quiz content, falling back to German for a stale translation', async () => {
    // Restore the explicit account choice for this request.
    await app.inject({ method: 'PATCH', url: '/api/me/settings', headers: auth(), payload: { locale: 'en' } });
    const path = (await app.inject({ url: '/api/path', headers: auth() })).json();
    const ds = path.modules.find((item: { id: string }) => item.id === 'DS');
    expect(ds.name).toBe('Discrete Structures');
    expect(ds.units[0].title).toBe('Relations and sets');
    expect(ds.units[0].levels[0].title).toBe('Foundations');
    expect(ds.units[1].title).toBe('Unit 2'); // stale English file is ignored

    const level = (await app.inject({ url: '/api/levels/ds-01-l1', headers: auth() })).json();
    expect(level.level.unitTitle).toBe('Relations and sets');
    expect(level.questions[0].prompt).toBe('Which statement is correct?');
    expect(level.questions[0].id).toBe('ds-01-l1-q01');
  });
});


describe('locale transport and source validation', () => {
  it.each([['de-AT', 'de'], ['de', 'de'], ['de-DE,en;q=0.9', 'de'], ['en-US,de;q=0.9', 'en'], ['fr', 'en'], ['', 'en']])('detects %s as %s', (header, locale) => {
    expect(detectLocale(header)).toBe(locale);
  });

  it('allows device and language headers for cross-origin native requests', async () => {
    const response = await app.inject({ method: 'OPTIONS', url: '/api/me', headers: { origin: 'capacitor://localhost', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization,x-lq-locale,x-lq-device-locale' } });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-headers']).toContain('x-lq-device-locale');
    expect(response.headers['access-control-allow-headers']).toContain('x-lq-locale');
  });

  it('adopts the local choice on login when the account follows automatic language', async () => {
    await app.inject({ method: 'PATCH', url: '/api/me/settings', headers: auth(), payload: { locale: null } });
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-lq-locale': 'de', 'x-lq-device-locale': 'de' }, payload: { username: 'locale', password: 'geheim1234' } });
    expect(response.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/me', headers: auth() })).json().settings.locale).toBe('de');
    const row = db.select().from(users).where(eq(users.username, 'locale')).get()!;
    expect(row.locale).toBe('de');
  });

  it('rejects changed answer keys even if translation metadata matches', () => {
    const source = makeUnit('EIP', 1);
    const translated = structuredClone(source);
    translated.levels[0]!.questions[0]!.correct = ['a'];
    const modDir = join(contentDir, 'eip');
    mkdirSync(join(modDir, 'en'), { recursive: true });
    writeFileSync(join(modDir, '01-unit-1.json'), JSON.stringify(source));
    writeFileSync(join(modDir, 'en', '01-unit-1.json'), JSON.stringify(translated));
    writeFileSync(join(modDir, 'en', '01-unit-1.json.meta.json'), JSON.stringify({ sourceUnitHash: createHash('sha256').update(JSON.stringify(Unit.parse(source))).digest('hex') }));
    expect(translatedUnit(source.id, 'en')).toBeNull();
  });

  it('uses English knowledge and edge reasons, then falls back when German prose changes', () => {
    const original = UnitKnowledge.parse({ schemaVersion: 1, unitId: 'ds-01', module: 'DS', unitNumber: 1, unitTitle: 'Mengen', sourceSha: 'a'.repeat(64), overview: 'Überblick.', entries: [{ id: 'ds-01-k01', term: 'Menge', kind: 'definition', short: 'Eine Sammlung.', explanation: 'Eine Sammlung mit $A$.', example: null, pitfalls: [], related: [], heading: null }, { id: 'ds-01-k02', term: 'Teilmenge', kind: 'definition', short: 'Eine Teilmenge.', explanation: 'Eine Menge in einer anderen.', example: null, pitfalls: [], related: [], heading: null }, { id: 'ds-01-k03', term: 'Potenzmenge', kind: 'definition', short: 'Menge aller Teilmengen.', explanation: 'Alle Teilmengen einer Menge.', example: null, pitfalls: [], related: [], heading: null }], generator: { model: 'test', effort: 'low', promptVersion: 'k1', generatedAt: '2026-11-01T00:00:00.000Z' } });
    const english = structuredClone(original);
    english.unitTitle = 'Sets';
    english.entries[0]!.term = 'Set';
    const modDir = join(knowledgeDir, 'ds');
    mkdirSync(join(modDir, 'en'), { recursive: true });
    writeFileSync(join(modDir, 'ds-01.json'), JSON.stringify(original));
    writeFileSync(join(modDir, 'en', 'ds-01.json'), JSON.stringify(english));
    const metaFile = join(contentDir, 'ds', 'en', '01-unit-1.json.meta.json');
    const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
    meta.sourceKnowledgeHash = createHash('sha256').update(JSON.stringify(original)).digest('hex');
    writeFileSync(metaFile, JSON.stringify(meta));
    const why = 'Mengen werden zum Verstehen von Teilmengen gebraucht.';
    writeFileSync(join(modDir, '_voraussetzungen.json'), JSON.stringify({ schemaVersion: 2, module: 'DS', units: {}, requires: { 'ds-01-k02': [{ id: 'ds-01-k01', type: 'essential', why }] }, aliases: {} }));
    writeFileSync(join(modDir, 'en', 'ds-01.prereqs.json'), JSON.stringify({ schemaVersion: 1, unitId: 'ds-01', translations: [{ entryId: 'ds-01-k02', id: 'ds-01-k01', type: 'essential', sourceWhy: why, why: 'Use the set definition to understand subsets.' }] }));
    expect(unitKnowledge('ds-01', 'en')?.entries[0]!.term).toBe('Set');
    const response = knowledgeForModule(db, 'DS', undefined, 'en');
    expect(response.units[0]!.unitTitle).toBe('Sets');
    expect(response.units[0]!.entries[1]!.requires[0]!.why).toBe('Use the set definition to understand subsets.');
    original.entries[0]!.short = 'Eine aktualisierte Beschreibung.';
    writeFileSync(join(modDir, 'ds-01.json'), JSON.stringify(original));
    expect(unitKnowledge('ds-01', 'en')?.entries[0]!.term).toBe('Menge');
  });
});


describe('authenticated cache variants', () => {
  it('separates account and language variants while preserving CORS Origin', async () => {
    await app.inject({ method: 'PATCH', url: '/api/me/settings', headers: auth(), payload: { locale: null } });
    for (const language of ['de', 'en']) {
      const response = await app.inject({ url: '/api/path', headers: { ...auth(), origin: 'capacitor://localhost', 'accept-language': language, 'x-lq-locale': 'auto', 'x-lq-device-locale': language } });
      expect(response.statusCode).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe('capacitor://localhost');
      const vary = String(response.headers.vary).toLowerCase().split(',').map((field) => field.trim());
      expect(vary).toEqual(expect.arrayContaining(['origin', 'authorization', 'accept-language', 'x-lq-locale', 'x-lq-device-locale']));
      expect(response.headers['content-language']).toBe(language);
      expect(response.headers['cache-control']).toBe('private');
      const ds = response.json().modules.find((item: { id: string }) => item.id === 'DS');
      expect(ds.name).toBe(language === 'en' ? 'Discrete Structures' : 'Diskrete Strukturen');
    }
  });

  it('varies unauthorized responses by authentication as well', async () => {
    const response = await app.inject({ url: '/api/path' });
    expect(response.statusCode).toBe(401);
    expect(String(response.headers.vary).toLowerCase()).toContain('authorization');
    expect(response.headers['content-language']).toBeUndefined();
  });
});

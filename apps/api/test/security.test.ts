import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import type { DB } from '../src/db/index.ts';
import { users } from '../src/db/schema.ts';
import { testDb } from './helpers.ts';

/** Absichtlich ohne Anmeldung erreichbar */
const PUBLIC = new Set([
  'GET /api/health',
  'GET /api/config',
  'POST /api/app/diag',
  'GET /api/app/update',
  'POST /api/auth/register',
  'POST /api/auth/login',
  'POST /api/auth/logout',
  'POST /api/auth/forgot',
  'POST /api/auth/reset',
  'GET /api/auth/verify',
  'POST /api/auth/passkey/options',
  'POST /api/auth/passkey/login',
  'POST /api/auth/google/start',
  'GET /api/auth/google/callback',
  'POST /api/auth/google/exchange',
  'POST /api/auth/google/poll',
  'GET /api/auth/google/pending/:id',
  'POST /api/auth/google/complete',
  'GET /api/newsletter/confirm',
  'GET /api/newsletter/unsubscribe',
  'POST /api/newsletter/unsubscribe',
]);

let db: DB;
let app: FastifyInstance;
beforeEach(async () => {
  db = testDb();
  app = await buildApp(db);
});
const fill = (url: string) => url.replace(/:[a-zA-Z]+/g, '1');

describe('access control', () => {
  it('every non-public route rejects anonymous requests', async () => {
    const open: string[] = [];
    for (const r of app.routeList) {
      const key = `${r.method} ${r.url}`;
      if (PUBLIC.has(key)) continue;
      const res = await app.inject({ method: r.method as 'GET', url: fill(r.url), payload: r.method === 'GET' || r.method === 'DELETE' ? undefined : {} });
      if (res.statusCode !== 401) open.push(`${key} → ${res.statusCode}`);
    }
    expect(open).toEqual([]);
    expect(app.routeList.length).toBeGreaterThan(50);
  });

  it('every admin route rejects normal users', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'mallory', email: 'm@example.org', displayName: 'M', password: 'geheim1234', acceptPrivacy: true } });
    const headers = { authorization: `Bearer ${r.json().token}` };
    expect(db.select().from(users).where(eq(users.username, 'mallory')).get()!.role).not.toBe('admin');
    const leaks: string[] = [];
    for (const x of app.routeList.filter((x) => x.url.startsWith('/api/admin'))) {
      const res = await app.inject({ method: x.method as 'GET', url: fill(x.url), headers, payload: x.method === 'GET' || x.method === 'DELETE' ? undefined : {} });
      if (res.statusCode !== 403) leaks.push(`${x.method} ${x.url} → ${res.statusCode}`);
    }
    expect(leaks).toEqual([]);
  });

  it('treats SQL metacharacters as plain data', async () => {
    const evil = "x' OR '1'='1";
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: evil, password: evil } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/api/profile/${encodeURIComponent("a'; drop table users;--")}` })).statusCode).toBe(401);
    expect(db.select().from(users).all()).toBeDefined();
  });
});

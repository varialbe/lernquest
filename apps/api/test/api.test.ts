import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { importUnit } from '../src/content/import.ts';
import type { DB } from '../src/db/index.ts';
import { leagueWeeks, levels, questions, reviewItems, units, users, xpEvents } from '../src/db/schema.ts';
import { hashPassword } from '../src/lib/auth.ts';
import { completeLevel } from '../src/lib/game.ts';
import { ensureLeagueRollover, leaderboard } from '../src/lib/league.ts';
import { purchase } from '../src/lib/shop.ts';
import { berlinMidnight } from '../src/lib/time.ts';
import { answersFor, makeUnit, testDb } from './helpers.ts';

let db: DB;
let app: FastifyInstance;

beforeEach(async () => {
  db = testDb();
  app = await buildApp(db);
});

async function register(username: string, inviteCode = 'LQ-TEST-CODE') {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { inviteCode, username, displayName: username, password: 'geheim1234', acceptPrivacy: true, starterPet: 'knoten' } });
  return res;
}
const authed = (token: string) => ({ authorization: `Bearer ${token}` });
const userRow = (username: string) => db.select().from(users).where(eq(users.username, username)).get()!;

describe('auth', () => {
  it('requires a valid invite code', async () => {
    expect((await register('anna', 'FALSCH')).statusCode).toBe(400);
    const ok = await register('anna');
    expect(ok.statusCode).toBe(200);
    expect(ok.json().token).toMatch(/^[\w-]{40,}$/);
  });
  it('rejects duplicate usernames case-insensitively', async () => {
    await register('Anna');
    expect((await register('anna')).statusCode).toBe(409);
  });
  it('stores argon2id hashes, never plaintext', async () => {
    await register('bob');
    expect(userRow('bob').passwordHash).toMatch(/^\$argon2id\$/);
  });
  it('logs in, accesses /me and logs out (token revoked)', async () => {
    await register('carl');
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'CARL', password: 'geheim1234', acceptPrivacy: true } });
    expect(login.statusCode).toBe(200);
    const { token } = login.json();
    const me = await app.inject({ url: '/api/me', headers: authed(token) });
    expect(me.json().user.username).toBe('carl');
    expect(me.json().pets[0].petId).toBe('knoten');
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: authed(token) });
    expect((await app.inject({ url: '/api/me', headers: authed(token) })).statusCode).toBe(401);
  });
  it('rejects wrong passwords and disabled users', async () => {
    await register('dora');
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'dora', password: 'falsch123' } })).statusCode).toBe(401);
    db.update(users).set({ disabled: true }).where(eq(users.username, 'dora')).run();
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'dora', password: 'geheim1234', acceptPrivacy: true } })).statusCode).toBe(403);
  });
  it('rate-limits login attempts', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'x', password: 'y' } })).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });
  it('blocks admin routes for normal users and allows CORS for capacitor', async () => {
    const { token } = (await register('eve')).json();
    expect((await app.inject({ url: '/api/admin/users', headers: authed(token) })).statusCode).toBe(403);
    const pre = await app.inject({ method: 'OPTIONS', url: '/api/me', headers: { origin: 'capacitor://localhost', 'access-control-request-method': 'GET' } });
    expect(pre.headers['access-control-allow-origin']).toBe('capacitor://localhost');
  });
  it('admin password reset forces a password change and revokes sessions', async () => {
    const { token } = (await register('fred')).json();
    db.insert(users).values({ username: 'boss', displayName: 'Boss', role: 'admin', passwordHash: await hashPassword('adminpass1') }).run();
    const adminToken = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'boss', password: 'adminpass1' } })).json().token;
    const reset = await app.inject({ method: 'POST', url: `/api/admin/users/${userRow('fred').id}/reset-password`, headers: authed(adminToken) });
    const temp = reset.json().temporaryPassword;
    expect((await app.inject({ url: '/api/me', headers: authed(token) })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'fred', password: temp } });
    expect(login.json().user.mustChangePassword).toBe(true);
  });
});

describe('progress, unlocks and economy', () => {
  it('unlocks levels sequentially and awards server-side XP/coins', async () => {
    const { token } = (await register('gina')).json();
    const path = (await app.inject({ url: '/api/path', headers: authed(token) })).json();
    const ds = path.modules.find((m: { id: string }) => m.id === 'DS');
    expect(ds.units[0].levels.map((l: { status: string }) => l.status)).toEqual(['open', 'locked', 'locked', 'locked']);
    expect(ds.units[1].levels[0].status).toBe('locked');
    expect((await app.inject({ url: '/api/levels/ds-02-l1', headers: authed(token) })).statusCode).toBe(403);

    const unit = makeUnit('DS', 1);
    const res = await app.inject({ method: 'POST', url: '/api/levels/ds-01-l1/complete', headers: authed(token), payload: { answers: answersFor(unit, 0, 2) } });
    const r = res.json();
    expect(r).toMatchObject({ correctFirstTry: 6, total: 8, stars: 2, xp: 10 + 2 * 6, coins: 5, streak: 1, streakIncreased: true });
    expect(r.unlocked).toEqual(['ds-01-l2']);
    // falsche Antworten landen in „Fehler üben“
    expect(db.select().from(reviewItems).all()).toHaveLength(2);
    const me = (await app.inject({ url: '/api/me', headers: authed(token) })).json();
    expect(me.stats).toMatchObject({ xp: 22, coins: 5, todayXp: 22, dueReviews: 2 });
    expect(me.pets[0].xp).toBe(22);
  });
  it('rejects incomplete submissions (client cannot cherry-pick)', async () => {
    const { token } = (await register('hans')).json();
    const answers = answersFor(makeUnit('DS', 1), 0).slice(0, 3);
    expect((await app.inject({ method: 'POST', url: '/api/levels/ds-01-l1/complete', headers: authed(token), payload: { answers } })).statusCode).toBe(400);
  });
  it('gives reduced XP and no coins for replays', async () => {
    await register('ida');
    const u = () => userRow('ida');
    const unit = makeUnit('DS', 1);
    const first = completeLevel(db, u(), 'ds-01-l1', answersFor(unit, 0));
    expect(first).toMatchObject({ xp: 10 + 16 + 5, coins: 5 + 5 + 5, dailyGoalReached: true }); // inkl. Tagesziel-Bonus
    const again = completeLevel(db, u(), 'ds-01-l1', answersFor(unit, 0));
    expect(again).toMatchObject({ xp: Math.round(31 * 0.5), coins: 0 });
  });
  it('practice mode moves questions through leitner boxes', async () => {
    const { token } = (await register('jan')).json();
    const unit = makeUnit('DS', 1);
    await app.inject({ method: 'POST', url: '/api/levels/ds-01-l1/complete', headers: authed(token), payload: { answers: answersFor(unit, 0, 3) } });
    const set = (await app.inject({ url: '/api/practice', headers: authed(token) })).json().questions;
    expect(set).toHaveLength(3);
    const done = await app.inject({ method: 'POST', url: '/api/practice/complete', headers: authed(token), payload: { answers: set.map((q: { id: string }) => ({ questionId: q.id, selected: ['b'] })) } });
    expect(done.json()).toMatchObject({ correctFirstTry: 3, xp: 5 + 3 });
    expect(db.select().from(reviewItems).all().every((r) => r.box === 2)).toBe(true);
    expect((await app.inject({ url: '/api/practice', headers: authed(token) })).json().questions).toHaveLength(0);
  });
});

describe('shop transactions', () => {
  it('deducts coins atomically and refuses when too poor or already owned', async () => {
    await register('kim');
    const id = userRow('kim').id;
    expect(() => purchase(db, id, 'pet:lambda')).toThrow('Nicht genug Coins');
    db.update(users).set({ coins: 130 }).where(eq(users.id, id)).run();
    purchase(db, id, 'pet:lambda');
    expect(userRow('kim').coins).toBe(10);
    db.update(users).set({ coins: 500 }).where(eq(users.id, id)).run();
    expect(() => purchase(db, id, 'pet:lambda')).toThrow('schon');
    expect(userRow('kim').coins).toBe(500);
  });
  it('caps streak freezes at 2', async () => {
    await register('lea');
    const id = userRow('lea').id;
    db.update(users).set({ coins: 1000 }).where(eq(users.id, id)).run();
    purchase(db, id, 'powerup:streak_freeze');
    purchase(db, id, 'powerup:streak_freeze');
    expect(() => purchase(db, id, 'powerup:streak_freeze')).toThrow('höchstens');
    expect(userRow('lea')).toMatchObject({ streakFreezes: 2, coins: 900 });
  });
  it('only allows owned themes in settings', async () => {
    const { token } = (await register('max')).json();
    const bad = await app.inject({ method: 'PATCH', url: '/api/me/settings', headers: authed(token), payload: { theme: 'ocean' } });
    expect(bad.statusCode).toBe(400);
    db.update(users).set({ coins: 100 }).where(eq(users.username, 'max')).run();
    await app.inject({ method: 'POST', url: '/api/shop/buy', headers: authed(token), payload: { itemId: 'theme:ocean' } });
    const ok = await app.inject({ method: 'PATCH', url: '/api/me/settings', headers: authed(token), payload: { theme: 'ocean' } });
    expect(ok.json().settings.theme).toBe('ocean');
  });
});

describe('content import', () => {
  it('is idempotent and keeps admin-disabled questions disabled', () => {
    expect(importUnit(db, makeUnit('DS', 1)).status).toBe('unchanged');
    db.update(questions).set({ active: false, disabledByAdmin: true }).where(eq(questions.id, 'ds-01-l1-q01')).run();
    const r = importUnit(db, makeUnit('DS', 1, { variant: ' (neu)' }));
    expect(r.status).toBe('updated');
    expect(db.select().from(questions).where(eq(questions.id, 'ds-01-l1-q01')).get()!.active).toBe(false);
    expect(db.select().from(questions).where(eq(questions.id, 'ds-01-l1-q02')).get()!.active).toBe(true);
    expect(db.select().from(units).all()).toHaveLength(2);
    expect(db.select().from(levels).all()).toHaveLength(8);
  });
  it('deactivates questions removed from the unit', () => {
    importUnit(db, makeUnit('DS', 1, { questions: 9 }));
    importUnit(db, makeUnit('DS', 1, { questions: 8, variant: 'x' }));
    expect(db.select().from(questions).where(eq(questions.id, 'ds-01-l1-q09')).get()!.active).toBe(false);
  });
});

describe('leaderboards', () => {
  it('weekly league resets on Monday 00:00 Berlin and promotes the winner', async () => {
    for (const n of ['user1', 'user2', 'user3', 'user4']) await register(n);
    const ids = ['user1', 'user2', 'user3', 'user4'].map((n) => userRow(n).id);
    const sunday = Date.parse('2026-11-01T22:30:00Z'); // So 23:30 Berlin
    const monday = Date.parse('2026-11-01T23:00:30Z'); // Mo 00:00:30 Berlin
    ids.forEach((id, i) => db.insert(xpEvents).values({ userId: id, amount: (i + 1) * 10, source: 'level', day: '2026-11-01', createdAt: sunday }).run());

    const before = leaderboard(db, ids[0]!, 'league', sunday);
    expect(before.entries.map((e) => e.value)).toEqual([40, 30, 20, 10]);
    expect(before.entries[0]!.zone).toBe('promote');
    expect(before.resetsAt).toBe(new Date(berlinMidnight('2026-11-02')).toISOString());

    const after = leaderboard(db, ids[0]!, 'league', monday);
    expect(after.entries.every((e) => e.value === 0)).toBe(true); // neue Woche
    expect(userRow('user4').leagueTier).toBe(1); // aufgestiegen
    expect(after.entries.some((e) => e.username === 'user4')).toBe(false); // jetzt in Silber
    expect(leaderboard(db, ids[3]!, 'league', monday).league).toBe('Silber');
    // Auswertung passiert genau einmal
    expect(ensureLeagueRollover(db, monday).processed).toBeNull();
    expect(db.select().from(leagueWeeks).all()).toHaveLength(2);
    // Allzeit bleibt
    expect(leaderboard(db, ids[0]!, 'alltime', monday).entries[0]!.username).toBe('user1');
  });
});

describe('praxis area (bonus levels with estimate questions)', () => {
  it('is separate from the path, unlocks after basics and grades slider answers server-side', async () => {
    const unit = makeUnit('DS', 1, { bonus: true });
    importUnit(db, unit);
    const { token } = (await register('nina')).json();
    const path = (await app.inject({ url: '/api/path', headers: authed(token) })).json();
    expect(path.modules[0].units[0].levels).toHaveLength(4); // Bonus nicht im Pfad
    let disc = (await app.inject({ url: '/api/discover', headers: authed(token) })).json();
    expect(disc.modules[0].items[0]).toMatchObject({ id: 'ds-01-l5', kind: 'bonus', status: 'locked' });
    expect((await app.inject({ url: '/api/levels/ds-01-l5', headers: authed(token) })).statusCode).toBe(403);

    await app.inject({ method: 'POST', url: '/api/levels/ds-01-l1/complete', headers: authed(token), payload: { answers: answersFor(unit, 0) } });
    disc = (await app.inject({ url: '/api/discover', headers: authed(token) })).json();
    expect(disc.modules[0].items[0].status).toBe('open');

    const answers = unit.levels[4]!.questions.map((q) => ({ questionId: q.id, selected: q.type === 'estimate' ? ['63'] : ['b'] }));
    const r = (await app.inject({ method: 'POST', url: '/api/levels/ds-01-l5/complete', headers: authed(token), payload: { answers } })).json();
    expect(r).toMatchObject({ correctFirstTry: 7, total: 8 }); // 63 ≠ 64 (Toleranz 0)
    expect(db.select().from(reviewItems).all().map((x) => x.questionId)).toEqual(['ds-01-l5-q01']);
    // der Lernpfad hängt nicht vom Praxis-Level ab
    const after = (await app.inject({ url: '/api/path', headers: authed(token) })).json();
    expect(after.modules[0].units[0].levels[1].status).toBe('open');
  });
});

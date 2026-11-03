import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { STUDY, studyReward, type StudyResponse } from '@lernquest/shared';
import { buildApp } from '../src/app.ts';
import type { DB } from '../src/db/index.ts';
import { studyBlocks, users } from '../src/db/schema.ts';
import { resetProgress } from '../src/lib/account.ts';
import { addStudyBlock, claimStudyWeek, studyState, undoStudyBlock } from '../src/lib/study.ts';
import { testDb } from './helpers.ts';

let db: DB;
let app: FastifyInstance;

beforeEach(async () => {
  db = testDb();
  app = await buildApp(db);
});

async function register(username: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { inviteCode: 'LQ-TEST-CODE', username, email: `${username}@test.local`, displayName: username, password: 'geheim1234', acceptPrivacy: true } });
  return res.json().token as string;
}
const authed = (token: string) => ({ authorization: `Bearer ${token}` });
const user = (username: string) => db.select().from(users).where(eq(users.username, username)).get()!;
const auth = (username: string) => ({ ...user(username), role: 'user' as const }) as never;

// Mi 2026-11-11 10:00 Berlin; Woche Mo 09.11. – So 15.11.
const WED = Date.parse('2026-11-11T09:00:00Z');
const NEXT_MON = Date.parse('2026-11-16T09:00:00Z');
const DAY = 86_400_000;

describe('studyReward', () => {
  it('pays blocks up to the goal, goal bonuses and an all-goals bonus', () => {
    const full = studyReward({ EIP: 7, ERA: 4, DS: 5 });
    expect(full.blockCoins).toBe(16 * STUDY.coinsPerBlock);
    expect(full.goalCoins).toBe(3 * STUDY.goalBonus);
    expect(full.allBonus).toBe(STUDY.allGoalsBonus);
    expect(full.extraCoins).toBe(0);
    expect(full.total).toBe(16 * 8 + 75 + 50);
  });
  it('gives only a small, capped bonus above the goal', () => {
    const over = studyReward({ EIP: 20, ERA: 4, DS: 5 });
    expect(over.extraCoins).toBe(STUDY.extraMax * STUDY.coinsPerExtraBlock);
    expect(over.total - studyReward({ EIP: 7, ERA: 4, DS: 5 }).total).toBe(6);
  });
  it('rewards partial weeks without bonuses', () => {
    expect(studyReward({ EIP: 3 })).toMatchObject({ total: 24, goalsReached: 0, allBonus: 0 });
    expect(studyReward({})).toMatchObject({ total: 0 });
  });
});

describe('lernblöcke', () => {
  it('adds, limits per day, undoes and counts per week', async () => {
    await register('anna');
    const u = auth('anna');
    let s = addStudyBlock(db, u, 'EIP', WED);
    s = addStudyBlock(db, u, 'EIP', WED + 1000);
    s = addStudyBlock(db, u, 'DS', WED + 2000);
    expect(s.week).toBe('2026-11-09');
    expect(s.weekEnd).toBe('2026-11-15');
    expect(s.modules.find((m) => m.module === 'EIP')).toMatchObject({ blocks: 2, today: 2, goalBlocks: 7, goalHours: 10.5 });
    expect(s.reward.total).toBe(3 * STUDY.coinsPerBlock);

    addStudyBlock(db, u, 'EIP', WED + 3000);
    addStudyBlock(db, u, 'EIP', WED + 4000);
    expect(() => addStudyBlock(db, u, 'EIP', WED + 5000)).toThrow(/pro Fach und Tag/);
    // am nächsten Tag geht es wieder
    s = addStudyBlock(db, u, 'EIP', WED + DAY);
    expect(s.modules.find((m) => m.module === 'EIP')).toMatchObject({ blocks: 5, today: 1 });

    s = undoStudyBlock(db, u, 'EIP', WED + DAY);
    expect(s.modules.find((m) => m.module === 'EIP')!.blocks).toBe(4);
    expect(() => undoStudyBlock(db, u, 'ERA', WED)).toThrow();
  });

  it('can claim a finished week exactly once, not the running one', async () => {
    await register('ben');
    const u = auth('ben');
    for (let i = 0; i < 4; i++) addStudyBlock(db, u, 'ERA', WED + i);
    expect(() => claimStudyWeek(db, u, '2026-11-09', WED)).toThrow(/läuft noch/);

    const next = studyState(db, u, NEXT_MON);
    expect(next.pending).toHaveLength(1);
    expect(next.pending[0]).toMatchObject({ week: '2026-11-09', reward: { total: 4 * 8 + 25 } });
    // Rücknahme in der neuen Woche betrifft die alte Woche nicht
    expect(() => undoStudyBlock(db, u, 'ERA', NEXT_MON)).toThrow();

    const before = user('ben').coins;
    const r = claimStudyWeek(db, u, '2026-11-09', NEXT_MON);
    expect(r.coins).toBe(57);
    expect(user('ben').coins).toBe(before + 57);
    expect(r.pending).toHaveLength(0);
    expect(r.claimedTotal).toBe(57);
    expect(() => claimStudyWeek(db, u, '2026-11-09', NEXT_MON)).toThrow(/Schon abgeholt/);
  });

  it('serves the routes with auth and validates the module', async () => {
    const t = await register('cara');
    expect((await app.inject({ method: 'GET', url: '/api/study' })).statusCode).toBe(401);
    const add = await app.inject({ method: 'POST', url: '/api/study/eip/add', headers: authed(t) });
    expect(add.statusCode).toBe(200);
    expect((add.json() as StudyResponse).modules.find((m) => m.module === 'EIP')!.blocks).toBe(1);
    expect((await app.inject({ method: 'POST', url: '/api/study/xyz/add', headers: authed(t) })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/study/eip/undo', headers: authed(t) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/study/claim/2026-01-05', headers: authed(t) })).statusCode).toBe(404);
  });

  it('is wiped by a progress reset', async () => {
    await register('dora');
    const u = auth('dora');
    addStudyBlock(db, u, 'DS', WED);
    resetProgress(db, user('dora').id);
    expect(db.select().from(studyBlocks).all()).toHaveLength(0);
  });
});

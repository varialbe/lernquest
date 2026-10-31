import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DUEL, EXAM, examGrade, pickQuests, type RunStart } from '@lernquest/shared';
import { buildApp } from '../src/app.ts';
import type { DB } from '../src/db/index.ts';
import { duels, reviewItems, users } from '../src/db/schema.ts';
import { expireDuels } from '../src/lib/duels.ts';
import { answersFor, makeUnit, testDb } from './helpers.ts';

let db: DB;
let app: FastifyInstance;

beforeEach(async () => {
  db = testDb();
  app = await buildApp(db);
});

async function register(username: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { inviteCode: 'LQ-TEST-CODE', username, displayName: username, password: 'geheim1234' } });
  return res.json().token as string;
}
const authed = (token: string) => ({ authorization: `Bearer ${token}` });
const user = (username: string) => db.select().from(users).where(eq(users.username, username)).get()!;
const post = (token: string, url: string, payload: object = {}) => app.inject({ method: 'POST', url, headers: authed(token), payload });
/** Testfragen: richtig ist immer „b“ */
const answer = (run: RunStart, correct: number) => run.questions.map((q, i) => ({ questionId: q.id, selected: i < correct ? ['b'] : ['a'] }));

describe('klausur-check', () => {
  it('draws questions from all units, grades once, counts unanswered as wrong and caps daily rewards', async () => {
    const t = await register('anna');
    const run: RunStart = (await post(t, '/api/runs/exam', { module: 'DS' })).json();
    expect(run.questions).toHaveLength(EXAM.questions);
    expect(run.timeLimitSec).toBe(EXAM.questions * EXAM.secondsPerQuestion);
    expect(new Set(run.questions.map((q) => q.id.slice(0, 5)))).toEqual(new Set(['ds-01', 'ds-02']));
    expect(run.questions.every((q) => !q.id.includes('-l5-'))).toBe(true);

    // 12 richtig, 4 falsch, 4 unbeantwortet (Zeit abgelaufen)
    const submitted = answer(run, 12).slice(0, 16);
    const r = (await post(t, `/api/runs/${run.runId}/complete`, { answers: submitted, durationSec: 600 })).json();
    expect(r.correctFirstTry).toBe(12);
    expect(r.total).toBe(20);
    expect(r.grade).toBe(examGrade(0.6));
    expect(r.rewarded).toBe(true);
    expect(r.xp).toBe(12 * EXAM.xpPerCorrect + EXAM.passBonusXp);
    expect(r.newAchievements).toContain('exam_pass');
    // falsche + unbeantwortete landen in der Wiederholung
    expect(db.select().from(reviewItems).where(eq(reviewItems.userId, user('anna').id)).all()).toHaveLength(8);

    expect((await post(t, `/api/runs/${run.runId}/complete`, { answers: submitted })).statusCode).toBe(409);
    const other = await register('bob');
    const r2: RunStart = (await post(t, '/api/runs/exam', { module: 'DS' })).json();
    expect((await post(other, `/api/runs/${r2.runId}/complete`, { answers: answer(r2, 20) })).statusCode).toBe(403);

    await post(t, `/api/runs/${r2.runId}/complete`, { answers: answer(r2, 20) });
    const r3: RunStart = (await post(t, '/api/runs/exam', { module: 'DS' })).json();
    const third = (await post(t, `/api/runs/${r3.runId}/complete`, { answers: answer(r3, 20) })).json();
    expect(third.rewarded).toBe(false);
    expect(third.xp).toBe(0);
  });

  it('refuses modules without enough questions', async () => {
    const t = await register('anna');
    expect((await post(t, '/api/runs/exam', { module: 'ERA' })).statusCode).toBe(400);
  });
});

describe('schwächen', () => {
  it('needs history, ranks concepts and serves recently wrong questions first', async () => {
    const t = await register('anna');
    expect((await post(t, '/api/runs/weak')).statusCode).toBe(400);
    const unit = makeUnit('DS', 1);
    await post(t, `/api/levels/ds-01-l1/complete`, { answers: answersFor(unit, 0, 5) });

    const m = (await app.inject({ url: '/api/mastery', headers: authed(t) })).json();
    const ds = m.modules.find((x: { id: string }) => x.id === 'DS');
    expect(ds.concepts[0]).toMatchObject({ concept: 'K', answered: 8, correct: 3, level: 'weak' });

    const run: RunStart = (await post(t, '/api/runs/weak', { module: 'DS' })).json();
    const wrongIds = unit.levels[0]!.questions.slice(0, 5).map((q) => q.id);
    expect(run.questions.map((q) => q.id)).toEqual(expect.arrayContaining(wrongIds));
    expect((await post(t, `/api/runs/${run.runId}/complete`, { answers: answer(run, 1).slice(0, 2) })).statusCode).toBe(400); // unvollständig

    await post(t, `/api/runs/${run.runId}/complete`, { answers: answer(run, run.questions.length) });
    const boxes = db.select().from(reviewItems).where(eq(reviewItems.userId, user('anna').id)).all();
    expect(boxes.filter((b) => wrongIds.includes(b.questionId)).every((b) => b.box === 2)).toBe(true);
  });
});

describe('duelle', () => {
  it('hides the score until you played, decides by correct answers and pays the winner', async () => {
    const a = await register('anna');
    const b = await register('bob');
    expect((await post(a, '/api/duels', { opponent: 'anna', module: 'DS' })).statusCode).toBe(400);
    const duel = (await post(a, '/api/duels', { opponent: 'bob', module: 'DS' })).json();
    expect(duel).toMatchObject({ status: 'open', challengedByMe: true, questionCount: DUEL.questions });

    const runA: RunStart = (await post(a, `/api/duels/${duel.id}/play`)).json();
    expect(runA.questions).toHaveLength(DUEL.questions);
    await post(a, `/api/runs/${runA.runId}/complete`, { answers: answer(runA, 8), durationSec: 90 });
    expect((await post(a, `/api/duels/${duel.id}/play`)).statusCode).toBe(409);

    const forBob = (await app.inject({ url: '/api/duels', headers: authed(b) })).json();
    expect(forBob.duels[0].them).toEqual({ played: true, correct: null, durationSec: null });
    expect(forBob.opponents.map((o: { username: string }) => o.username)).toEqual(['anna']);

    const coinsBefore = user('anna').coins;
    const runB: RunStart = (await post(b, `/api/duels/${duel.id}/play`)).json();
    expect(runB.questions.map((q) => q.id)).toEqual(runA.questions.map((q) => q.id));
    const res = (await post(b, `/api/runs/${runB.runId}/complete`, { answers: answer(runB, 6), durationSec: 60 })).json();
    expect(res.duel).toMatchObject({ status: 'done', winner: 'them', me: { correct: 6 }, them: { correct: 8 } });
    expect(user('anna').coins).toBe(coinsBefore + DUEL.winCoins);
  });

  it('can be declined and expires in favour of whoever played', async () => {
    const a = await register('anna');
    const b = await register('bob');
    const d1 = (await post(a, '/api/duels', { opponent: 'bob', module: 'DS' })).json();
    expect((await post(a, `/api/duels/${d1.id}/decline`)).statusCode).toBe(404); // nur die herausgeforderte Person
    expect((await post(b, `/api/duels/${d1.id}/decline`)).statusCode).toBe(200);
    expect((await post(b, `/api/duels/${d1.id}/play`)).statusCode).toBe(409);

    const d2 = (await post(a, '/api/duels', { opponent: 'bob', module: 'DS' })).json();
    const run: RunStart = (await post(a, `/api/duels/${d2.id}/play`)).json();
    await post(a, `/api/runs/${run.runId}/complete`, { answers: answer(run, 3) });
    expireDuels(db, Date.now() + (DUEL.expiresHours + 1) * 3600_000);
    expect(db.select().from(duels).where(eq(duels.id, d2.id)).get()).toMatchObject({ status: 'done', winnerId: user('anna').id });
  });
});

describe('tagesaufgaben', () => {
  it('always includes the XP quest, tracks progress and pays out exactly once', async () => {
    const t = await register('anna');
    const id = user('anna').id;
    const q0 = (await app.inject({ url: '/api/quests', headers: authed(t) })).json();
    expect(q0.quests.map((q: { id: string }) => q.id)).toEqual(pickQuests(id, q0.day).map((q) => q.id));
    expect(q0.quests[0]).toMatchObject({ id: 'xp', progress: 0, done: false });
    expect((await post(t, '/api/quests/xp/claim')).statusCode).toBe(400);

    const unit = makeUnit('DS', 1);
    for (const [i, l] of ['ds-01-l1', 'ds-01-l2'].entries()) await post(t, `/api/levels/${l}/complete`, { answers: answersFor(unit, i) });
    const before = user('anna').coins;
    const q1 = (await post(t, '/api/quests/xp/claim')).json();
    expect(q1.quests[0]).toMatchObject({ id: 'xp', done: true, claimed: true });
    expect(user('anna').coins).toBe(before + 10);
    expect((await post(t, '/api/quests/xp/claim')).statusCode).toBe(409);
    expect((await post(t, '/api/quests/nope/claim')).statusCode).toBe(404);
    expect(db.select().from(reviewItems).where(and(eq(reviewItems.userId, id))).all()).toHaveLength(0);
  });
});

describe('ios live update', () => {
  it('records failed updates from the app as admin notification', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/app/diag', headers: { origin: 'capacitor://localhost' }, payload: { version: 'abc', stage: 'download', error: 'Checksum required' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('capacitor://localhost');
    const { adminNotifications } = await import('../src/db/schema.ts');
    expect(db.select().from(adminNotifications).all().at(-1)).toMatchObject({ level: 'warn', body: 'App-Version abc: Checksum required' });
  });
});

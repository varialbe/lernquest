import { and, eq, inArray, sql } from 'drizzle-orm';
import { BONUS_KIND, pickQuests, QUESTS, type QuestMetric, type QuestsResponse } from '@lernquest/shared';
import type { DB } from '../db/index.ts';
import { answers, levels, questClaims, questions, quizRuns, users, xpEvents } from '../db/schema.ts';
import type { AuthUser } from './auth.ts';
import { todayXp } from './game.ts';
import { badRequest, conflict, notFound } from './http.ts';
import { addDays, berlinDay, berlinMidnight } from './time.ts';

function metrics(db: DB, userId: number, day: string): Record<QuestMetric, number> {
  const from = berlinMidnight(day);
  const to = berlinMidnight(addDays(day, 1));
  const inDay = sql`${answers.createdAt} >= ${from} and ${answers.createdAt} < ${to}`;
  const count = (q: { get: () => { n: number } | undefined }) => Number(q.get()?.n ?? 0);
  const n = sql<number>`count(*)`;
  const events = (sources: string[]) =>
    count(db.select({ n }).from(xpEvents).where(and(eq(xpEvents.userId, userId), eq(xpEvents.day, day), inArray(xpEvents.source, sources))));
  const runs = (kind: 'exam' | 'duel') =>
    count(db.select({ n }).from(quizRuns).where(and(eq(quizRuns.userId, userId), eq(quizRuns.kind, kind), sql`${quizRuns.completedAt} >= ${from} and ${quizRuns.completedAt} < ${to}`)));
  return {
    xp: todayXp(db, userId, day),
    correct: count(db.select({ n }).from(answers).where(and(eq(answers.userId, userId), eq(answers.correct, true), inDay))),
    levels: events(['level', 'boss']),
    estimate: count(
      db
        .select({ n })
        .from(answers)
        .innerJoin(questions, eq(questions.id, answers.questionId))
        .where(and(eq(answers.userId, userId), eq(answers.correct, true), eq(questions.type, 'estimate'), inDay)),
    ),
    review: events(['practice', 'weak']),
    praxis: count(
      db
        .select({ n })
        .from(answers)
        .innerJoin(questions, eq(questions.id, answers.questionId))
        .innerJoin(levels, eq(levels.id, questions.levelId))
        .where(and(eq(answers.userId, userId), eq(levels.kind, BONUS_KIND), inDay)),
    ),
    exam: runs('exam'),
    duel: runs('duel'),
  };
}

export function questsFor(db: DB, u: AuthUser, now = Date.now()): QuestsResponse {
  const day = berlinDay(now);
  const m = metrics(db, u.id, day);
  const claimed = new Set(
    db
      .select({ id: questClaims.questId })
      .from(questClaims)
      .where(and(eq(questClaims.userId, u.id), eq(questClaims.day, day)))
      .all()
      .map((c) => c.id),
  );
  return {
    day,
    quests: pickQuests(u.id, day).map((q) => {
      const progress = Math.min(q.target, m[q.metric]);
      return { id: q.id, title: q.title, icon: q.icon, target: q.target, progress, coins: q.coins, done: progress >= q.target, claimed: claimed.has(q.id) };
    }),
  };
}

export function claimQuest(db: DB, u: AuthUser, questId: string, now = Date.now()): QuestsResponse {
  const def = QUESTS.find((q) => q.id === questId);
  if (!def) throw notFound('Aufgabe nicht gefunden');
  const state = questsFor(db, u, now).quests.find((q) => q.id === questId);
  if (!state) throw badRequest('not_today', 'Diese Aufgabe gehört nicht zu heute.');
  if (state.claimed) throw conflict('claimed', 'Schon eingelöst.');
  if (!state.done) throw badRequest('not_done', 'Noch nicht geschafft.');
  db.transaction((tx) => {
    tx.insert(questClaims).values({ userId: u.id, day: berlinDay(now), questId, coins: def.coins, claimedAt: now }).run();
    tx.update(users).set({ coins: sql`${users.coins} + ${def.coins}` }).where(eq(users.id, u.id)).run();
  });
  return questsFor(db, u, now);
}

import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  BONUS_KIND,
  ECONOMY,
  EXAM,
  LEITNER_INTERVALS,
  LEITNER_MAX_BOX,
  MODULE_INFO,
  MODULES,
  WEAK,
  DUEL,
  checkAnswer,
  examGrade,
  type ConceptMastery,
  type MasteryLevel,
  type MasteryResponse,
  type ModuleId,
  type Question,
  type RunKind,
  type RunResult,
  type RunStart,
} from '@lernquest/shared';
import type { DB } from '../db/index.ts';
import { answers, levels, questions, quizRuns, reviewItems, units, users } from '../db/schema.ts';
import type { AuthUser } from './auth.ts';
import { award, unlockedAchievements, type AnyDb } from './game.ts';
import { badRequest, conflict, forbidden, notFound } from './http.ts';
import { leitnerNext } from './streak.ts';
import { berlinDay, berlinMidnight } from './time.ts';

type PoolQuestion = { id: string; unitId: string; module: ModuleId; data: Question };

/** Alle aktiven Fragen der Haupt-Level (ohne Praxis), optional eines Moduls. */
export function corePool(db: AnyDb, module?: ModuleId): PoolQuestion[] {
  const rows = db
    .select({ id: questions.id, unitId: questions.unitId, module: units.module, data: questions.data })
    .from(questions)
    .innerJoin(levels, eq(levels.id, questions.levelId))
    .innerJoin(units, eq(units.id, questions.unitId))
    .where(and(eq(questions.active, true), ne(levels.kind, BONUS_KIND), module ? eq(units.module, module) : undefined))
    .all();
  return rows.map((r) => ({ ...r, module: r.module as ModuleId, data: r.data as Question }));
}

const shuffle = <T>(a: T[]): T[] => {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j]!, r[i]!];
  }
  return r;
};

/** n Fragen gleichmäßig über die Units verteilt (Reihum-Ziehen), danach gemischt. */
export function stratified(pool: PoolQuestion[], n: number): PoolQuestion[] {
  const byUnit = new Map<string, PoolQuestion[]>();
  for (const q of shuffle(pool)) byUnit.set(q.unitId, [...(byUnit.get(q.unitId) ?? []), q]);
  const buckets = shuffle([...byUnit.values()]);
  const out: PoolQuestion[] = [];
  while (out.length < n && buckets.some((b) => b.length)) for (const b of buckets) if (b.length && out.length < n) out.push(b.shift()!);
  return shuffle(out);
}

export function insertRun(db: AnyDb, userId: number, kind: RunKind, module: string | null, ids: string[], duelId: string | null = null) {
  const id = randomUUID();
  db.insert(quizRuns).values({ id, userId, kind, module, questionIds: ids, duelId }).run();
  return id;
}

// ---------- Schwächen ----------
const conceptKey = (module: string, concept: string) => `${module}|${concept.trim().toLowerCase()}`;

type ConceptStat = { module: ModuleId; concept: string; unitId: string; history: boolean[] };

/** Trefferquote je Konzept aus den eigenen Antworten (neueste zuerst, höchstens 10 zählen). */
function conceptStats(db: AnyDb, userId: number, pool: PoolQuestion[]) {
  const byId = new Map(pool.map((q) => [q.id, q]));
  const rows = db.select({ qid: answers.questionId, ok: answers.correct }).from(answers).where(eq(answers.userId, userId)).orderBy(desc(answers.id)).all();
  const stats = new Map<string, ConceptStat>();
  for (const r of rows) {
    const q = byId.get(r.qid);
    if (!q) continue;
    for (const c of q.data.concepts) {
      const k = conceptKey(q.module, c);
      const s = stats.get(k) ?? { module: q.module, concept: c.trim(), unitId: q.unitId, history: [] };
      if (s.history.length < 10) s.history.push(r.ok);
      stats.set(k, s);
    }
  }
  return stats;
}

const scoreOf = (h: boolean[]) => (h.length ? h.filter(Boolean).length / h.length : 0);
function levelOf(h: boolean[]): MasteryLevel {
  if (h.length < WEAK.minAnswers) return 'new';
  const s = scoreOf(h);
  return s < 0.6 ? 'weak' : s < 0.85 ? 'ok' : 'strong';
}

export function mastery(db: DB, u: AuthUser): MasteryResponse {
  const pool = corePool(db);
  const stats = conceptStats(db, u.id, pool);
  const unitRows = db.select({ id: units.id, module: units.module, number: units.number, title: units.title, concepts: units.concepts }).from(units).all();
  const unitById = new Map(unitRows.map((x) => [x.id, x]));
  return {
    modules: MODULES.map((m) => {
      const concepts: ConceptMastery[] = [...stats.values()]
        .filter((s) => s.module === m)
        .map((s) => {
          const un = unitById.get(s.unitId);
          return {
            concept: s.concept,
            unitId: s.unitId,
            unitNumber: un?.number ?? 0,
            unitTitle: un?.title ?? '',
            answered: s.history.length,
            correct: s.history.filter(Boolean).length,
            score: scoreOf(s.history),
            level: levelOf(s.history),
          };
        })
        .sort((a, b) => a.score - b.score || b.answered - a.answered);
      const seen = new Set(concepts.map((c) => conceptKey(m, c.concept)));
      const all = new Set(unitRows.filter((x) => x.module === m).flatMap((x) => x.concepts.map((c) => conceptKey(m, c))));
      return { id: m, name: MODULE_INFO[m].name, color: MODULE_INFO[m].color, concepts, untouched: [...all].filter((k) => !seen.has(k)).length };
    }),
  };
}

export function startWeak(db: DB, u: AuthUser, module?: ModuleId): RunStart {
  const pool = corePool(db, module);
  const stats = [...conceptStats(db, u.id, pool).values()].filter((s) => s.history.length >= 1);
  if (!stats.length) throw badRequest('no_data', 'Spiel erst ein paar Level – dann sehen wir, wo es noch hakt.');
  // schwächste Konzepte zuerst; nur mit genug Antworten zählt die Quote
  const ranked = stats.sort((a, b) => scoreOf(a.history) - scoreOf(b.history) || b.history.length - a.history.length);
  const focus = new Set(ranked.slice(0, 4).map((s) => conceptKey(s.module, s.concept)));
  const last = new Map(
    db
      .select({ qid: answers.questionId, ok: answers.correct })
      .from(answers)
      .where(eq(answers.userId, u.id))
      .orderBy(asc(answers.id))
      .all()
      .map((r) => [r.qid, r.ok]),
  );
  const matching = pool.filter((q) => q.data.concepts.some((c) => focus.has(conceptKey(q.module, c))));
  // zuletzt falsch > nie gesehen > zuletzt richtig
  const rank = (q: PoolQuestion) => (last.get(q.id) === false ? 0 : last.has(q.id) ? 2 : 1);
  const picked = shuffle(matching)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, WEAK.questions);
  if (picked.length < 3) throw badRequest('no_data', 'Noch zu wenig Fragen zu deinen Schwächen – spiel ein paar weitere Level.');
  const ordered = shuffle(picked);
  const runId = insertRun(db, u.id, 'weak', module ?? null, ordered.map((q) => q.id));
  return { runId, kind: 'weak', title: 'Schwächen üben', module: module ?? null, questions: ordered.map((q) => q.data), timeLimitSec: null, duelId: null };
}

export function startExam(db: DB, u: AuthUser, module: ModuleId): RunStart {
  const pool = corePool(db, module);
  if (pool.length < 10) throw badRequest('no_data', 'In diesem Modul gibt es noch zu wenige Fragen für einen Klausur-Check.');
  const picked = stratified(pool, EXAM.questions);
  const runId = insertRun(db, u.id, 'exam', module, picked.map((q) => q.id));
  return {
    runId,
    kind: 'exam',
    title: `Klausur-Check ${MODULE_INFO[module].short}`,
    module,
    questions: picked.map((q) => q.data),
    timeLimitSec: picked.length * EXAM.secondsPerQuestion,
    duelId: null,
  };
}

// ---------- Wertung ----------
function completedToday(db: AnyDb, userId: number, kind: RunKind, now: number) {
  const from = berlinMidnight(berlinDay(now));
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(quizRuns)
      .where(and(eq(quizRuns.userId, userId), eq(quizRuns.kind, kind), sql`${quizRuns.completedAt} >= ${from}`))
      .get()?.n ?? 0
  );
}

export function completeRun(
  db: DB,
  u: AuthUser,
  runId: string,
  submitted: { questionId: string; selected: string[] }[],
  durationSec: number | undefined,
  hooks: { afterDuelRun?: (duelId: string) => RunResult['duel'] } = {},
  now = Date.now(),
): RunResult {
  const run = db.select().from(quizRuns).where(eq(quizRuns.id, runId)).get();
  if (!run) throw notFound('Runde nicht gefunden');
  if (run.userId !== u.id) throw forbidden('Das ist nicht deine Runde.');
  if (run.completedAt) throw conflict('already_done', 'Diese Runde ist schon gewertet.');
  const kind = run.kind as RunKind;
  const data = new Map(
    db
      .select({ id: questions.id, data: questions.data })
      .from(questions)
      .where(inArray(questions.id, run.questionIds.length ? run.questionIds : ['']))
      .all()
      .map((q) => [q.id, q.data as Question]),
  );
  const given = new Map<string, string[]>();
  for (const a of submitted) if (!given.has(a.questionId)) given.set(a.questionId, a.selected);
  // Weak/Duell: alle Fragen müssen beantwortet sein; im Klausur-Check zählt Unbeantwortetes (Zeit abgelaufen) als falsch
  if (kind !== 'exam' && run.questionIds.some((id) => data.has(id) && !given.has(id))) throw badRequest('incomplete', 'Bitte beantworte alle Fragen.');

  const achievementsBefore = unlockedAchievements(db, u.id);
  const day = berlinDay(now);
  const module = run.module ?? null;
  const rewardedBefore = completedToday(db, u.id, kind, now);

  const result = db.transaction((tx) => {
    const review: RunResult['review'] = [];
    for (const qid of run.questionIds) {
      const q = data.get(qid);
      if (!q) continue;
      const sel = given.get(qid) ?? [];
      const ok = checkAnswer(q, sel);
      review.push({ questionId: qid, selected: sel, correct: ok });
      tx.insert(answers).values({ userId: u.id, questionId: qid, correct: ok, context: kind, createdAt: now }).run();
      const where = and(eq(reviewItems.userId, u.id), eq(reviewItems.questionId, qid));
      const item = tx.select().from(reviewItems).where(where).get();
      if (kind === 'weak' && item) {
        const next = leitnerNext(item.box, ok, day, LEITNER_INTERVALS, LEITNER_MAX_BOX);
        if (next) tx.update(reviewItems).set({ ...next, updatedAt: now }).where(where).run();
        else tx.delete(reviewItems).where(where).run();
      } else if (!ok) {
        tx.insert(reviewItems)
          .values({ userId: u.id, questionId: qid, box: 1, dueDay: day })
          .onConflictDoUpdate({ target: [reviewItems.userId, reviewItems.questionId], set: { box: 1, dueDay: day, updatedAt: now } })
          .run();
      }
    }
    const total = review.length;
    const correct = review.filter((r) => r.correct).length;
    const accuracy = total ? correct / total : 0;

    const limit = kind === 'exam' ? EXAM.rewardedPerDay : kind === 'weak' ? WEAK.rewardedPerDay : DUEL.rewardedPerDay;
    const rewarded = rewardedBefore < limit;
    let xp = 0;
    let coins = 0;
    if (rewarded) {
      if (kind === 'weak') {
        xp = ECONOMY.practiceXpBonus + ECONOMY.practiceXpPerCorrect * correct;
        coins = ECONOMY.practiceCoins;
      } else if (kind === 'exam') {
        const passed = accuracy >= EXAM.passAt;
        xp = EXAM.xpPerCorrect * correct + (passed ? EXAM.passBonusXp : 0);
        coins = passed ? EXAM.passCoins : 0;
      } else {
        xp = DUEL.xpBase + DUEL.xpPerCorrect * correct;
      }
    }
    tx.update(quizRuns).set({ completedAt: now, correct, total, durationSec: durationSec ?? Math.round((now - run.startedAt) / 1000) }).where(eq(quizRuns.id, runId)).run();
    const fresh = tx.select().from(users).where(eq(users.id, u.id)).get()!;
    const a = award(tx, fresh, xp, coins, module, kind, now);
    return {
      correctFirstTry: correct,
      total,
      accuracy,
      stars: ECONOMY.stars(accuracy),
      xp,
      coins: a.coins,
      streak: a.streak,
      streakIncreased: a.streakIncreased,
      dailyGoalReached: a.goalReached,
      pet: a.pet,
      kind,
      rewarded,
      review,
      grade: kind === 'exam' ? examGrade(accuracy) : null,
    };
  });

  const duel = run.duelId && hooks.afterDuelRun ? hooks.afterDuelRun(run.duelId) : null;
  const newAchievements = unlockedAchievements(db, u.id).filter((x) => !achievementsBefore.includes(x));
  return { ...result, duel, newAchievements, unlocked: [] };
}

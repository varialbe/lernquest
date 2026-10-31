import { and, asc, eq, inArray, lte, sql, sum } from 'drizzle-orm';
import {
  ACHIEVEMENTS,
  ECONOMY,
  LEAGUES,
  LEITNER_INTERVALS,
  LEITNER_MAX_BOX,
  MODULE_INFO,
  MODULES,
  BONUS_KIND,
  checkAnswer,
  petStage,
  type LevelNode,
  type LevelStatus,
  type MeResponse,
  type ModuleId,
  type DiscoverResponse,
  type PathResponse,
  type Question,
  type RewardResponse,
} from '@lernquest/shared';
import type { DB } from '../db/index.ts';
import { answers, duels, inventory, levelProgress, levels, questions, quizRuns, reviewItems, units, userPets, users, xpEvents } from '../db/schema.ts';
import type { AuthUser } from './auth.ts';
import { badRequest, notFound, forbidden } from './http.ts';
import { effectiveStreak, leitnerNext, recordActivity } from './streak.ts';
import { addDays, berlinDay, berlinMidnight, weekStart } from './time.ts';
import { decrypt } from './crypto.ts';

export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type AnyDb = DB | Tx;

// ---------- Statistiken ----------
export function todayXp(db: AnyDb, userId: number, day = berlinDay()): number {
  return Number(db.select({ s: sum(xpEvents.amount) }).from(xpEvents).where(and(eq(xpEvents.userId, userId), eq(xpEvents.day, day))).get()?.s ?? 0);
}
export function weekXp(db: AnyDb, userId: number, now = Date.now()): number {
  const from = berlinMidnight(weekStart(now));
  return Number(
    db.select({ s: sum(xpEvents.amount) }).from(xpEvents).where(and(eq(xpEvents.userId, userId), sql`${xpEvents.createdAt} >= ${from}`)).get()?.s ?? 0,
  );
}
export function dueReviews(db: AnyDb, userId: number, day = berlinDay()): number {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(reviewItems)
      .innerJoin(questions, eq(questions.id, reviewItems.questionId))
      .where(and(eq(reviewItems.userId, userId), lte(reviewItems.dueDay, day), eq(questions.active, true)))
      .get()?.n ?? 0
  );
}

export function meResponse(db: DB, u: AuthUser, now = Date.now()): MeResponse {
  const day = berlinDay(now);
  const pets = db.select().from(userPets).where(eq(userPets.userId, u.id)).orderBy(asc(userPets.acquiredAt)).all();
  const inv = db.select().from(inventory).where(eq(inventory.userId, u.id)).all();
  return {
    user: { id: u.id, username: u.username, displayName: u.displayName, role: u.role, mustChangePassword: u.mustChangePassword },
    stats: {
      xp: u.xp,
      coins: u.coins,
      streak: effectiveStreak(u, day),
      longestStreak: u.longestStreak,
      streakFreezes: u.streakFreezes,
      streakActiveToday: u.lastActiveDay === day,
      todayXp: todayXp(db, u.id, day),
      dailyGoal: u.dailyGoal,
      league: LEAGUES[u.leagueTier] ?? LEAGUES[0],
      weekXp: weekXp(db, u.id, now),
      dueReviews: dueReviews(db, u.id, day),
    },
    settings: {
      theme: u.theme,
      frame: u.frame,
      soundOn: u.soundOn,
      activePet: u.activePet,
      newsletter: u.newsletter ? 'confirmed' : u.newsletterRequestedAt ? 'pending' : 'none',
      email: decrypt(u.emailEnc),
      emailVerified: !!u.emailVerifiedAt,
      google: !!u.googleSub,
      hasPassword: u.hasPassword,
    },
    pets: pets.map((p) => ({ petId: p.petId, xp: p.xp, stage: petStage(p.xp), accessory: p.accessory })),
    inventory: inv.map((i) => i.itemId),
  };
}

// ---------- Lernpfad & Freischaltung ----------
type ProgressMap = Map<string, typeof levelProgress.$inferSelect>;
const progressMap = (db: AnyDb, userId: number): ProgressMap =>
  new Map(db.select().from(levelProgress).where(eq(levelProgress.userId, userId)).all().map((p) => [p.levelId, p]));

export function buildPath(db: AnyDb, u: AuthUser, now = Date.now()): PathResponse {
  const allUnits = db.select().from(units).orderBy(asc(units.module), asc(units.number)).all();
  // Praxis-Level gehören nicht zum sequentiellen Lernpfad (eigener Bereich, siehe buildDiscover)
  const allLevels = db.select().from(levels).orderBy(asc(levels.idx)).all().filter((l) => l.kind !== BONUS_KIND);
  const counts = new Map(
    db
      .select({ levelId: questions.levelId, n: sql<number>`count(*)` })
      .from(questions)
      .where(eq(questions.active, true))
      .groupBy(questions.levelId)
      .all()
      .map((r) => [r.levelId, r.n]),
  );
  const prog = progressMap(db, u.id);
  const unlockAll = u.role === 'admin' || u.unlockAll;
  const newSince = berlinMidnight(addDays(berlinDay(now), -1));

  const modules = MODULES.map((m) => {
    let prevUnitDone = true;
    let doneLevels = 0;
    let totalLevels = 0;
    const unitNodes = allUnits
      .filter((x) => x.module === m)
      .map((unit) => {
        let prevLevelDone = prevUnitDone;
        const lvls: LevelNode[] = allLevels
          .filter((l) => l.unitId === unit.id)
          .map((l) => {
            const p = prog.get(l.id);
            const done = !!p && p.completions > 0;
            const status: LevelStatus = done ? (p!.stars >= 3 ? 'gold' : 'done') : unlockAll || prevLevelDone ? 'open' : 'locked';
            prevLevelDone = done;
            totalLevels++;
            if (done) doneLevels++;
            return {
              id: l.id,
              index: l.idx,
              kind: l.kind as LevelNode['kind'],
              title: l.title,
              questionCount: counts.get(l.id) ?? 0,
              status,
              stars: p?.stars ?? 0,
              bestAccuracy: p ? p.bestAccuracy / 1000 : null,
            };
          });
        prevUnitDone = lvls.every((l) => l.status === 'done' || l.status === 'gold');
        const started = lvls.some((l) => l.status === 'done' || l.status === 'gold');
        return {
          id: unit.id,
          module: m,
          number: unit.number,
          title: unit.title,
          summary: unit.summary,
          concepts: unit.concepts,
          isNew: unit.createdAt >= newSince && !started,
          levels: lvls,
        };
      });
    return { id: m, name: MODULE_INFO[m].name, color: MODULE_INFO[m].color, units: unitNodes, progress: totalLevels ? doneLevels / totalLevels : 0 };
  });
  return { modules };
}

/** Praxis-Bereich: pro Unit ein Bonus-Level, frei, sobald das Grundlagen-Level der Unit geschafft ist. */
export function buildDiscover(db: AnyDb, u: AuthUser, now = Date.now()): DiscoverResponse {
  const path = buildPath(db, u, now);
  const bonus = db.select().from(levels).where(eq(levels.kind, BONUS_KIND)).all();
  const byUnit = new Map(bonus.map((l) => [l.unitId, l]));
  const counts = new Map(
    db
      .select({ levelId: questions.levelId, n: sql<number>`count(*)` })
      .from(questions)
      .where(and(eq(questions.active, true), inArray(questions.levelId, bonus.length ? bonus.map((b) => b.id) : [''])))
      .groupBy(questions.levelId)
      .all()
      .map((r) => [r.levelId, r.n]),
  );
  const prog = progressMap(db, u.id);
  const unlockAll = u.role === 'admin' || u.unlockAll;
  const newSince = berlinMidnight(addDays(berlinDay(now), -1));
  return {
    modules: path.modules.map((m) => ({
      id: m.id,
      name: m.name,
      color: m.color,
      items: m.units.flatMap((un) => {
        const l = byUnit.get(un.id);
        if (!l) return [];
        const p = prog.get(l.id);
        const done = !!p && p.completions > 0;
        const basicsDone = un.levels[0]?.status === 'done' || un.levels[0]?.status === 'gold';
        const status: LevelStatus = done ? (p!.stars >= 3 ? 'gold' : 'done') : unlockAll || basicsDone ? 'open' : 'locked';
        return [
          {
            id: l.id,
            index: l.idx,
            kind: BONUS_KIND,
            title: l.title,
            questionCount: counts.get(l.id) ?? 0,
            status,
            stars: p?.stars ?? 0,
            bestAccuracy: p ? p.bestAccuracy / 1000 : null,
            unitId: un.id,
            unitNumber: un.number,
            unitTitle: un.title,
            isNew: !done && (db.select({ c: units.updatedAt }).from(units).where(eq(units.id, un.id)).get()?.c ?? 0) >= newSince && status === 'open',
          },
        ];
      }),
    })),
  };
}

function levelStatus(db: AnyDb, u: AuthUser, levelId: string): LevelStatus | undefined {
  for (const m of buildPath(db, u).modules) for (const un of m.units) for (const l of un.levels) if (l.id === levelId) return l.status;
  for (const m of buildDiscover(db, u).modules) for (const l of m.items) if (l.id === levelId) return l.status;
  return undefined;
}

export function getLevel(db: DB, u: AuthUser, levelId: string) {
  const level = db.select().from(levels).where(eq(levels.id, levelId)).get();
  if (!level) throw notFound('Level nicht gefunden');
  const status = levelStatus(db, u, levelId);
  if (status === 'locked') throw forbidden('Dieses Level ist noch gesperrt.');
  const unit = db.select().from(units).where(eq(units.id, level.unitId)).get()!;
  const qs = db
    .select()
    .from(questions)
    .where(and(eq(questions.levelId, levelId), eq(questions.active, true)))
    .orderBy(asc(questions.position))
    .all()
    .map((q) => q.data as Question);
  return {
    level: { id: level.id, index: level.idx, kind: level.kind as LevelNode['kind'], title: level.title, unitId: unit.id, unitTitle: unit.title, module: unit.module as ModuleId },
    questions: qs,
  };
}

// ---------- XP / Coins ----------
/** Bucht XP (inkl. Pet-XP, Tagesziel, Streak). Muss in einer Transaktion laufen. */
export function award(tx: Tx, u: AuthUser, xp: number, coins: number, module: string | null, source: string, now: number) {
  const day = berlinDay(now);
  const before = todayXp(tx, u.id, day);
  if (xp > 0) tx.insert(xpEvents).values({ userId: u.id, amount: xp, module, source, day, createdAt: now }).run();
  const goalReached = before < u.dailyGoal && before + xp >= u.dailyGoal;
  const totalCoins = coins + (goalReached ? ECONOMY.dailyGoalCoins : 0);

  const fresh = tx.select().from(users).where(eq(users.id, u.id)).get()!;
  const streak = recordActivity(fresh, day);
  tx.update(users)
    .set({
      xp: sql`${users.xp} + ${xp}`,
      coins: sql`${users.coins} + ${totalCoins}`,
      streak: streak.streak,
      longestStreak: streak.longestStreak,
      lastActiveDay: streak.lastActiveDay,
      streakFreezes: streak.streakFreezes,
    })
    .where(eq(users.id, u.id))
    .run();

  let pet: RewardResponse['pet'] = null;
  if (fresh.activePet) {
    const p = tx.select().from(userPets).where(and(eq(userPets.userId, u.id), eq(userPets.petId, fresh.activePet))).get();
    if (p) {
      const newXp = p.xp + xp;
      tx.update(userPets).set({ xp: newXp }).where(and(eq(userPets.userId, u.id), eq(userPets.petId, p.petId))).run();
      pet = { petId: p.petId, xp: newXp, stage: petStage(newXp), accessory: p.accessory, evolved: petStage(newXp) > petStage(p.xp) };
    }
  }
  return { coins: totalCoins, goalReached, streak: streak.streak, streakIncreased: streak.increased, pet };
}

// ---------- Level abschließen ----------
export function completeLevel(db: DB, u: AuthUser, levelId: string, submitted: { questionId: string; selected: string[] }[], now = Date.now()): RewardResponse {
  const status = levelStatus(db, u, levelId);
  if (!status) throw notFound('Level nicht gefunden');
  if (status === 'locked') throw forbidden('Dieses Level ist noch gesperrt.');
  const level = db.select().from(levels).where(eq(levels.id, levelId)).get()!;
  const unit = db.select().from(units).where(eq(units.id, level.unitId)).get()!;
  const active = db.select().from(questions).where(and(eq(questions.levelId, levelId), eq(questions.active, true))).all();
  const byId = new Map(active.map((q) => [q.id, q.data as Question]));
  const answered = new Map<string, string[]>();
  for (const a of submitted) {
    if (!byId.has(a.questionId)) continue; // inaktive/fremde Fragen ignorieren
    if (!answered.has(a.questionId)) answered.set(a.questionId, a.selected);
  }
  if (answered.size < active.length) throw badRequest('incomplete', 'Bitte beantworte alle Fragen des Levels.');

  const achievementsBefore = unlockedAchievements(db, u.id);
  const pathBefore = buildPath(db, u, now);
  const day = berlinDay(now);

  const result = db.transaction((tx) => {
    let correct = 0;
    for (const [qid, sel] of answered) {
      const ok = checkAnswer(byId.get(qid)!, sel);
      if (ok) correct++;
      tx.insert(answers).values({ userId: u.id, questionId: qid, correct: ok, context: 'level', createdAt: now }).run();
      if (!ok) {
        tx.insert(reviewItems)
          .values({ userId: u.id, questionId: qid, box: 1, dueDay: day })
          .onConflictDoUpdate({ target: [reviewItems.userId, reviewItems.questionId], set: { box: 1, dueDay: day, updatedAt: now } })
          .run();
      }
    }
    const total = answered.size;
    const accuracy = total ? correct / total : 0;
    const stars = ECONOMY.stars(accuracy);
    const prev = tx.select().from(levelProgress).where(and(eq(levelProgress.userId, u.id), eq(levelProgress.levelId, levelId))).get();
    const first = !prev || prev.completions === 0;
    const isBoss = level.kind === 'boss';
    const perfect = correct === total;

    let xp = ECONOMY.xpPerLevel + ECONOMY.xpPerCorrect * correct + (perfect ? ECONOMY.xpPerfectBonus : 0) + (isBoss ? ECONOMY.xpBossBonus : 0);
    if (!first) xp = Math.round(xp * ECONOMY.replayFactor);
    let coins = first ? ECONOMY.coinsPerLevel + (perfect ? ECONOMY.coinsPerfectBonus : 0) + (isBoss ? ECONOMY.coinsBossFirstClear : 0) : 0;
    if (!first && stars === 3 && (prev?.stars ?? 0) < 3) coins += ECONOMY.coinsPerfectBonus; // erstmals Gold

    tx.insert(levelProgress)
      .values({ userId: u.id, levelId, completions: 1, bestAccuracy: Math.round(accuracy * 1000), stars, firstDoneAt: now, lastDoneAt: now })
      .onConflictDoUpdate({
        target: [levelProgress.userId, levelProgress.levelId],
        set: {
          completions: sql`${levelProgress.completions} + 1`,
          bestAccuracy: sql`max(${levelProgress.bestAccuracy}, ${Math.round(accuracy * 1000)})`,
          stars: sql`max(${levelProgress.stars}, ${stars})`,
          firstDoneAt: sql`coalesce(${levelProgress.firstDoneAt}, ${now})`,
          lastDoneAt: now,
        },
      })
      .run();

    const a = award(tx, u, xp, coins, unit.module, isBoss ? 'boss' : 'level', now);
    return { correctFirstTry: correct, total, accuracy, stars, xp, coins: a.coins, streak: a.streak, streakIncreased: a.streakIncreased, dailyGoalReached: a.goalReached, pet: a.pet };
  });

  const fresh = db.select().from(users).where(eq(users.id, u.id)).get()!;
  const pathAfter = buildPath(db, fresh, now);
  const was = new Map(pathBefore.modules.flatMap((m) => m.units.flatMap((un) => un.levels.map((l) => [l.id, l.status] as const))));
  const unlocked = pathAfter.modules.flatMap((m) => m.units.flatMap((un) => un.levels.filter((l) => l.status === 'open' && was.get(l.id) === 'locked').map((l) => l.id)));
  const newAchievements = unlockedAchievements(db, u.id).filter((x) => !achievementsBefore.includes(x));
  return { ...result, newAchievements, unlocked };
}

// ---------- Fehler üben (Leitner) ----------
export function practiceSet(db: DB, u: AuthUser, limit = 10, now = Date.now()): Question[] {
  const day = berlinDay(now);
  const due = db
    .select({ data: questions.data, box: reviewItems.box })
    .from(reviewItems)
    .innerJoin(questions, eq(questions.id, reviewItems.questionId))
    .where(and(eq(reviewItems.userId, u.id), lte(reviewItems.dueDay, day), eq(questions.active, true)))
    .orderBy(asc(reviewItems.box), asc(reviewItems.dueDay), sql`random()`)
    .limit(limit)
    .all();
  return due.map((d) => d.data as Question);
}

export function completePractice(db: DB, u: AuthUser, submitted: { questionId: string; selected: string[] }[], now = Date.now()) {
  const day = berlinDay(now);
  const ids = [...new Set(submitted.map((s) => s.questionId))];
  if (!ids.length) throw badRequest('empty');
  const items = new Map(
    db
      .select({ item: reviewItems, data: questions.data })
      .from(reviewItems)
      .innerJoin(questions, eq(questions.id, reviewItems.questionId))
      .where(and(eq(reviewItems.userId, u.id), inArray(reviewItems.questionId, ids)))
      .all()
      .map((r) => [r.item.questionId, r]),
  );
  const achievementsBefore = unlockedAchievements(db, u.id);
  const result = db.transaction((tx) => {
    let correct = 0;
    let mastered = 0;
    const seen = new Set<string>();
    for (const s of submitted) {
      const r = items.get(s.questionId);
      if (!r || seen.has(s.questionId)) continue;
      seen.add(s.questionId);
      const ok = checkAnswer(r.data as Question, s.selected);
      if (ok) correct++;
      tx.insert(answers).values({ userId: u.id, questionId: s.questionId, correct: ok, context: 'practice', createdAt: now }).run();
      const next = leitnerNext(r.item.box, ok, day, LEITNER_INTERVALS, LEITNER_MAX_BOX);
      const where = and(eq(reviewItems.userId, u.id), eq(reviewItems.questionId, s.questionId));
      if (next) tx.update(reviewItems).set({ ...next, updatedAt: now }).where(where).run();
      else {
        tx.delete(reviewItems).where(where).run();
        mastered++;
      }
    }
    if (!seen.size) throw badRequest('nothing_due', 'Keine dieser Fragen ist in deiner Wiederholung.');
    const xp = ECONOMY.practiceXpBonus + ECONOMY.practiceXpPerCorrect * correct;
    const a = award(tx, u, xp, ECONOMY.practiceCoins, null, 'practice', now);
    return {
      correctFirstTry: correct,
      total: seen.size,
      accuracy: correct / seen.size,
      stars: ECONOMY.stars(correct / seen.size),
      xp,
      coins: a.coins,
      streak: a.streak,
      streakIncreased: a.streakIncreased,
      dailyGoalReached: a.goalReached,
      pet: a.pet,
      mastered,
    };
  });
  return { ...result, unlocked: [] as string[], newAchievements: unlockedAchievements(db, u.id).filter((x) => !achievementsBefore.includes(x)) };
}

// ---------- Achievements (aus Statistiken berechnet) ----------
export function userStats(db: AnyDb, userId: number) {
  const prog = db.select().from(levelProgress).where(eq(levelProgress.userId, userId)).all();
  const done = prog.filter((p) => p.completions > 0);
  const kinds = new Map(db.select({ id: levels.id, kind: levels.kind, unitId: levels.unitId }).from(levels).all().map((l) => [l.id, l]));
  const ans = db
    .select({ n: sql<number>`count(*)`, c: sql<number>`coalesce(sum(${answers.correct}), 0)` })
    .from(answers)
    .where(eq(answers.userId, userId))
    .get();
  const practice = db.select({ n: sql<number>`count(*)` }).from(xpEvents).where(and(eq(xpEvents.userId, userId), eq(xpEvents.source, 'practice'))).get()?.n ?? 0;
  return {
    levelsDone: done.length,
    perfectLevels: done.filter((p) => p.stars >= 3).length,
    bossDone: done.some((p) => kinds.get(p.levelId)?.kind === 'boss'),
    doneLevelIds: new Set(done.map((p) => p.levelId)),
    questionsAnswered: ans?.n ?? 0,
    accuracy: ans?.n ? (ans.c ?? 0) / ans.n : 0,
    practiceSessions: practice,
    levelsByUnit: kinds,
  };
}

export function unlockedAchievements(db: AnyDb, userId: number): string[] {
  const u = db.select().from(users).where(eq(users.id, userId)).get();
  if (!u) return [];
  const s = userStats(db, userId);
  const pets = db.select().from(userPets).where(eq(userPets.userId, userId)).all();
  const allUnits = db.select({ id: units.id, module: units.module }).from(units).all();
  const moduleDone = MODULES.some((m) => {
    const us = allUnits.filter((x) => x.module === m);
    if (!us.length) return false;
    const lv = [...s.levelsByUnit.values()].filter((l) => l.kind !== BONUS_KIND && us.some((x) => x.id === l.unitId));
    return lv.length > 0 && lv.every((l) => s.doneLevelIds.has(l.id));
  });
  const checks: Record<string, boolean> = {
    first_level: s.levelsDone >= 1,
    perfect: s.perfectLevels >= 1,
    boss: s.bossDone,
    streak_3: u.longestStreak >= 3,
    streak_7: u.longestStreak >= 7,
    streak_30: u.longestStreak >= 30,
    xp_500: u.xp >= 500,
    xp_2500: u.xp >= 2500,
    practice_10: s.practiceSessions >= 10,
    evolve: pets.some((p) => petStage(p.xp) >= 2),
    collector: pets.length >= 4,
    module_done: moduleDone,
    exam_pass: !!db
      .select({ id: quizRuns.id })
      .from(quizRuns)
      .where(and(eq(quizRuns.userId, userId), eq(quizRuns.kind, 'exam'), sql`${quizRuns.completedAt} is not null and ${quizRuns.total} > 0 and ${quizRuns.correct} * 2 >= ${quizRuns.total}`))
      .get(),
    duel_win: !!db.select({ id: duels.id }).from(duels).where(eq(duels.winnerId, userId)).get(),
  };
  return ACHIEVEMENTS.filter((a) => checks[a.id]).map((a) => a.id);
}

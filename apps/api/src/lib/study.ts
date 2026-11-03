import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { MODULES, STUDY, studyGoalHours, studyReward, type ModuleId, type StudyResponse, type StudyWeek } from '@lernquest/shared';
import type { DB } from '../db/index.ts';
import { studyBlocks, studyClaims, users } from '../db/schema.ts';
import type { AuthUser } from './auth.ts';
import { badRequest, conflict, notFound } from './http.ts';
import { addDays, berlinDay, weekStart } from './time.ts';

const emptyCounts = () => Object.fromEntries(MODULES.map((m) => [m, 0])) as Record<ModuleId, number>;

/** Blöcke je Woche und Fach in [from, to) */
function countsByWeek(db: DB, userId: number, from: string, to: string) {
  const rows = db
    .select({ week: studyBlocks.week, module: studyBlocks.module, n: sql<number>`count(*)` })
    .from(studyBlocks)
    .where(and(eq(studyBlocks.userId, userId), gte(studyBlocks.week, from), lt(studyBlocks.week, to)))
    .groupBy(studyBlocks.week, studyBlocks.module)
    .all();
  const byWeek = new Map<string, Record<ModuleId, number>>();
  for (const r of rows) {
    const c = byWeek.get(r.week) ?? emptyCounts();
    c[r.module] = Number(r.n);
    byWeek.set(r.week, c);
  }
  return byWeek;
}

export function studyState(db: DB, u: AuthUser, now = Date.now()): StudyResponse {
  const week = weekStart(now);
  const today = berlinDay(now);
  const current = countsByWeek(db, u.id, week, addDays(week, 7)).get(week) ?? emptyCounts();
  const todayRows = db
    .select({ module: studyBlocks.module, n: sql<number>`count(*)` })
    .from(studyBlocks)
    .where(and(eq(studyBlocks.userId, u.id), eq(studyBlocks.day, today)))
    .groupBy(studyBlocks.module)
    .all();
  const todayCounts = emptyCounts();
  for (const r of todayRows) todayCounts[r.module] = Number(r.n);

  const claims = db.select({ week: studyClaims.week, coins: studyClaims.coins }).from(studyClaims).where(eq(studyClaims.userId, u.id)).all();
  const claimed = new Set(claims.map((c) => c.week));
  const pending: StudyWeek[] = [...countsByWeek(db, u.id, addDays(week, -7 * STUDY.claimWeeks), week).entries()]
    .filter(([w]) => !claimed.has(w))
    .map(([w, blocks]) => ({ week: w, blocks, reward: studyReward(blocks) }))
    .filter((w) => w.reward.total > 0)
    .sort((a, b) => b.week.localeCompare(a.week));

  return {
    week,
    weekEnd: addDays(week, 6),
    modules: MODULES.map((m) => ({ module: m, goalBlocks: STUDY.goalBlocks[m], goalHours: studyGoalHours(m), blocks: current[m], today: todayCounts[m] })),
    reward: studyReward(current),
    pending,
    claimedTotal: claims.reduce((s, c) => s + c.coins, 0),
  };
}

/** Einen 90-Minuten-Block für heute eintragen */
export function addStudyBlock(db: DB, u: AuthUser, module: ModuleId, now = Date.now()): StudyResponse {
  const day = berlinDay(now);
  const n = db
    .select({ n: sql<number>`count(*)` })
    .from(studyBlocks)
    .where(and(eq(studyBlocks.userId, u.id), eq(studyBlocks.module, module), eq(studyBlocks.day, day)))
    .get();
  if (Number(n?.n ?? 0) >= STUDY.maxPerModuleDay) throw badRequest('study_day_limit', `Mehr als ${STUDY.maxPerModuleDay} Blöcke pro Fach und Tag gehen nicht – gönn dir eine Pause.`);
  db.insert(studyBlocks).values({ userId: u.id, module, week: weekStart(now), day, createdAt: now }).run();
  return studyState(db, u, now);
}

/** Den zuletzt eingetragenen Block dieses Fachs in der laufenden Woche zurücknehmen */
export function undoStudyBlock(db: DB, u: AuthUser, module: ModuleId, now = Date.now()): StudyResponse {
  const last = db
    .select({ id: studyBlocks.id })
    .from(studyBlocks)
    .where(and(eq(studyBlocks.userId, u.id), eq(studyBlocks.module, module), eq(studyBlocks.week, weekStart(now))))
    .orderBy(desc(studyBlocks.createdAt), desc(studyBlocks.id))
    .get();
  if (!last) throw notFound('Diese Woche ist für das Fach noch kein Block eingetragen.');
  db.delete(studyBlocks).where(eq(studyBlocks.id, last.id)).run();
  return studyState(db, u, now);
}

/** Belohnung einer abgeschlossenen Woche abholen */
export function claimStudyWeek(db: DB, u: AuthUser, week: string, now = Date.now()): StudyResponse & { coins: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw badRequest('bad_week', 'Ungültige Woche.');
  const state = studyState(db, u, now);
  if (week >= state.week) throw badRequest('week_running', 'Die Woche läuft noch – abholen geht ab Montag.');
  const w = state.pending.find((p) => p.week === week);
  if (!w) {
    const done = db.select().from(studyClaims).where(and(eq(studyClaims.userId, u.id), eq(studyClaims.week, week))).get();
    if (done) throw conflict('claimed', 'Schon abgeholt.');
    throw notFound('Für diese Woche gibt es nichts abzuholen.');
  }
  const coins = w.reward.total;
  db.transaction((tx) => {
    tx.insert(studyClaims).values({ userId: u.id, week, coins, claimedAt: now }).run();
    tx.update(users).set({ coins: sql`${users.coins} + ${coins}` }).where(eq(users.id, u.id)).run();
  });
  return { ...studyState(db, u, now), coins };
}

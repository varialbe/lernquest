import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, lt, ne, or, sql } from 'drizzle-orm';
import { DUEL, MODULE_INFO, petStage, type DuelPlayer, type DuelsResponse, type DuelSummary, type ModuleId, type Question, type RunStart } from '@lernquest/shared';
import type { DB } from '../db/index.ts';
import { duels, questions, quizRuns, userPets, users } from '../db/schema.ts';
import type { AuthUser } from './auth.ts';
import { badRequest, conflict, forbidden, notFound } from './http.ts';
import { sendToUser } from './push.ts';
import { corePool, insertRun, stratified } from './runs.ts';

type DuelRow = typeof duels.$inferSelect;
type RunRow = typeof quizRuns.$inferSelect;

function player(db: DB, userId: number): DuelPlayer {
  const u = db.select().from(users).where(eq(users.id, userId)).get()!;
  const pet = u.activePet ? db.select().from(userPets).where(and(eq(userPets.userId, u.id), eq(userPets.petId, u.activePet))).get() : undefined;
  return { username: u.username, displayName: u.displayName, pet: u.activePet, petStage: pet ? petStage(pet.xp) : 1, frame: u.frame };
}

const runsOf = (db: DB, duelId: string) => db.select().from(quizRuns).where(eq(quizRuns.duelId, duelId)).all();
const doneRun = (runs: RunRow[], userId: number) => runs.find((r) => r.userId === userId && r.completedAt);

/** Sieger: mehr richtige Antworten, bei Gleichstand die schnellere Zeit. */
function decide(a: RunRow, b: RunRow): number | null {
  if (a.correct !== b.correct) return (a.correct ?? 0) > (b.correct ?? 0) ? a.userId : b.userId;
  if (a.durationSec !== b.durationSec) return (a.durationSec ?? 1e9) < (b.durationSec ?? 1e9) ? a.userId : b.userId;
  return null;
}

export function summarize(db: DB, d: DuelRow, meId: number): DuelSummary {
  const runs = runsOf(db, d.id);
  const otherId = d.challengerId === meId ? d.opponentId : d.challengerId;
  const mine = doneRun(runs, meId);
  const theirs = doneRun(runs, otherId);
  const reveal = !!mine || d.status !== 'open';
  return {
    id: d.id,
    module: d.module as ModuleId,
    status: d.status,
    createdAt: new Date(d.createdAt).toISOString(),
    expiresAt: new Date(d.expiresAt).toISOString(),
    questionCount: d.questionIds.length,
    challengedByMe: d.challengerId === meId,
    opponent: player(db, otherId),
    me: { played: !!mine, correct: mine?.correct ?? null, durationSec: mine?.durationSec ?? null },
    them: { played: !!theirs, correct: reveal ? (theirs?.correct ?? null) : null, durationSec: reveal ? (theirs?.durationSec ?? null) : null },
    winner: d.status !== 'done' ? null : d.winnerId === null ? 'draw' : d.winnerId === meId ? 'me' : 'them',
  };
}

export function listDuels(db: DB, u: AuthUser, now = Date.now()): DuelsResponse {
  const since = now - 14 * 24 * 3600_000;
  const rows = db
    .select()
    .from(duels)
    .where(and(or(eq(duels.challengerId, u.id), eq(duels.opponentId, u.id)), or(eq(duels.status, 'open'), sql`${duels.createdAt} >= ${since}`)))
    .orderBy(desc(duels.createdAt))
    .limit(40)
    .all();
  const opponents = db
    .select({ id: users.id })
    .from(users)
    .where(and(ne(users.id, u.id), eq(users.disabled, false)))
    .all()
    .map((x) => player(db, x.id));
  return { duels: rows.map((d) => summarize(db, d, u.id)), opponents };
}

export function createDuel(db: DB, u: AuthUser, opponentUsername: string, module: ModuleId, now = Date.now()): DuelSummary {
  const opp = db.select().from(users).where(eq(users.username, opponentUsername.toLowerCase())).get();
  if (!opp || opp.disabled) throw notFound('Diese Person gibt es nicht.');
  if (opp.id === u.id) throw badRequest('self', 'Gegen dich selbst kannst du nicht antreten.');
  const open = db.select({ n: sql<number>`count(*)` }).from(duels).where(and(eq(duels.challengerId, u.id), eq(duels.status, 'open'))).get()?.n ?? 0;
  if (open >= DUEL.maxOpen) throw conflict('too_many', `Du hast schon ${DUEL.maxOpen} offene Herausforderungen.`);
  const pool = corePool(db, module);
  if (pool.length < DUEL.questions) throw badRequest('no_data', 'In diesem Modul gibt es noch zu wenige Fragen.');
  const picked = stratified(pool, DUEL.questions).map((q) => q.id);
  const id = randomUUID();
  db.insert(duels).values({ id, module, questionIds: picked, challengerId: u.id, opponentId: opp.id, expiresAt: now + DUEL.expiresHours * 3600_000, createdAt: now }).run();
  return summarize(db, db.select().from(duels).where(eq(duels.id, id)).get()!, u.id);
}

export function playDuel(db: DB, u: AuthUser, duelId: string): RunStart {
  const d = db.select().from(duels).where(eq(duels.id, duelId)).get();
  if (!d) throw notFound('Duell nicht gefunden');
  if (d.challengerId !== u.id && d.opponentId !== u.id) throw forbidden('Das ist nicht dein Duell.');
  if (d.status !== 'open') throw conflict('closed', 'Dieses Duell ist schon vorbei.');
  const runs = runsOf(db, d.id).filter((r) => r.userId === u.id);
  if (runs.some((r) => r.completedAt)) throw conflict('already_done', 'Du hast dieses Duell schon gespielt.');
  const runId = runs[0]?.id ?? insertRun(db, u.id, 'duel', d.module, d.questionIds, d.id);
  const qs = new Map(
    db
      .select({ id: questions.id, data: questions.data })
      .from(questions)
      .where(inArray(questions.id, d.questionIds))
      .all()
      .map((q) => [q.id, q.data as Question]),
  );
  const other = player(db, d.challengerId === u.id ? d.opponentId : d.challengerId);
  return {
    runId,
    kind: 'duel',
    title: `Duell gegen ${other.displayName}`,
    module: d.module as ModuleId,
    questions: d.questionIds.flatMap((id) => (qs.has(id) ? [qs.get(id)!] : [])),
    timeLimitSec: null,
    duelId: d.id,
  };
}

export function declineDuel(db: DB, u: AuthUser, duelId: string) {
  const d = db.select().from(duels).where(eq(duels.id, duelId)).get();
  if (!d || d.opponentId !== u.id) throw notFound('Duell nicht gefunden');
  if (d.status !== 'open') throw conflict('closed', 'Dieses Duell ist schon vorbei.');
  db.update(duels).set({ status: 'declined', finishedAt: Date.now() }).where(eq(duels.id, d.id)).run();
  void sendToUser(db, d.challengerId, { title: 'Duell abgelehnt', body: `${u.displayName} hat dein Duell abgelehnt.`, en: { title: 'Duel declined', body: `${u.displayName} declined your duel.` }, url: '/duels' });
}

function finish(db: DB, d: DuelRow, winnerId: number | null, now: number) {
  db.transaction((tx) => {
    const res = tx.update(duels).set({ status: 'done', winnerId, finishedAt: now }).where(and(eq(duels.id, d.id), eq(duels.status, 'open'))).run();
    if (res.changes && winnerId !== null) tx.update(users).set({ coins: sql`${users.coins} + ${DUEL.winCoins}` }).where(eq(users.id, winnerId)).run();
  });
}

/** Nach jeder Duell-Runde: sind beide fertig, wird ausgewertet und beide bekommen eine Nachricht. */
export function resolveDuel(db: DB, duelId: string, viewerId: number, now = Date.now()): DuelSummary | null {
  const d = db.select().from(duels).where(eq(duels.id, duelId)).get();
  if (!d) return null;
  const runs = runsOf(db, d.id);
  const a = doneRun(runs, d.challengerId);
  const b = doneRun(runs, d.opponentId);
  if (d.status === 'open' && a && b) {
    const winnerId = decide(a, b);
    finish(db, d, winnerId, now);
    for (const [me, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const won = winnerId === me.userId;
      const draw = winnerId === null;
      const name = player(db, other.userId).displayName;
      void sendToUser(db, me.userId, {
        title: draw ? '🤝 Unentschieden!' : won ? '🏆 Duell gewonnen!' : 'Duell verloren',
        body: `${me.correct}:${other.correct} gegen ${name}${won ? ` · +${DUEL.winCoins} Coins` : ''}`,
        en: { title: draw ? '🤝 It is a draw!' : won ? '🏆 Duel won!' : 'Duel lost', body: `${me.correct}:${other.correct} against ${name}${won ? ` · +${DUEL.winCoins} coins` : ''}` },
        url: '/duels',
      });
    }
  } else if (d.status === 'open' && (a || b)) {
    // Benachrichtigung erst, wenn vorgelegt wurde – dann weiß die andere Seite, was zu schlagen ist
    const run = (a ?? b)!;
    const waiting = run.userId === d.challengerId ? d.opponentId : d.challengerId;
    const name = player(db, run.userId).displayName;
    void sendToUser(db, waiting, {
      title: run.userId === d.challengerId ? `⚔️ ${name} fordert dich heraus` : '⚔️ Du bist dran',
      body: `${MODULE_INFO[d.module as ModuleId].short}-Duell: ${name} hat ${run.correct}/${d.questionIds.length} vorgelegt. Noch ${Math.max(1, Math.round((d.expiresAt - now) / 3600_000))} Std.`,
      en: { title: run.userId === d.challengerId ? `⚔️ ${name} challenged you` : '⚔️ Your turn', body: `${MODULE_INFO[d.module as ModuleId].short} duel: ${name} scored ${run.correct}/${d.questionIds.length}. ${Math.max(1, Math.round((d.expiresAt - now) / 3600_000))} hours left.` },
      url: '/duels',
    });
  }
  return summarize(db, db.select().from(duels).where(eq(duels.id, duelId)).get()!, viewerId);
}

/** Abgelaufene Duelle: hat nur eine Seite gespielt, gewinnt sie; sonst verfällt das Duell. */
export function expireDuels(db: DB, now = Date.now()) {
  const stale = db.select().from(duels).where(and(eq(duels.status, 'open'), lt(duels.expiresAt, now))).all();
  for (const d of stale) {
    const runs = runsOf(db, d.id);
    const a = doneRun(runs, d.challengerId);
    const b = doneRun(runs, d.opponentId);
    if (a && !b) finish(db, d, d.challengerId, now);
    else if (b && !a) finish(db, d, d.opponentId, now);
    else db.update(duels).set({ status: 'expired', finishedAt: now }).where(eq(duels.id, d.id)).run();
  }
  return stale.length;
}

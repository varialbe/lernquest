import { and, eq, gte, lt, sum } from 'drizzle-orm';
import { LEAGUES, MODULE_INFO, leagueZones, petStage, type LeaderboardEntry, type LeaderboardResponse, type ModuleId } from '@lernquest/shared';
import type { DB } from '../db/index.ts';
import { leagueWeeks, userPets, users, xpEvents } from '../db/schema.ts';
import { addDays, berlinDay, berlinMidnight, weekStart } from './time.ts';

/** XP pro Nutzer im Zeitfenster [from, to). */
function xpInWindow(db: DB, from: number, to: number): Map<number, number> {
  return new Map(
    db
      .select({ userId: xpEvents.userId, s: sum(xpEvents.amount) })
      .from(xpEvents)
      .where(and(gte(xpEvents.createdAt, from), lt(xpEvents.createdAt, to)))
      .groupBy(xpEvents.userId)
      .all()
      .map((r) => [r.userId, Number(r.s ?? 0)]),
  );
}

/**
 * Wöchentlicher Liga-Reset (Montag 00:00 Berlin): Die abgelaufene Woche wird genau einmal ausgewertet.
 * Pro Liga steigen die besten (mit XP > 0) auf, die schlechtesten ab. Die Wochen-XP „resetten“ sich
 * automatisch, weil das Zeitfenster am Montag neu beginnt.
 */
export function ensureLeagueRollover(db: DB, now = Date.now()): { processed: string | null } {
  const current = weekStart(now);
  const previous = addDays(current, -7);
  if (db.select().from(leagueWeeks).where(eq(leagueWeeks.weekStart, previous)).get()) return { processed: null };

  const xp = xpInWindow(db, berlinMidnight(previous), berlinMidnight(current));
  const all = db.select({ id: users.id, tier: users.leagueTier, disabled: users.disabled }).from(users).all().filter((u) => !u.disabled);
  const moves: { userId: number; from: number; to: number }[] = [];
  for (let tier = 0; tier < LEAGUES.length; tier++) {
    const group = all
      .filter((u) => u.tier === tier)
      .map((u) => ({ ...u, xp: xp.get(u.id) ?? 0 }))
      .sort((a, b) => b.xp - a.xp || a.id - b.id);
    const { promote, demote } = leagueZones(group.length);
    group.forEach((u, i) => {
      if (i < promote && u.xp > 0 && tier < LEAGUES.length - 1) moves.push({ userId: u.id, from: tier, to: tier + 1 });
      else if (i >= group.length - demote && tier > 0) moves.push({ userId: u.id, from: tier, to: tier - 1 });
    });
  }
  db.transaction((tx) => {
    // Race-sicher: nur der erste Request schreibt die Woche
    const res = tx.insert(leagueWeeks).values({ weekStart: previous, result: moves }).onConflictDoNothing().run();
    if (res.changes === 0) return;
    for (const m of moves) tx.update(users).set({ leagueTier: m.to }).where(eq(users.id, m.userId)).run();
  });
  return { processed: previous };
}

function entries(db: DB, meId: number, rows: { userId: number; value: number }[]): LeaderboardEntry[] {
  const info = new Map(
    db
      .select({ id: users.id, displayName: users.displayName, username: users.username, frame: users.frame, pet: users.activePet, disabled: users.disabled })
      .from(users)
      .all()
      .map((u) => [u.id, u]),
  );
  const petXp = new Map(db.select().from(userPets).all().map((p) => [`${p.userId}:${p.petId}`, p.xp]));
  return rows
    .filter((r) => info.has(r.userId) && !info.get(r.userId)!.disabled)
    .sort((a, b) => b.value - a.value || a.userId - b.userId)
    .map((r, i) => {
      const u = info.get(r.userId)!;
      return {
        rank: i + 1,
        userId: u.id,
        displayName: u.displayName,
        username: u.username,
        value: r.value,
        frame: u.frame,
        pet: u.pet,
        petStage: u.pet ? petStage(petXp.get(`${u.id}:${u.pet}`) ?? 0) : 1,
        me: u.id === meId,
      };
    });
}

export function leaderboard(db: DB, meId: number, kind: string, now = Date.now()): LeaderboardResponse {
  ensureLeagueRollover(db, now);
  const allUsers = db.select({ id: users.id, xp: users.xp, longest: users.longestStreak, tier: users.leagueTier }).from(users).all();

  if (kind === 'league') {
    const me = allUsers.find((u) => u.id === meId)!;
    const from = berlinMidnight(weekStart(now));
    const to = berlinMidnight(addDays(weekStart(now), 7));
    const xp = xpInWindow(db, from, to);
    const list = entries(db, meId, allUsers.filter((u) => u.tier === me.tier).map((u) => ({ userId: u.id, value: xp.get(u.id) ?? 0 })));
    const { promote, demote } = leagueZones(list.length);
    for (const e of list) {
      e.zone = e.rank <= promote && e.value > 0 && me.tier < LEAGUES.length - 1 ? 'promote' : e.rank > list.length - demote && me.tier > 0 ? 'demote' : null;
    }
    return { kind, title: `${LEAGUES[me.tier]}-Liga`, league: LEAGUES[me.tier], resetsAt: new Date(to).toISOString(), entries: list };
  }
  if (kind === 'alltime') return { kind, title: 'Allzeit-XP', entries: entries(db, meId, allUsers.map((u) => ({ userId: u.id, value: u.xp }))) };
  if (kind === 'streak') return { kind, title: 'Längste Streaks', entries: entries(db, meId, allUsers.map((u) => ({ userId: u.id, value: u.longest }))) };

  const mod = kind.toUpperCase() as ModuleId;
  if (mod in MODULE_INFO) {
    const rows = db
      .select({ userId: xpEvents.userId, s: sum(xpEvents.amount) })
      .from(xpEvents)
      .where(eq(xpEvents.module, mod))
      .groupBy(xpEvents.userId)
      .all();
    const xp = new Map(rows.map((r) => [r.userId, Number(r.s ?? 0)]));
    return { kind, title: `${MODULE_INFO[mod].short} – XP`, entries: entries(db, meId, allUsers.map((u) => ({ userId: u.id, value: xp.get(u.id) ?? 0 }))) };
  }
  return { kind, title: 'Unbekannt', entries: [] };
}

/** XP der letzten `days` Tage für den Streak-Kalender. */
export function calendar(db: DB, userId: number, days = 35, now = Date.now()) {
  const today = berlinDay(now);
  const from = addDays(today, -(days - 1));
  const rows = new Map(
    db
      .select({ day: xpEvents.day, s: sum(xpEvents.amount) })
      .from(xpEvents)
      .where(and(eq(xpEvents.userId, userId), gte(xpEvents.day, from)))
      .groupBy(xpEvents.day)
      .all()
      .map((r) => [r.day, Number(r.s ?? 0)]),
  );
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(from, i);
    return { day, xp: rows.get(day) ?? 0 };
  });
}

import { and, eq, gte, lt, sql, sum } from 'drizzle-orm';
import { RECAP, type RecapResponse } from '@lernquest/shared';
import type { DB } from '../db/index.ts';
import { answers, pushSubscriptions, users, xpEvents } from '../db/schema.ts';
import type { AuthUser } from './auth.ts';
import { dueCards } from './cards.ts';
import { dueReviews } from './game.ts';
import { pushEnabled, sendPush } from './push.ts';
import { mastery } from './runs.ts';
import { addDays, berlinDay, berlinHour, berlinMidnight, weekStart } from './time.ts';

/**
 * Wochenrückblick: XP, Fragen, Trefferquote, Streak, wackeligste Konzepte, Fälliges.
 * Web-App: Push sonntags ab 18 Uhr (einmal pro Woche und Gerät). iOS-App: lokal geplant mit GET /api/recap.
 * Nur für Personen mit aktivierten Mitteilungen und eingeschaltetem Wochenrückblick.
 */
const fmt = (n: number) => n.toLocaleString('de-DE');

export function weeklyRecap(db: DB, u: AuthUser, now = Date.now()): RecapResponse {
  const monday = weekStart(now);
  const from = berlinMidnight(monday);
  const prevFrom = berlinMidnight(addDays(monday, -7));
  const xpIn = (a: number, b: number) =>
    Number(db.select({ s: sum(xpEvents.amount) }).from(xpEvents).where(and(eq(xpEvents.userId, u.id), gte(xpEvents.createdAt, a), lt(xpEvents.createdAt, b))).get()?.s ?? 0);
  const xp = xpIn(from, now + 1);
  const prevXp = xpIn(prevFrom, from);
  const a = db
    .select({ n: sql<number>`count(*)`, ok: sql<number>`coalesce(sum(${answers.correct}), 0)` })
    .from(answers)
    .where(and(eq(answers.userId, u.id), gte(answers.createdAt, from)))
    .get();
  const answered = Number(a?.n ?? 0);
  const rate = answered ? Math.round((Number(a?.ok ?? 0) / answered) * 100) : 0;
  const weak = mastery(db, u)
    .modules.flatMap((m) => m.concepts)
    .filter((c) => c.level === 'weak')
    .sort((x, y) => x.score - y.score)
    .slice(0, 2)
    .map((c) => c.concept);
  const due = dueReviews(db, u.id, berlinDay(now));
  const cards = dueCards(db, u.id, berlinDay(now));

  if (!xp && !answered) {
    return {
      title: '📊 Deine Woche bei LernQuest',
      body: [
        'Diese Woche war ruhig.',
        cards ? `${fmt(cards)} Karteikarten warten – 5 Minuten reichen für den Anfang.` : due ? `${fmt(due)} Fragen sind zum Wiederholen fällig.` : 'Starte mit einem Level oder ein paar Karteikarten.',
      ].join(' '),
      url: cards ? '/karten' : '/',
    };
  }
  const trend = prevXp ? Math.round(((xp - prevXp) / prevXp) * 100) : null;
  const parts = [
    `${fmt(answered)} Fragen, ${rate} % richtig`,
    u.streak > 1 ? `🔥 ${u.streak} Tage Streak` : null,
    weak.length ? `Wackelig: ${weak.join(', ')}` : null,
    due + cards ? `Fällig: ${[due ? `${due} Fragen` : '', cards ? `${cards} Karten` : ''].filter(Boolean).join(' + ')}` : null,
  ].filter(Boolean);
  return {
    title: `📊 Deine Woche: ${fmt(xp)} XP${trend === null ? '' : trend >= 0 ? ` (+${trend} %)` : ` (${trend} %)`}`,
    body: parts.join(' · ').slice(0, 220),
    url: weak.length ? '/mastery' : cards ? '/karten' : '/train',
  };
}

/** Sonntags ab RECAP.hour bis 22 Uhr: einmal pro Woche und Abo. */
export async function recapTick(db: DB, now = Date.now()) {
  if (!pushEnabled()) return 0;
  const weekday = new Date(`${berlinDay(now)}T12:00:00Z`).getUTCDay(); // 0 = So
  if (weekday !== RECAP.weekday || berlinHour(now) < RECAP.hour || berlinHour(now) >= 22) return 0;
  const week = weekStart(now);
  let sent = 0;
  const subs = db.select({ sub: pushSubscriptions, user: users }).from(pushSubscriptions).innerJoin(users, eq(users.id, pushSubscriptions.userId)).all();
  const cache = new Map<number, RecapResponse>();
  for (const { sub, user } of subs) {
    if (sub.lastRecapWeek === week || user.disabled || !user.weeklyRecap) continue;
    db.update(pushSubscriptions).set({ lastRecapWeek: week }).where(eq(pushSubscriptions.id, sub.id)).run();
    if (!cache.has(user.id)) cache.set(user.id, weeklyRecap(db, user, now));
    if (await sendPush(db, sub, cache.get(user.id)!)) sent++;
  }
  return sent;
}

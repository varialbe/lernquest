import { asc, eq, gt } from 'drizzle-orm';
import { MODULE_INFO, type ModuleId } from '@lernquest/shared';
import webpush from 'web-push';
import type { DB } from '../db/index.ts';
import { pipelineState, pushSubscriptions, units, users } from '../db/schema.ts';
import { todayXp } from './game.ts';
import { berlinDay, berlinHour } from './time.ts';

export const pushEnabled = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

let configured = false;
function configure() {
  if (configured || !pushEnabled()) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@varialbe.xyz', process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  configured = true;
}

export async function sendPush(db: DB, sub: typeof pushSubscriptions.$inferSelect, payload: object) {
  configure();
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 6 * 3600 });
    return true;
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)).run(); // abgelaufen
    return false;
  }
}

/** Abendliche Streak-Erinnerung: einmal pro Tag ab REMINDER_HOUR, wenn das Tagesziel noch nicht erreicht ist. */
export async function remindersTick(db: DB, now = Date.now()) {
  if (!pushEnabled()) return 0;
  const hour = Number(process.env.REMINDER_HOUR ?? 19);
  if (berlinHour(now) < hour || berlinHour(now) >= 23) return 0;
  const day = berlinDay(now);
  let sent = 0;
  const subs = db.select({ sub: pushSubscriptions, user: users }).from(pushSubscriptions).innerJoin(users, eq(users.id, pushSubscriptions.userId)).all();
  for (const { sub, user } of subs) {
    if (sub.lastRemindedDay === day || user.disabled) continue;
    const xp = todayXp(db, user.id, day);
    db.update(pushSubscriptions).set({ lastRemindedDay: day }).where(eq(pushSubscriptions.id, sub.id)).run();
    if (xp >= user.dailyGoal) continue;
    const atRisk = user.streak > 0 && user.lastActiveDay !== day;
    const ok = await sendPush(db, sub, {
      title: atRisk ? `🔥 Dein ${user.streak}-Tage-Streak wartet!` : 'Zeit für eine kleine Runde 📚',
      body: atRisk ? 'Ein Level reicht, um ihn zu retten.' : `Noch ${user.dailyGoal - xp} XP bis zu deinem Tagesziel.`,
      url: '/',
    });
    if (ok) sent++;
  }
  return sent;
}

/** An alle Geräte einer Person (Duelle). Ohne VAPID oder Abo passiert nichts. */
export async function sendToUser(db: DB, userId: number, payload: { title: string; body: string; url?: string }) {
  if (!pushEnabled()) return 0;
  let sent = 0;
  for (const sub of db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).all()) if (await sendPush(db, sub, payload)) sent++;
  return sent;
}

const ANNOUNCED = 'push_announced_units_at';

/**
 * Neue Units (vom nächtlichen Lauf) ankündigen – aber erst ab 8 Uhr, nicht um Mitternacht.
 * Beim allerersten Aufruf wird nur der Zeitpunkt gemerkt, damit der Backfill nicht angekündigt wird.
 */
export async function newUnitsTick(db: DB, now = Date.now()) {
  const marker = db.select().from(pipelineState).where(eq(pipelineState.key, ANNOUNCED)).get();
  if (!marker) {
    db.insert(pipelineState).values({ key: ANNOUNCED, value: String(now) }).run();
    return 0;
  }
  if (!pushEnabled() || berlinHour(now) < 8 || berlinHour(now) >= 21) return 0;
  const fresh = db.select().from(units).where(gt(units.createdAt, Number(marker.value))).orderBy(asc(units.createdAt)).all();
  if (!fresh.length) return 0;
  db.update(pipelineState).set({ value: String(fresh.at(-1)!.createdAt), updatedAt: now }).where(eq(pipelineState.key, ANNOUNCED)).run();
  const first = fresh[0]!;
  const payload =
    fresh.length === 1
      ? { title: `📚 Neu in ${MODULE_INFO[first.module as ModuleId]?.short ?? first.module}: ${first.title}`, body: 'Vier frische Level + Praxis warten auf dich.', url: '/' }
      : { title: `📚 ${fresh.length} neue Units sind da`, body: fresh.map((u) => `${u.module} ${u.number}: ${u.title}`).join(' · ').slice(0, 180), url: '/' };
  let sent = 0;
  const subs = db.select({ sub: pushSubscriptions, user: users }).from(pushSubscriptions).innerJoin(users, eq(users.id, pushSubscriptions.userId)).all();
  for (const { sub, user } of subs) if (!user.disabled && (await sendPush(db, sub, payload))) sent++;
  return sent;
}

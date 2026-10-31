import { eq } from 'drizzle-orm';
import webpush from 'web-push';
import type { DB } from '../db/index.ts';
import { pushSubscriptions, users } from '../db/schema.ts';
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

import './env.ts';
import { ROOT } from './env.ts';
import { resolve } from 'node:path';
import { buildApp } from './app.ts';
import { importContentDir } from './content/import.ts';
import { getDb } from './db/index.ts';
import { cleanupSessions } from './lib/auth.ts';
import { migrateLegacyEmails } from './lib/account.ts';
import { ensureLeagueRollover } from './lib/league.ts';
import { expireDuels } from './lib/duels.ts';
import { newUnitsTick, remindersTick } from './lib/push.ts';
import { recapTick } from './lib/recap.ts';

const db = getDb();
// content/ ist die Quelle der Wahrheit – beim Start (idempotent) abgleichen
const synced = importContentDir(db, resolve(ROOT, 'content')).filter((r) => r.status !== 'unchanged');
for (const f of synced.filter((r) => r.status === 'failed')) console.error(`content/${f.unitId} ungültig: ${f.error}`);
// E-Mails aus Migration 0003 (Klartext) einmalig verschlüsseln
const migrated = migrateLegacyEmails(db);
const app = await buildApp(db, { logger: true });
if (migrated) app.log.info({ migrated }, 'E-Mail-Adressen verschlüsselt');
if (synced.length) app.log.info({ synced }, 'content importiert');

const tick = async () => {
  try {
    ensureLeagueRollover(db);
    cleanupSessions(db);
    expireDuels(db);
    const sent = await remindersTick(db);
    if (sent) app.log.info({ sent }, 'Streak-Erinnerungen gesendet');
    const announced = await newUnitsTick(db);
    if (announced) app.log.info({ announced }, 'Neue Units angekündigt');
    const recaps = await recapTick(db);
    if (recaps) app.log.info({ recaps }, 'Wochenrückblicke gesendet');
  } catch (e) {
    app.log.error(e);
  }
};
setInterval(tick, 5 * 60_000).unref();
void tick();

await app.listen({ host: process.env.API_HOST ?? '127.0.0.1', port: Number(process.env.API_PORT ?? 3460) });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => void app.close().then(() => process.exit(0)));

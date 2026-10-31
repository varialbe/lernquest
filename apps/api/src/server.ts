import './env.ts';
import { ROOT } from './env.ts';
import { resolve } from 'node:path';
import { buildApp } from './app.ts';
import { importContentDir } from './content/import.ts';
import { getDb } from './db/index.ts';
import { cleanupSessions } from './lib/auth.ts';
import { ensureLeagueRollover } from './lib/league.ts';
import { remindersTick } from './lib/push.ts';

const db = getDb();
// content/ ist die Quelle der Wahrheit – beim Start (idempotent) abgleichen
const synced = importContentDir(db, resolve(ROOT, 'content')).filter((r) => r.status !== 'unchanged');
for (const f of synced.filter((r) => r.status === 'failed')) console.error(`content/${f.unitId} ungültig: ${f.error}`);
const app = await buildApp(db, { logger: true });
if (synced.length) app.log.info({ synced }, 'content importiert');

const tick = async () => {
  try {
    ensureLeagueRollover(db);
    cleanupSessions(db);
    const sent = await remindersTick(db);
    if (sent) app.log.info({ sent }, 'Streak-Erinnerungen gesendet');
  } catch (e) {
    app.log.error(e);
  }
};
setInterval(tick, 5 * 60_000).unref();
void tick();

await app.listen({ host: process.env.API_HOST ?? '127.0.0.1', port: Number(process.env.API_PORT ?? 3460) });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => void app.close().then(() => process.exit(0)));

import { and, eq, gte } from 'drizzle-orm';
import { getDb } from '@lernquest/api/db';
import { pipelineRuns } from '@lernquest/api/schema';
import { berlinDay, berlinMidnight } from '@lernquest/api/time';
import { notify } from './notify.ts';

/** Läuft um 00:30 (systemd-Timer): Wurde heute schon ein nächtlicher Lauf gestartet? Sonst Warnung. */
export async function watchdog(): Promise<boolean> {
  const today = berlinDay();
  const since = berlinMidnight(today);
  const runs = getDb().select().from(pipelineRuns).where(and(eq(pipelineRuns.mode, 'run'), gte(pipelineRuns.startedAt, since))).all();
  if (runs.length) {
    console.log(`OK: ${runs.length} Lauf/Läufe seit 00:00 (${runs.map((r) => `${r.id}=${r.status}`).join(', ')})`);
    return true;
  }
  const via = await notify(
    'warn',
    '⚠️ LernQuest: kein nächtlicher Lauf',
    `Bis 00:30 wurde für den ${today} kein Pipeline-Lauf geloggt.\nPrüfen: n8n-Container (<code>docker ps</code>), Workflow aktiv?, <code>systemctl status lernquest-pipeline</code>.`,
  );
  console.log(`WARNUNG: kein Lauf heute – gemeldet via ${via}`);
  return false;
}

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { desc, eq } from 'drizzle-orm';
import { ROOT } from '../env.ts';
import type { DB } from '../db/index.ts';
import { pipelineRuns } from '../db/schema.ts';

/**
 * Pipeline aus dem Telegram-Bot starten/beobachten (statt bis 00:00 auf n8n zu warten).
 * Spricht denselben Trigger-Dienst an wie n8n (127.0.0.1:3461, Bearer PIPELINE_TOKEN).
 */
export type TriggerMode = 'run' | 'dry-run' | 'knowledge';
export type TriggerResult = { ok: true; runId: string } | { ok: false; running?: string; error: string };

const base = () => `http://${process.env.PIPELINE_HOST?.trim() || '127.0.0.1'}:${process.env.PIPELINE_PORT?.trim() || '3461'}`;

export async function triggerPipeline(mode: TriggerMode): Promise<TriggerResult> {
  const token = process.env.PIPELINE_TOKEN?.trim();
  if (!token) return { ok: false, error: 'PIPELINE_TOKEN fehlt in .env' };
  try {
    const res = await fetch(`${base()}/run`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ mode }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
    if (res.status === 202 && json.runId) return { ok: true, runId: json.runId };
    if (res.status === 409) return { ok: false, running: json.runId, error: 'Es läuft schon ein Lauf.' };
    return { ok: false, error: `Trigger antwortet ${res.status}: ${json.error ?? ''}` };
  } catch (e) {
    return { ok: false, error: `Trigger nicht erreichbar (${(e as Error).message}) – läuft lernquest-pipeline?` };
  }
}

/** Läuft gerade etwas? (Trigger-/health, unabhängig von der DB) */
export async function runningRunId(): Promise<string | null> {
  try {
    const res = await fetch(`${base()}/health`, { signal: AbortSignal.timeout(5000) });
    return ((await res.json()) as { running: string | null }).running;
  } catch {
    return null;
  }
}

export const runRow = (db: DB, runId: string) => db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get();
export const recentRuns = (db: DB, n = 6) => db.select().from(pipelineRuns).orderBy(desc(pipelineRuns.startedAt)).limit(n).all();

/** Letzte aussagekräftige Zeilen aus data/runs/<runId>.log (für den Fortschritt im Chat). */
export function runProgress(runId: string, lines = 8): string[] {
  const file = resolve(ROOT, 'data/runs', `${runId}.log`);
  if (!existsSync(file)) return [];
  const all = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() && !/^\s*·\s*übersprungen/.test(l));
  // Abschlussbericht (mehrzeilig) nicht doppelt zeigen
  const cut = all.findIndex((l) => /LernQuest-Pipeline \S+ \(/.test(l));
  return (cut >= 0 ? all.slice(0, cut) : all).slice(-lines).map((l) => l.replace(/^\[(\d\d:\d\d):\d\d\] /, '$1 ').slice(0, 160));
}

export const STATUS_LABEL: Record<string, string> = {
  running: '⏳ läuft',
  success: '✅ erfolgreich',
  nothing_new: '✅ nichts Neues',
  partial: '⚠️ teilweise',
  failed: '❌ fehlgeschlagen',
};
export const MODE_LABEL: Record<string, string> = { run: 'Neue Inhalte', 'dry-run': 'Vorschau', knowledge: 'Wissenssammlung', backfill: 'Backfill', regenerate: 'Neu generieren', bonus: 'Praxis' };

/** Freitext wie „hol die neuen Sachen“, „update“, „fetch“ → Lauf starten */
export const FETCH_TEXT = /^\s*(hol|hole|holen|fetch|update|aktualisier|pull)\w*\b|neue?n? (sachen|inhalte|ressourcen|vorlesung|notizen|material)/i;

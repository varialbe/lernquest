import { api } from './api.ts';

/** Offline gespielte Abschlüsse werden lokal gepuffert und beim nächsten Online-Moment nachgereicht (Server wertet). */
type Pending = { url: string; body: unknown; at: number };
const KEY = 'lq.pending';

const read = (): Pending[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
};
const write = (p: Pending[]) => localStorage.setItem(KEY, JSON.stringify(p));

export const pendingCount = () => read().length;
export function queueSubmission(url: string, body: unknown) {
  write([...read(), { url, body, at: Date.now() }]);
}

let flushing = false;
export async function flushPending(): Promise<number> {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let done = 0;
  try {
    for (const p of read()) {
      try {
        await api(p.url, { method: 'POST', body: p.body });
      } catch (e) {
        if ((e as { status?: number }).status === 0) break; // weiterhin offline
      }
      write(read().filter((x) => x.at !== p.at));
      done++;
    }
  } finally {
    flushing = false;
  }
  return done;
}

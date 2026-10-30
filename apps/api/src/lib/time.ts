/** Zeit-Helfer: ein „Tag“ ist immer ein Kalendertag in Europe/Berlin. */
export const TZ = 'Europe/Berlin';

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** YYYY-MM-DD des Zeitpunkts in Berlin. */
export function berlinDay(at: number | Date = Date.now()): string {
  return dayFmt.format(typeof at === 'number' ? new Date(at) : at);
}

export function berlinHour(at: number = Date.now()): number {
  const p = partsFmt.formatToParts(new Date(at));
  return Number(p.find((x) => x.type === 'hour')!.value);
}

/** Tage auf einen YYYY-MM-DD-String addieren (reine Kalenderarithmetik). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** b - a in Kalendertagen. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/** Offset von Berlin gegenüber UTC (in ms) zum Zeitpunkt `at`. */
function berlinOffset(at: number): number {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** UTC-Zeitstempel von 00:00 Berlin am gegebenen Tag (DST-sicher). */
export function berlinMidnight(day: string): number {
  const guess = Date.parse(`${day}T00:00:00Z`);
  let t = guess - berlinOffset(guess);
  t = guess - berlinOffset(t);
  return t;
}

/** Montag (YYYY-MM-DD) der Berliner Kalenderwoche. */
export function weekStart(at: number = Date.now()): string {
  const day = berlinDay(at);
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 = So
  return addDays(day, -((dow + 6) % 7));
}

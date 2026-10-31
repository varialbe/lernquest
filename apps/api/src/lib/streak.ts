import { addDays, daysBetween } from './time.ts';

/** Reine Streak-Logik. Ein Tag zählt, wenn mindestens ein Level/eine Übung abgeschlossen wurde (Kalendertag Europe/Berlin). */
export type StreakState = { streak: number; longestStreak: number; lastActiveDay: string | null; streakFreezes: number };

/** Aktivität an `today` verbuchen. Verpasste Tage werden – falls vorhanden – mit Streak-Freezes überbrückt. */
export function recordActivity(s: StreakState, today: string): StreakState & { increased: boolean; freezesUsed: number } {
  if (s.lastActiveDay === today) return { ...s, increased: false, freezesUsed: 0 };
  let streak = 1;
  let freezes = s.streakFreezes;
  let used = 0;
  if (s.lastActiveDay) {
    const gap = daysBetween(s.lastActiveDay, today);
    if (gap <= 0) return { ...s, increased: false, freezesUsed: 0 }; // Uhr zurückgestellt o. ä.
    const missed = gap - 1;
    if (missed === 0) streak = s.streak + 1;
    else if (s.streak > 0 && freezes >= missed) {
      freezes -= missed;
      used = missed;
      streak = s.streak + 1;
    }
  }
  return { streak, longestStreak: Math.max(s.longestStreak, streak), lastActiveDay: today, streakFreezes: freezes, increased: true, freezesUsed: used };
}

/** Streak, wie er heute angezeigt wird (0, wenn er gerissen ist und Freezes nicht reichen). */
export function effectiveStreak(s: StreakState, today: string): number {
  if (!s.lastActiveDay || s.streak === 0) return 0;
  const gap = daysBetween(s.lastActiveDay, today);
  if (gap <= 1) return s.streak;
  return s.streakFreezes >= gap - 1 ? s.streak : 0;
}

/** Leitner: nächste Box + Fälligkeit nach einer Antwort. `null` = gemeistert (aus der Wiederholung entfernen). */
export function leitnerNext(box: number, correct: boolean, today: string, intervals: readonly number[], maxBox: number): { box: number; dueDay: string } | null {
  if (!correct) return { box: 1, dueDay: addDays(today, 1) };
  const next = box + 1;
  if (next > maxBox) return null;
  return { box: next, dueDay: addDays(today, intervals[next] ?? 1) };
}

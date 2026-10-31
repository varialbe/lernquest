import { describe, expect, it } from 'vitest';
import { effectiveStreak, leitnerNext, recordActivity } from '../src/lib/streak.ts';
import { addDays, berlinDay, berlinMidnight, daysBetween, weekStart } from '../src/lib/time.ts';

const base = { streak: 0, longestStreak: 0, lastActiveDay: null as string | null, streakFreezes: 0 };

describe('Berlin calendar days', () => {
  it('switches the day at Berlin midnight, not UTC midnight (winter, UTC+1)', () => {
    expect(berlinDay(Date.parse('2026-11-10T22:59:59Z'))).toBe('2026-11-10'); // 23:59:59 Berlin
    expect(berlinDay(Date.parse('2026-11-10T23:00:00Z'))).toBe('2026-11-11'); // 00:00 Berlin
  });
  it('switches the day at Berlin midnight in summer (UTC+2)', () => {
    expect(berlinDay(Date.parse('2026-07-01T21:59:59Z'))).toBe('2026-07-01');
    expect(berlinDay(Date.parse('2026-07-01T22:00:00Z'))).toBe('2026-07-02');
  });
  it('computes midnight correctly across DST changes', () => {
    expect(new Date(berlinMidnight('2026-03-29')).toISOString()).toBe('2026-03-28T23:00:00.000Z'); // Tag der Umstellung (Start noch MEZ)
    expect(new Date(berlinMidnight('2026-03-30')).toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect(new Date(berlinMidnight('2026-10-25')).toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(new Date(berlinMidnight('2026-10-26')).toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });
  it('day arithmetic is calendar based', () => {
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
  });
  it('week starts on Monday 00:00 Berlin', () => {
    expect(weekStart(Date.parse('2026-11-01T22:59:00Z'))).toBe('2026-10-26'); // So 23:59 Berlin
    expect(weekStart(Date.parse('2026-11-01T23:00:00Z'))).toBe('2026-11-02'); // Mo 00:00 Berlin
  });
});

describe('streak', () => {
  it('starts at 1 and counts a day only once', () => {
    const a = recordActivity(base, '2026-11-10');
    expect(a).toMatchObject({ streak: 1, increased: true });
    expect(recordActivity(a, '2026-11-10')).toMatchObject({ streak: 1, increased: false });
  });
  it('increments on consecutive Berlin days, even 1 minute apart around midnight', () => {
    const d1 = berlinDay(Date.parse('2026-11-10T22:59:00Z')); // 23:59 Berlin
    const d2 = berlinDay(Date.parse('2026-11-10T23:01:00Z')); // 00:01 Berlin
    const a = recordActivity(base, d1);
    expect(recordActivity(a, d2)).toMatchObject({ streak: 2, longestStreak: 2, increased: true });
  });
  it('does not increment for UTC-day changes within the same Berlin day', () => {
    const d1 = berlinDay(Date.parse('2026-11-10T23:30:00Z')); // 00:30 Berlin 11.11.
    const d2 = berlinDay(Date.parse('2026-11-11T20:00:00Z')); // 21:00 Berlin 11.11.
    const a = recordActivity(base, d1);
    expect(recordActivity(a, d2)).toMatchObject({ streak: 1, increased: false });
  });
  it('resets after a missed day without freeze', () => {
    const s = { ...base, streak: 5, longestStreak: 5, lastActiveDay: '2026-11-10' };
    expect(effectiveStreak(s, '2026-11-11')).toBe(5);
    expect(effectiveStreak(s, '2026-11-12')).toBe(0);
    expect(recordActivity(s, '2026-11-12')).toMatchObject({ streak: 1, longestStreak: 5 });
  });
  it('uses streak freezes for missed days', () => {
    const s = { ...base, streak: 5, longestStreak: 5, lastActiveDay: '2026-11-10', streakFreezes: 2 };
    expect(effectiveStreak(s, '2026-11-13')).toBe(5);
    expect(recordActivity(s, '2026-11-13')).toMatchObject({ streak: 6, streakFreezes: 0, freezesUsed: 2 });
    expect(recordActivity({ ...s, streakFreezes: 1 }, '2026-11-13')).toMatchObject({ streak: 1, streakFreezes: 1 });
  });
  it('survives the DST switch night', () => {
    const a = recordActivity(base, berlinDay(Date.parse('2026-10-24T21:00:00Z'))); // Sa 23:00 MESZ
    const b = recordActivity(a, berlinDay(Date.parse('2026-10-25T23:30:00Z'))); // Mo 00:30 MEZ → Sonntag verpasst
    expect(b.streak).toBe(1);
    const c = recordActivity(a, berlinDay(Date.parse('2026-10-25T22:30:00Z'))); // So 23:30 MEZ
    expect(c.streak).toBe(2);
  });
});

describe('leitner', () => {
  const iv = [0, 1, 2, 4, 7, 14];
  it('moves up on correct, back to box 1 on wrong, out after box 5', () => {
    expect(leitnerNext(1, true, '2026-11-10', iv, 5)).toEqual({ box: 2, dueDay: '2026-11-12' });
    expect(leitnerNext(4, false, '2026-11-10', iv, 5)).toEqual({ box: 1, dueDay: '2026-11-11' });
    expect(leitnerNext(5, true, '2026-11-10', iv, 5)).toBeNull();
  });
});

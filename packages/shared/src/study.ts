import { MODULES, type ModuleId } from './quiz.ts';

/**
 * Lernblöcke (Eigenstudium): Man trägt im Profil 90-Minuten-Blöcke je Fach ein.
 * Wochenziel je Fach; nach Wochenende (So 24:00 Berlin) gibt es eine Coin-Belohnung zum Abholen.
 * Blöcke über dem Ziel zählen nur noch wenig (und gedeckelt) – bewusst gegen Burnout.
 */
export const STUDY = {
  blockMinutes: 90,
  /** Wochenziel in Blöcken */
  goalBlocks: { EIP: 7, ERA: 4, DS: 5 } as Record<ModuleId, number>,
  /** Coins je Block bis zum Ziel */
  coinsPerBlock: 8,
  /** Bonus, wenn ein Fach sein Wochenziel erreicht */
  goalBonus: 25,
  /** Extra-Bonus, wenn alle Fächer ihr Ziel erreichen */
  allGoalsBonus: 50,
  /** Blöcke über dem Ziel: kleiner Bonus, höchstens `extraMax` je Fach */
  coinsPerExtraBlock: 2,
  extraMax: 3,
  /** höchstens so viele Blöcke je Fach und Tag (Tippfehler/Spam) */
  maxPerModuleDay: 4,
  /** wie viele vergangene Wochen man noch abholen kann */
  claimWeeks: 8,
} as const;

export const studyGoalHours = (m: ModuleId) => (STUDY.goalBlocks[m] * STUDY.blockMinutes) / 60;

export type StudyReward = {
  blockCoins: number;
  goalCoins: number;
  allBonus: number;
  extraCoins: number;
  total: number;
  goalsReached: number;
};

/** Belohnung einer Woche aus den Blöcken je Fach */
export function studyReward(blocks: Partial<Record<ModuleId, number>>): StudyReward {
  let blockCoins = 0;
  let goalCoins = 0;
  let extraCoins = 0;
  let goalsReached = 0;
  for (const m of MODULES) {
    const n = Math.max(0, blocks[m] ?? 0);
    const goal = STUDY.goalBlocks[m];
    blockCoins += Math.min(n, goal) * STUDY.coinsPerBlock;
    extraCoins += Math.min(Math.max(n - goal, 0), STUDY.extraMax) * STUDY.coinsPerExtraBlock;
    if (n >= goal) {
      goalCoins += STUDY.goalBonus;
      goalsReached++;
    }
  }
  const allBonus = goalsReached === MODULES.length ? STUDY.allGoalsBonus : 0;
  return { blockCoins, goalCoins, allBonus, extraCoins, total: blockCoins + goalCoins + allBonus + extraCoins, goalsReached };
}

export type StudyModuleState = { module: ModuleId; goalBlocks: number; goalHours: number; blocks: number; today: number };
export type StudyWeek = { week: string; blocks: Record<ModuleId, number>; reward: StudyReward };
/** GET /api/study */
export type StudyResponse = {
  /** Montag der aktuellen Woche (YYYY-MM-DD) */
  week: string;
  /** Sonntag der aktuellen Woche */
  weekEnd: string;
  modules: StudyModuleState[];
  /** voraussichtliche Belohnung dieser Woche */
  reward: StudyReward;
  /** abgeschlossene, noch nicht abgeholte Wochen (neueste zuerst) */
  pending: StudyWeek[];
  /** abgeholte Coins insgesamt */
  claimedTotal: number;
};

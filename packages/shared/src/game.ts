/** Spielregeln & Katalog. Server und Client nutzen dieselben Konstanten; berechnet wird nur auf dem Server. */

export const ECONOMY = {
  xpPerLevel: 10,
  xpPerCorrect: 2,
  xpPerfectBonus: 5,
  xpBossBonus: 15,
  replayFactor: 0.5,
  coinsPerLevel: 5,
  coinsPerfectBonus: 5,
  coinsBossFirstClear: 15,
  practiceXpPerCorrect: 1,
  practiceXpBonus: 5,
  practiceCoins: 3,
  dailyGoalCoins: 5,
  dailyGoalOptions: [20, 30, 50, 80] as const,
  defaultDailyGoal: 30,
  maxStreakFreezes: 2,
  /** Sterne aus Erstversuch-Genauigkeit */
  stars(accuracy: number): 1 | 2 | 3 {
    if (accuracy >= 0.95) return 3;
    if (accuracy >= 0.75) return 2;
    return 1;
  },
} as const;

/** Leitner-Boxen: Abstand in Tagen bis zur nächsten Wiederholung. Box > 5 = gemeistert. */
export const LEITNER_INTERVALS = [0, 1, 2, 4, 7, 14] as const;
export const LEITNER_MAX_BOX = 5;

export const PET_STAGE_XP = [0, 300, 1000] as const;
export function petStage(xp: number): 1 | 2 | 3 {
  if (xp >= PET_STAGE_XP[2]) return 3;
  if (xp >= PET_STAGE_XP[1]) return 2;
  return 1;
}

export type PetDef = { id: string; name: string; stageNames: [string, string, string]; price: number; color: string; blurb: string };
export const PETS: PetDef[] = [
  { id: 'bit', name: 'Bit', stageNames: ['Bit', 'Byte', 'Megabyte'], price: 0, color: '#38bdf8', blurb: 'Ein neugieriger Elektro-Fuchs.' },
  { id: 'pixel', name: 'Pixel', stageNames: ['Pixel', 'Sprite', 'Shader'], price: 0, color: '#f472b6', blurb: 'Eine bunte Glitzer-Katze.' },
  { id: 'knoten', name: 'Knoten', stageNames: ['Knötchen', 'Knoten', 'Graphzilla'], price: 0, color: '#a3e635', blurb: 'Ein Moos-Drache, der Graphen liebt.' },
  { id: 'lambda', name: 'Lambda', stageNames: ['Lambdi', 'Lambda', 'Y-Kombinator'], price: 120, color: '#c084fc', blurb: 'Ein funktionales Chamäleon.' },
  { id: 'register', name: 'Register', stageNames: ['Reggi', 'Register', 'Cache-Koloss'], price: 150, color: '#fb923c', blurb: 'Ein Panzer-Gürteltier aus Silizium.' },
  { id: 'menge', name: 'Menge', stageNames: ['Mengchen', 'Menge', 'Potenzmenge'], price: 180, color: '#facc15', blurb: 'Eine Qualle, die alles enthält.' },
  { id: 'stack', name: 'Stack', stageNames: ['Stäckchen', 'Stack', 'Heap-Hüter'], price: 220, color: '#4ade80', blurb: 'Ein stapelnder Schildkröten-Turm.' },
  { id: 'quanti', name: 'Quanti', stageNames: ['Quanti', 'Qubit', 'Superposition'], price: 300, color: '#22d3ee', blurb: 'Ein schwebender Quanten-Geist.' },
];
export const STARTER_PETS = PETS.filter((p) => p.price === 0).map((p) => p.id);

export type ShopCategory = 'pet' | 'accessory' | 'powerup' | 'theme' | 'frame';
export type ShopItem = { id: string; category: ShopCategory; name: string; price: number; description: string; color?: string };
export const SHOP_ITEMS: ShopItem[] = [
  ...PETS.filter((p) => p.price > 0).map((p): ShopItem => ({ id: `pet:${p.id}`, category: 'pet', name: p.name, price: p.price, description: p.blurb, color: p.color })),
  { id: 'powerup:streak_freeze', category: 'powerup', name: 'Streak-Freeze', price: 50, description: 'Rettet deinen Streak, wenn du einen Tag verpasst. Max. 2.' },
  { id: 'acc:party_hat', category: 'accessory', name: 'Partyhut', price: 40, description: 'Für jede bestandene Klausur.' },
  { id: 'acc:grad_cap', category: 'accessory', name: 'Doktorhut', price: 90, description: 'Sieht klüger aus, als es ist.' },
  { id: 'acc:glasses', category: 'accessory', name: 'Nerd-Brille', price: 60, description: 'Plus 10 auf Konzentration.' },
  { id: 'acc:headphones', category: 'accessory', name: 'Kopfhörer', price: 70, description: 'Lo-fi beats to study to.' },
  { id: 'acc:crown', category: 'accessory', name: 'Krone', price: 250, description: 'Nur für Liga-Könige.' },
  { id: 'acc:scarf', category: 'accessory', name: 'TUM-Schal', price: 50, description: 'Warm durch den Garchinger Winter.' },
  { id: 'theme:ocean', category: 'theme', name: 'Ozean', price: 80, description: 'Kühles Blau.', color: '#0ea5e9' },
  { id: 'theme:sunset', category: 'theme', name: 'Sonnenuntergang', price: 80, description: 'Warmes Orange.', color: '#f97316' },
  { id: 'theme:forest', category: 'theme', name: 'Wald', price: 80, description: 'Ruhiges Grün.', color: '#16a34a' },
  { id: 'theme:candy', category: 'theme', name: 'Zuckerwatte', price: 120, description: 'Pink & verspielt.', color: '#ec4899' },
  { id: 'frame:gold', category: 'frame', name: 'Goldrahmen', price: 100, description: 'Glänzt im Leaderboard.', color: '#f5b301' },
  { id: 'frame:rainbow', category: 'frame', name: 'Regenbogen', price: 160, description: 'Alle Farben auf einmal.', color: '#a855f7' },
  { id: 'frame:circuit', category: 'frame', name: 'Platine', price: 140, description: 'Für echte ERA-Fans.', color: '#22c55e' },
];
export const THEMES: Record<string, { name: string; primary: string; primaryDark: string }> = {
  default: { name: 'LernQuest', primary: '#7c5cff', primaryDark: '#5b3fd6' },
  ocean: { name: 'Ozean', primary: '#0ea5e9', primaryDark: '#0369a1' },
  sunset: { name: 'Sonnenuntergang', primary: '#f97316', primaryDark: '#c2410c' },
  forest: { name: 'Wald', primary: '#16a34a', primaryDark: '#15803d' },
  candy: { name: 'Zuckerwatte', primary: '#ec4899', primaryDark: '#be185d' },
};

export const LEAGUES = ['Bronze', 'Silber', 'Gold', 'Saphir', 'Rubin', 'Diamant'] as const;
/** Wie viele Plätze steigen auf / ab (bei kleinen Gruppen proportional begrenzt). */
export function leagueZones(n: number): { promote: number; demote: number } {
  if (n < 3) return { promote: n > 1 ? 1 : 0, demote: 0 };
  const z = Math.max(1, Math.min(3, Math.floor(n / 4)));
  return { promote: z, demote: z };
}

export type AchievementDef = { id: string; name: string; description: string; icon: string };
export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_level', name: 'Erster Schritt', description: 'Schließe dein erstes Level ab.', icon: 'badge-first' },
  { id: 'perfect', name: 'Fehlerfrei', description: 'Schließe ein Level mit 100 % ab.', icon: 'badge-perfect' },
  { id: 'boss', name: 'Bossbezwinger', description: 'Besiege einen Boss.', icon: 'badge-boss' },
  { id: 'streak_3', name: 'Warmgelaufen', description: '3 Tage Streak.', icon: 'badge-streak' },
  { id: 'streak_7', name: 'Wochenkrieger', description: '7 Tage Streak.', icon: 'badge-streak' },
  { id: 'streak_30', name: 'Unaufhaltsam', description: '30 Tage Streak.', icon: 'badge-streak' },
  { id: 'xp_500', name: 'Fleißig', description: '500 XP gesammelt.', icon: 'badge-xp' },
  { id: 'xp_2500', name: 'Streber', description: '2500 XP gesammelt.', icon: 'badge-xp' },
  { id: 'practice_10', name: 'Aus Fehlern lernen', description: '10 Fehler-Übungen abgeschlossen.', icon: 'badge-practice' },
  { id: 'evolve', name: 'Evolution', description: 'Lass ein Pet sich entwickeln.', icon: 'badge-evolve' },
  { id: 'collector', name: 'Sammler', description: 'Besitze 4 Pets.', icon: 'badge-collector' },
  { id: 'module_done', name: 'Modul gemeistert', description: 'Schließe alle Units eines Moduls ab.', icon: 'badge-module' },
  { id: 'exam_pass', name: 'Klausurreif', description: 'Bestehe einen Klausur-Check.', icon: 'badge-boss' },
  { id: 'duel_win', name: 'Duellant', description: 'Gewinne ein Duell.', icon: 'badge-collector' },
];

// ---------- Klausur-Check, Schwächen, Duelle ----------
export const EXAM = {
  questions: 20,
  secondsPerQuestion: 45,
  xpPerCorrect: 1,
  passAt: 0.5,
  passBonusXp: 15,
  passCoins: 10,
  /** nur die ersten N Klausur-Checks pro Tag geben XP/Coins */
  rewardedPerDay: 2,
} as const;
export const WEAK = { questions: 10, rewardedPerDay: 3, minAnswers: 2 } as const;
export const DUEL = { questions: 10, expiresHours: 48, xpBase: 5, xpPerCorrect: 2, winCoins: 15, maxOpen: 5, rewardedPerDay: 3 } as const;

/** Note nach TUM-Notenstufen (bestanden ab 50 %). */
export function examGrade(accuracy: number): number {
  const steps: [number, number][] = [
    [0.95, 1.0], [0.9, 1.3], [0.85, 1.7], [0.8, 2.0], [0.75, 2.3], [0.7, 2.7],
    [0.65, 3.0], [0.6, 3.3], [0.55, 3.7], [0.5, 4.0],
  ];
  return steps.find(([min]) => accuracy >= min - 1e-9)?.[1] ?? 5.0;
}

/** Kenngrößen, aus denen Tagesaufgaben gezählt werden (alles heute, Europe/Berlin). */
export type QuestMetric = 'xp' | 'correct' | 'levels' | 'estimate' | 'review' | 'praxis' | 'exam' | 'duel';
export type QuestDef = { id: string; metric: QuestMetric; target: number; coins: number; title: string; icon: string };
export const QUESTS: QuestDef[] = [
  { id: 'xp', metric: 'xp', target: 40, coins: 10, title: 'Sammle 40 XP', icon: 'item-xp' },
  { id: 'correct', metric: 'correct', target: 15, coins: 10, title: 'Beantworte 15 Fragen richtig', icon: 'badge-first' },
  { id: 'levels', metric: 'levels', target: 2, coins: 10, title: 'Schließe 2 Level ab', icon: 'badge-perfect' },
  { id: 'estimate', metric: 'estimate', target: 2, coins: 15, title: 'Triff 2 Schätzfragen', icon: 'item-chest' },
  { id: 'review', metric: 'review', target: 1, coins: 10, title: 'Mach eine Wiederholungsrunde', icon: 'badge-practice' },
  { id: 'praxis', metric: 'praxis', target: 5, coins: 10, title: 'Beantworte 5 Praxis-Fragen', icon: 'item-chest' },
  { id: 'exam', metric: 'exam', target: 1, coins: 20, title: 'Mach einen Klausur-Check', icon: 'badge-boss' },
  { id: 'duel', metric: 'duel', target: 1, coins: 15, title: 'Spiel ein Duell', icon: 'badge-collector' },
];
/** Drei Aufgaben pro Tag: immer XP, dazu zwei weitere – deterministisch je Nutzer und Tag. */
export function pickQuests(userId: number, day: string): QuestDef[] {
  let h = 2166136261;
  for (const ch of `${userId}:${day}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rest = QUESTS.slice(1);
  const a = rest[h % rest.length]!;
  const others = rest.filter((q) => q !== a);
  const b = others[(h >>> 8) % others.length]!;
  return [QUESTS[0]!, a, b];
}

/** Karteikarten (Wissenssammlung) */
export const CARDS = { perSession: 20, newPerSession: 10, masteredDays: 30 } as const;
/** Wochenrückblick per Push: Sonntag ab dieser Stunde (Europe/Berlin) */
export const RECAP = { weekday: 0, hour: 18 } as const;

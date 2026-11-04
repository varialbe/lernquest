import { z } from 'zod';
import { ModuleId, type LevelKind, type Question, type QuestionType } from './quiz.ts';

// ---------- Requests ----------
export const Username = z
  .string()
  .trim()
  .min(3)
  .max(24)
  .regex(/^[a-zA-Z0-9_.-]+$/, 'Nur Buchstaben, Zahlen, _ . -');
export const Password = z.string().min(8, 'Mindestens 8 Zeichen').max(200);

/** leeres Feld = nicht angegeben */
const optionalText = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);
export const Email = z.string().trim().toLowerCase().email('Bitte eine gültige E-Mail-Adresse angeben').max(120);
export const RegisterReq = z.object({
  /** optional: nur damit der Admin sieht, über wen jemand gekommen ist */
  inviteCode: optionalText(64),
  email: Email,
  newsletter: z.boolean().optional(),
  acceptPrivacy: z.boolean().refine((v) => v, 'Bitte bestätige die Datenschutzerklärung.'),
  username: Username,
  displayName: z.string().trim().min(1).max(40),
  password: Password,
  starterPet: z.string().optional(),
});
/** `username` = Benutzername oder E-Mail-Adresse */
export const LoginReq = z.object({ username: z.string().trim().min(1).max(120), password: z.string().min(1).max(200) });
export const ForgotReq = z.object({ identifier: z.string().trim().min(1).max(120) });
export const ResetReq = z.object({ token: z.string().min(20).max(200), password: Password });
/** Konto nach Google-Anmeldung anlegen */
export const GoogleCompleteReq = z.object({
  pendingId: z.string().min(10).max(100),
  username: Username,
  displayName: z.string().trim().min(1).max(40),
  inviteCode: optionalText(64),
  newsletter: z.boolean().optional(),
  acceptPrivacy: z.boolean().refine((v) => v, 'Bitte bestätige die Datenschutzerklärung.'),
  starterPet: z.string().optional(),
});
export const ChangePasswordReq = z.object({ oldPassword: z.string().max(200), newPassword: Password });

export const AnswerSubmission = z.object({
  questionId: z.string(),
  /** Auswahl beim ERSTEN Versuch – zählt für Wertung */
  selected: z.array(z.string()).max(6),
});
export const CompleteLevelReq = z.object({
  answers: z.array(AnswerSubmission).min(1).max(40),
  durationSec: z.number().int().min(0).max(24 * 3600).optional(),
});
export const PracticeSubmitReq = z.object({ answers: z.array(AnswerSubmission).min(1).max(30) });
export const ReportReq = z.object({
  questionId: z.string(),
  reason: z.enum(['wrong_answer', 'unclear', 'typo', 'other']),
  comment: z.string().max(1000).optional(),
});
export const SettingsReq = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
  dailyGoal: z.number().int().min(10).max(200).optional(),
  theme: z.string().max(40).optional(),
  frame: z.string().max(40).nullable().optional(),
  activePet: z.string().max(40).optional(),
  soundOn: z.boolean().optional(),
  weeklyRecap: z.boolean().optional(),
  locale: z.enum(['de', 'en']).nullable().optional(),
  newsletter: z.boolean().optional(),
  email: Email.optional(),
});
export const EquipReq = z.object({ petId: z.string(), accessory: z.string().nullable() });
export const RunSubmitReq = z.object({
  answers: z.array(AnswerSubmission).max(40),
  durationSec: z.number().int().min(0).max(24 * 3600).optional(),
});
export const StartWeakReq = z.object({ module: ModuleId.optional() });
export const StartExamReq = z.object({ module: ModuleId });
export const CreateDuelReq = z.object({ opponent: Username, module: ModuleId });

// ---------- Responses ----------
export type PublicUser = {
  id: number;
  username: string;
  displayName: string;
  role: 'user' | 'admin';
  mustChangePassword: boolean;
};

export type PetState = { petId: string; xp: number; stage: 1 | 2 | 3; accessory: string | null };

export type MeResponse = {
  user: PublicUser;
  stats: {
    xp: number;
    coins: number;
    streak: number;
    longestStreak: number;
    streakFreezes: number;
    streakActiveToday: boolean;
    todayXp: number;
    dailyGoal: number;
    league: string;
    weekXp: number;
    dueReviews: number;
  };
  settings: {
    theme: string;
    frame: string | null;
    soundOn: boolean;
    weeklyRecap: boolean;
    /** User override; null follows the device language. */
    locale: 'de' | 'en' | null;
    activePet: string | null;
    newsletter: 'none' | 'pending' | 'confirmed';
    email: string | null;
    emailVerified: boolean;
    google: boolean;
    hasPassword: boolean;
  };
  pets: PetState[];
  inventory: string[];
};

export type LevelStatus = 'locked' | 'open' | 'done' | 'gold';
export type LevelNode = {
  id: string;
  index: number;
  kind: LevelKind;
  title: string;
  questionCount: number;
  status: LevelStatus;
  stars: number;
  bestAccuracy: number | null;
};
export type UnitNode = {
  id: string;
  module: ModuleId;
  number: number;
  title: string;
  summary: string;
  concepts: string[];
  isNew: boolean;
  levels: LevelNode[];
};
export type ModuleNode = { id: ModuleId; name: string; color: string; units: UnitNode[]; progress: number };
export type PathResponse = { modules: ModuleNode[] };
export type DiscoverItem = LevelNode & { unitId: string; unitNumber: number; unitTitle: string; isNew: boolean };
export type DiscoverResponse = { modules: { id: ModuleId; name: string; color: string; items: DiscoverItem[] }[] };

export type ClientQuestion = Omit<Question, 'source'> & { source: Question['source'] };
export type LevelResponse = {
  level: { id: string; index: number; kind: LevelKind; title: string; unitId: string; unitTitle: string; module: ModuleId };
  questions: ClientQuestion[];
};

export type RewardResponse = {
  correctFirstTry: number;
  total: number;
  accuracy: number;
  stars: number;
  xp: number;
  coins: number;
  streak: number;
  streakIncreased: boolean;
  dailyGoalReached: boolean;
  pet: (PetState & { evolved: boolean }) | null;
  newAchievements: string[];
  unlocked: string[];
};

export type LeaderboardEntry = {
  rank: number;
  userId: number;
  displayName: string;
  username: string;
  value: number;
  frame: string | null;
  pet: string | null;
  petStage: number;
  me: boolean;
  zone?: 'promote' | 'demote' | null;
};
export type LeaderboardResponse = {
  kind: string;
  title: string;
  league?: string;
  resetsAt?: string;
  entries: LeaderboardEntry[];
};

export type ProfileResponse = {
  user: PublicUser;
  joinedAt: string;
  stats: MeResponse['stats'] & { levelsDone: number; perfectLevels: number; questionsAnswered: number; accuracy: number };
  calendar: { day: string; xp: number }[];
  achievements: { id: string; unlocked: boolean }[];
  moduleProgress: { module: ModuleId; done: number; total: number }[];
};

// ---------- Schwächen, Klausur-Check, Duelle, Tagesaufgaben ----------
export type RunKind = 'weak' | 'exam' | 'duel';
export type RunStart = {
  runId: string;
  kind: RunKind;
  title: string;
  module: ModuleId | null;
  questions: ClientQuestion[];
  /** nur Klausur-Check */
  timeLimitSec: number | null;
  duelId: string | null;
};
export type RunResult = RewardResponse & {
  kind: RunKind;
  /** false, wenn das Tageskontingent für XP/Coins dieser Art schon verbraucht war */
  rewarded: boolean;
  review: { questionId: string; selected: string[]; correct: boolean }[];
  /** Note (nur Klausur-Check) */
  grade: number | null;
  duel: DuelSummary | null;
};

export type MasteryLevel = 'weak' | 'ok' | 'strong' | 'new';
export type ConceptMastery = { concept: string; unitId: string; unitNumber: number; unitTitle: string; answered: number; correct: number; score: number; level: MasteryLevel };
export type MasteryResponse = { modules: { id: ModuleId; name: string; color: string; concepts: ConceptMastery[]; untouched: number }[] };

export type QuestState = { id: string; title: string; icon: string; target: number; progress: number; coins: number; done: boolean; claimed: boolean };
export type QuestsResponse = { day: string; quests: QuestState[] };

export type DuelPlayer = { username: string; displayName: string; pet: string | null; petStage: number; frame: string | null };
export type DuelSummary = {
  id: string;
  module: ModuleId;
  status: 'open' | 'done' | 'declined' | 'expired';
  createdAt: string;
  expiresAt: string;
  questionCount: number;
  challengedByMe: boolean;
  opponent: DuelPlayer;
  me: { played: boolean; correct: number | null; durationSec: number | null };
  /** Gegner-Ergebnis erst sichtbar, wenn ich selbst gespielt habe (oder das Duell vorbei ist) */
  them: { played: boolean; correct: number | null; durationSec: number | null };
  winner: 'me' | 'them' | 'draw' | null;
};
export type DuelsResponse = { duels: DuelSummary[]; opponents: DuelPlayer[] };

/** /app-updates/latest.json – Live-Update-Paket der iOS-App */
export type AppUpdateManifest = { version: string; url: string; checksum: string; builtAt: string };

export type AdminQuestionRef ={ id: string; prompt: string; type: QuestionType; levelId: string; active: boolean };

import { z } from 'zod';
import type { LevelKind, ModuleId, Question, QuestionType } from './quiz.ts';

// ---------- Requests ----------
export const Username = z
  .string()
  .trim()
  .min(3)
  .max(24)
  .regex(/^[a-zA-Z0-9_.-]+$/, 'Nur Buchstaben, Zahlen, _ . -');
export const Password = z.string().min(8, 'Mindestens 8 Zeichen').max(200);

export const RegisterReq = z.object({
  inviteCode: z.string().trim().min(4).max(64),
  username: Username,
  displayName: z.string().trim().min(1).max(40),
  password: Password,
  starterPet: z.string().optional(),
});
export const LoginReq = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(200) });
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
});
export const EquipReq = z.object({ petId: z.string(), accessory: z.string().nullable() });

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
  settings: { theme: string; frame: string | null; soundOn: boolean; activePet: string | null };
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

export type AdminQuestionRef = { id: string; prompt: string; type: QuestionType; levelId: string; active: boolean };

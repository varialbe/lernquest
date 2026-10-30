import { z } from 'zod';

/** Module, deren Vorlesungen verarbeitet werden. */
export const MODULES = ['DS', 'EIP', 'ERA'] as const;
export const ModuleId = z.enum(MODULES);
export type ModuleId = z.infer<typeof ModuleId>;

export const MODULE_INFO: Record<ModuleId, { name: string; short: string; color: string }> = {
  DS: { name: 'Diskrete Strukturen', short: 'DS', color: '#7c5cff' },
  EIP: { name: 'Einführung in die Informatik und Programmierung', short: 'EIP', color: '#14b8a6' },
  ERA: { name: 'Einführung in die Rechnerarchitektur', short: 'ERA', color: '#f97316' },
};

export const QUESTION_TYPES = ['single', 'multi', 'truefalse', 'cloze', 'code_output', 'calc'] as const;
export const QuestionType = z.enum(QUESTION_TYPES);
export type QuestionType = z.infer<typeof QuestionType>;

export const LEVEL_KINDS = ['basics', 'apply', 'deepen', 'boss'] as const;
export const LevelKind = z.enum(LEVEL_KINDS);
export type LevelKind = z.infer<typeof LevelKind>;
export const LEVEL_TITLES: Record<LevelKind, string> = {
  basics: 'Grundlagen',
  apply: 'Anwenden',
  deepen: 'Vertiefen',
  boss: 'Boss',
};

export const Option = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,16}$/),
  text: z.string().min(1).max(600),
});

export const Source = z.object({
  file: z.string().min(1),
  /** Seite (PDF/PPTX), null bei Markdown */
  page: z.number().int().positive().nullable(),
  /** Abschnitt / Überschrift, v. a. bei Markdown */
  section: z.string().max(200).nullable().optional(),
});

/** Eine Frage, wie sie im content/-JSON liegt. */
export const Question = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    type: QuestionType,
    /** Markdown, LaTeX in $…$, Code in ```-Fences. Bei cloze markiert ___ die Lücke. */
    prompt: z.string().min(5).max(4000),
    options: z.array(Option).min(2).max(6),
    correct: z.array(z.string()).min(1),
    explanation: z.string().min(5).max(1500),
    source: Source,
    difficulty: z.number().int().min(1).max(5),
    concepts: z.array(z.string().min(1).max(80)).min(1).max(6),
  })
  .superRefine((q, ctx) => {
    const ids = q.options.map((o) => o.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Doppelte Options-IDs' });
    const texts = q.options.map((o) => o.text.trim().toLowerCase());
    if (new Set(texts).size !== texts.length) ctx.addIssue({ code: 'custom', message: 'Doppelte Antworttexte' });
    for (const c of q.correct) {
      if (!ids.includes(c)) ctx.addIssue({ code: 'custom', message: `correct verweist auf unbekannte Option ${c}` });
    }
    if (new Set(q.correct).size !== q.correct.length) ctx.addIssue({ code: 'custom', message: 'Doppelte correct-Einträge' });
    if (q.type !== 'multi' && q.correct.length !== 1) {
      ctx.addIssue({ code: 'custom', message: `${q.type} braucht genau eine richtige Antwort` });
    }
    if (q.type === 'multi' && q.correct.length === q.options.length) {
      ctx.addIssue({ code: 'custom', message: 'multi: nicht alle Optionen dürfen richtig sein' });
    }
    if (q.type === 'truefalse') {
      if (q.options.length !== 2 || !ids.includes('true') || !ids.includes('false')) {
        ctx.addIssue({ code: 'custom', message: 'truefalse braucht genau die Optionen true/false' });
      }
    } else if (q.options.length < 3) {
      ctx.addIssue({ code: 'custom', message: `${q.type} braucht mindestens 3 Optionen` });
    }
    if (q.type === 'cloze' && !q.prompt.includes('___')) {
      ctx.addIssue({ code: 'custom', message: 'cloze-Prompt braucht eine Lücke ___' });
    }
  });
export type Question = z.infer<typeof Question>;

export const Level = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  index: z.number().int().min(1).max(4),
  kind: LevelKind,
  title: z.string().min(1).max(80),
  questions: z.array(Question).min(8).max(12),
});
export type Level = z.infer<typeof Level>;

export const Unit = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z]+-\d{2}$/),
    module: ModuleId,
    number: z.number().int().positive(),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    title: z.string().min(2).max(120),
    summary: z.string().min(10).max(1500),
    concepts: z.array(z.string()).min(1).max(30),
    /** Kernaussagen – werden späteren Units als Kontext mitgegeben (Wiederholungsfragen). */
    keyFacts: z.array(z.string()).max(30),
    source: z.object({ file: z.string(), sha256: z.string().length(64), commit: z.string() }),
    generator: z.object({
      model: z.string(),
      effort: z.string(),
      reviewEffort: z.string(),
      promptVersion: z.string(),
      generatedAt: z.string(),
      review: z.object({ checked: z.number().int(), fixed: z.number().int(), removed: z.number().int(), notes: z.string() }),
    }),
    levels: z.array(Level).length(4),
  })
  .superRefine((u, ctx) => {
    u.levels.forEach((l, i) => {
      if (l.index !== i + 1 || l.kind !== LEVEL_KINDS[i]) ctx.addIssue({ code: 'custom', message: `Level ${i + 1} falsch sortiert` });
    });
    const qids = u.levels.flatMap((l) => l.questions.map((q) => q.id));
    if (new Set(qids).size !== qids.length) ctx.addIssue({ code: 'custom', message: 'Doppelte Fragen-IDs' });
  });
export type Unit = z.infer<typeof Unit>;

export const unitId = (module: ModuleId, number: number) => `${module.toLowerCase()}-${String(number).padStart(2, '0')}`;

/** Prüft eine Antwortauswahl gegen die korrekten Options-IDs (Mengenvergleich). */
export function isCorrect(correct: readonly string[], selected: readonly string[]): boolean {
  if (correct.length !== selected.length) return false;
  const s = new Set(selected);
  return correct.every((c) => s.has(c));
}

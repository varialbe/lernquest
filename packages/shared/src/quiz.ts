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

export const QUESTION_TYPES = ['single', 'multi', 'truefalse', 'cloze', 'code_output', 'calc', 'diagram', 'estimate'] as const;
export const QuestionType = z.enum(QUESTION_TYPES);
export type QuestionType = z.infer<typeof QuestionType>;

/** Die vier Level des Lernpfads (sequentiell). */
export const LEVEL_KINDS = ['basics', 'apply', 'deepen', 'boss'] as const;
/** Optionales 5. Level „Praxis“: Transfer in die echte Welt + Schätzfragen, eigener Bereich in der App. */
export const BONUS_KIND = 'bonus' as const;
export const LevelKind = z.enum([...LEVEL_KINDS, BONUS_KIND]);
export type LevelKind = z.infer<typeof LevelKind>;
export const LEVEL_TITLES: Record<LevelKind, string> = {
  basics: 'Grundlagen',
  apply: 'Anwenden',
  deepen: 'Vertiefen',
  boss: 'Boss',
  bonus: 'Praxis',
};

export const Option = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,16}$/),
  text: z.string().min(1).max(600),
});

/** Quelle einer Frage: Obsidian-Notiz + Überschrift (Abschnitt), in der App als Abschnitts-Link angezeigt. */
export const Source = z.object({
  file: z.string().min(1),
  heading: z.string().max(200).nullable(),
});
export type Source = z.infer<typeof Source>;

/** Schieberegler für Schätz-/Zahlenfragen (type `estimate`). Richtig, wenn |Wert − answer| ≤ tolerance. */
export const Slider = z
  .object({
    min: z.number(),
    max: z.number(),
    step: z.number().positive(),
    answer: z.number(),
    tolerance: z.number().min(0),
    unit: z.string().max(24).nullable(),
    scale: z.enum(['linear', 'log']),
  })
  .superRefine((s, ctx) => {
    if (!(s.min < s.max)) ctx.addIssue({ code: 'custom', message: 'slider: min < max' });
    if (s.answer < s.min || s.answer > s.max) ctx.addIssue({ code: 'custom', message: 'slider: answer außerhalb [min, max]' });
    if (s.tolerance > (s.max - s.min) / 3) ctx.addIssue({ code: 'custom', message: 'slider: Toleranz zu groß (Raten wäre zu leicht)' });
    if (s.scale === 'linear') {
      if ((s.max - s.min) / s.step > 400) ctx.addIssue({ code: 'custom', message: 'slider: zu viele Schritte für einen linearen Regler' });
      const k = (s.answer - s.min) / s.step;
      if (s.tolerance < s.step / 2 && Math.abs(k - Math.round(k)) > 1e-9) ctx.addIssue({ code: 'custom', message: 'slider: answer mit diesem step nicht erreichbar' });
    } else {
      if (s.min <= 0) ctx.addIssue({ code: 'custom', message: 'slider: log-Skala braucht min > 0' });
      if (s.tolerance < s.answer * 0.05) ctx.addIssue({ code: 'custom', message: 'slider: log-Skala braucht Toleranz ≥ 5 % der Antwort' });
    }
  });
export type Slider = z.infer<typeof Slider>;

/** Eine Frage, wie sie im content/-JSON liegt. */
export const Question = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    type: QuestionType,
    /** Markdown, LaTeX in $…$, Code in ```-Fences. Bei cloze markiert ___ die Lücke, bei diagram steht ein ```mermaid-Block im Prompt. */
    prompt: z.string().min(5).max(4000),
    /** leer bei `estimate` */
    options: z.array(Option).max(6),
    correct: z.array(z.string()),
    /** nur bei `estimate` */
    slider: Slider.optional(),
    explanation: z.string().min(5).max(1500),
    source: Source,
    difficulty: z.number().int().min(1).max(5),
    concepts: z.array(z.string().min(1).max(80)).min(1).max(6),
  })
  .superRefine((q, ctx) => {
    if (q.type === 'estimate') {
      if (!q.slider) ctx.addIssue({ code: 'custom', message: 'estimate braucht einen slider' });
      if (q.options.length || q.correct.length) ctx.addIssue({ code: 'custom', message: 'estimate hat keine Optionen' });
      return;
    }
    if (q.slider) ctx.addIssue({ code: 'custom', message: 'slider nur bei estimate' });
    if (q.options.length < 2) ctx.addIssue({ code: 'custom', message: 'mindestens 2 Optionen' });
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
    if (q.type === 'diagram' && !/```mermaid\s*\n[\s\S]+?```/.test(q.prompt)) {
      ctx.addIssue({ code: 'custom', message: 'diagram-Prompt braucht einen ```mermaid-Block' });
    }
    if (q.type === 'cloze' && !q.prompt.includes('___')) {
      ctx.addIssue({ code: 'custom', message: 'cloze-Prompt braucht eine Lücke ___' });
    }
  });
export type Question = z.infer<typeof Question>;

export const Level = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  index: z.number().int().min(1).max(5),
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
    /** Tags aus dem Obsidian-Frontmatter */
    tags: z.array(z.string()).max(30),
    /** per [[Wikilink]] verlinkte Notizen (Repo-Pfade) – Kanten im Konzeptgraph */
    links: z.array(z.string()).max(50),
    source: z.object({ file: z.string(), sha256: z.string().length(64), commit: z.string() }),
    generator: z.object({
      model: z.string(),
      effort: z.string(),
      reviewEffort: z.string(),
      promptVersion: z.string(),
      generatedAt: z.string(),
      review: z.object({ checked: z.number().int(), fixed: z.number().int(), removed: z.number().int(), notes: z.string() }),
    }),
    /** 4 Pfad-Level + optional das Praxis-Level als 5. */
    levels: z.array(Level).min(4).max(5),
  })
  .superRefine((u, ctx) => {
    u.levels.forEach((l, i) => {
      const kind = i < 4 ? LEVEL_KINDS[i] : BONUS_KIND;
      if (l.index !== i + 1 || l.kind !== kind) ctx.addIssue({ code: 'custom', message: `Level ${i + 1} falsch sortiert` });
    });
    const qids = u.levels.flatMap((l) => l.questions.map((q) => q.id));
    if (new Set(qids).size !== qids.length) ctx.addIssue({ code: 'custom', message: 'Doppelte Fragen-IDs' });
  });
export type Unit = z.infer<typeof Unit>;

/** Abschnitts-Anker wie GitHub/Obsidian ihn aus einer Überschrift bilden. */
export function headingAnchor(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

export const unitId = (module: ModuleId, number: number) => `${module.toLowerCase()}-${String(number).padStart(2, '0')}`;

/**
 * Wertet eine Antwort aus. Bei `estimate` ist `selected` = [Zahl als String].
 * Server und Client nutzen dieselbe Funktion; gewertet wird nur auf dem Server.
 */
export function checkAnswer(q: Pick<Question, 'type' | 'correct' | 'slider'>, selected: readonly string[]): boolean {
  if (q.type === 'estimate') {
    const v = Number(selected[0]);
    return !!q.slider && selected.length === 1 && Number.isFinite(v) && Math.abs(v - q.slider.answer) <= q.slider.tolerance + 1e-9;
  }
  return isCorrect(q.correct, selected);
}

/** Prüft eine Antwortauswahl gegen die korrekten Options-IDs (Mengenvergleich). */
export function isCorrect(correct: readonly string[], selected: readonly string[]): boolean {
  if (correct.length !== selected.length) return false;
  const s = new Set(selected);
  return correct.every((c) => s.has(c));
}

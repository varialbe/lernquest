import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEVEL_KINDS, LEVEL_TITLES, MODULE_INFO, Question, Unit, unitId, type ModuleId } from '@lernquest/shared';
import { codexJson } from './codex.ts';
import { config } from './config.ts';
import type { Heading } from './obsidian.ts';
import type { Prepared } from './prepare.ts';

export type PreviousUnit = { number: number; title: string; concepts: string[]; keyFacts: string[]; sourceFile: string; linked: boolean };

export type GenerateInput = {
  module: ModuleId;
  number: number;
  file: string;
  sha256: string;
  commit: string;
  prepared: Prepared;
  previous: PreviousUnit[];
  workDir: string;
  log: (msg: string) => void;
};

export type GenerateResult = { unit: Unit; dropped: string[]; tokens: number; raws: Map<string, RawQuestion> };

export const fill = (tpl: string, vars: Record<string, string>) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`);
const strip = (name: string) => readFileSync(join(config.promptsDir, name), 'utf8').replace(/^<!--[\s\S]*?-->\s*/, '');
/** Prompt-Vorlage laden; {{SELF_CONTAINED}} wird durch die gemeinsamen Regeln aus _self-contained.md ersetzt. */
export const template = (name: string) => strip(name).replace('{{SELF_CONTAINED}}', () => strip('_self-contained.md').trim());

export function formatPrevious(prev: PreviousUnit[]): string {
  if (!prev.length) return '_(keine – das ist die erste Unit dieses Moduls)_';
  // verlinkte Units zuerst
  return [...prev]
    .sort((a, b) => Number(b.linked) - Number(a.linked) || a.number - b.number)
    .map((u) => `### Unit ${u.number}: ${u.title}${u.linked ? ' (verlinkt)' : ''} (\`${u.sourceFile}\`)\n- Konzepte: ${u.concepts.join(', ')}\n${u.keyFacts.map((f) => `- ${f}`).join('\n')}`)
    .join('\n\n');
}

export const formatHeadings = (h: Heading[]) => (h.length ? h.map((x) => `${'  '.repeat(x.level - 1)}- ${x.text}`).join('\n') : '_(keine Überschriften)_');
const formatLinked = (p: Prepared) =>
  p.linked.length ? p.linked.map((n) => `### ${n.title} (\`${n.path}\`)\n${FENCE}markdown\n${n.excerpt}\n${FENCE}`).join('\n\n') : '_(keine)_';
/** 4 Backticks, damit ```mermaid-Blöcke der Notiz die Umrahmung nicht beenden */
export const FENCE = '````';

/** Überschrift einer Frage auf eine echte Überschrift der Notiz abbilden (exakt, sonst case-insensitiv, sonst null). */
export function matchHeading(headings: Heading[], wanted: string | null | undefined): string | null {
  if (!wanted) return null;
  const clean = (s: string) => s.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim().toLowerCase();
  const w = clean(wanted);
  return headings.find((h) => h.text === wanted)?.text ?? headings.find((h) => clean(h.text) === w)?.text ?? headings.find((h) => clean(h.text).includes(w) || w.includes(clean(h.text)))?.text ?? null;
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'unit'
  );
}

/** deterministischer Shuffle (Seed = Frage-ID), damit richtige Antworten nicht immer an derselben Stelle stehen */
function seededShuffle<T>(arr: T[], seed: string): T[] {
  const out = [...arr];
  let h = createHash('sha256').update(seed).digest().readUInt32BE(0);
  for (let i = out.length - 1; i > 0; i--) {
    h = (Math.imul(h ^ (h >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Repariert LaTeX, dessen Backslash beim JSON-Escaping verloren ging: "\frac" → Formfeed+"rac",
 * "\times" → Tab+"imes", "\beta" → Backspace+"eta", "\neg" → Newline+"eg" (nur innerhalb von $…$).
 */
export function fixLatexEscapes(s: string): string {
  // \f, \b, \v kommen in Fragetexten nie legitim vor
  const out = s.replace(/\f/g, '\\f').replace(/\x08/g, '\\b').replace(/\v/g, '\\v');
  // Tab/CR/Newline nur innerhalb von Formeln reparieren (Code-Einrückungen bleiben unberührt)
  return out.replace(/\$\$?[^$]*\$?\$/g, (math) =>
    math
      .replace(/\t(?=[a-zA-Z])/g, '\\t')
      .replace(/\r(?=[a-zA-Z])/g, '\\r')
      .replace(/\n(?=(?:eq|eg|abla|u|i|ot|otin|mid|parallel|ewline|leq|geq|subseteq)\b)/g, '\\n'),
  );
}

type RawQuestion = {
  type: string;
  prompt: string;
  options: { id: string; text: string }[];
  correct: string[];
  explanation: string;
  source: { file: string; heading: string | null };
  difficulty: number;
  concepts: string[];
  /** nur bei estimate (Bonus-Schema) */
  slider?: { min: number; max: number; step: number; answer: number; tolerance: number; unit: string | null; scale: string } | null;
  context?: { type: string; content: string; language?: string | null; caption?: string | null; frames?: { content: string; caption: string | null }[] } | null;
  /** Python-Prüfskript (Rechen-/Algorithmus-Aufgaben), letzte Zeile „ANSWER: …“ – landet nicht im Content */
  verify?: string | null;
};
export type { RawQuestion };

/** Eine Roh-Frage normalisieren und validieren. Ergebnis: gültige Frage oder Fehlermeldung. */
export function normalizeQuestion(
  rq: RawQuestion,
  qid: string,
  ctx: { file: string; headings: Heading[]; knownFiles: string[]; fallbackConcept: string },
): { ok: true; question: Question } | { ok: false; error: string } {
  let options = (rq.options ?? []).map((o) => ({ id: o.id.trim().toLowerCase(), text: fixLatexEscapes(o.text.trim()) }));
  let correct = (rq.correct ?? []).map((c) => c.trim().toLowerCase());
  let slider: Question['slider'];
  if (rq.type === 'estimate') {
    options = [];
    correct = [];
    if (rq.slider) slider = { ...rq.slider, unit: rq.slider.unit?.trim() || null, scale: rq.slider.scale === 'log' ? 'log' : 'linear' };
  } else if (rq.type === 'truefalse') {
    const isTrue = correct[0] === 'true' || correct[0] === options.find((o) => /^wahr$/i.test(o.text))?.id;
    options = [{ id: 'true', text: 'Wahr' }, { id: 'false', text: 'Falsch' }];
    correct = [isTrue ? 'true' : 'false'];
  } else {
    // neu mischen und als a, b, c … durchnummerieren
    const shuffled = seededShuffle(options, qid);
    const map = new Map(shuffled.map((o, k) => [o.id, String.fromCharCode(97 + k)]));
    correct = correct.map((c) => map.get(c) ?? `?${c}`);
    options = shuffled.map((o, k) => ({ id: String.fromCharCode(97 + k), text: o.text }));
    correct.sort();
  }
  const sourceFile = ctx.knownFiles.includes(rq.source?.file) ? rq.source.file : ctx.file;
  // Überschriften kennen wir nur für die aktuelle Notiz; fremde Quellen behalten Codex' Angabe
  const heading = sourceFile === ctx.file ? matchHeading(ctx.headings, rq.source?.heading) : rq.source?.heading?.trim().slice(0, 200) || null;
  const concepts = (rq.concepts ?? []).map((c) => c.trim()).filter(Boolean).slice(0, 6);
  const context = normalizeContext(rq.context);
  const candidate = {
    id: qid,
    type: rq.type,
    prompt: fixLatexEscapes(rq.prompt.trim()),
    ...(context ? { context } : {}),
    options,
    correct,
    ...(slider ? { slider } : {}),
    explanation: fixLatexEscapes(rq.explanation.trim()),
    source: { file: sourceFile, heading },
    difficulty: Math.min(5, Math.max(1, Math.round(rq.difficulty || 1))),
    concepts: concepts.length ? concepts : [ctx.fallbackConcept],
  };
  const parsed = Question.safeParse(candidate);
  if (parsed.success) return { ok: true, question: parsed.data };
  return { ok: false, error: `„${candidate.prompt.slice(0, 60)}…“ – ${parsed.error.issues.map((x) => x.message).join('; ')}` };
}

/** Kontext aus der Codex-Ausgabe säubern: leere Felder weg, Fences entfernen, Mermaid ohne ```-Rahmen. */
export function normalizeContext(c: RawQuestion['context']): Question['context'] | undefined {
  if (!c?.content?.trim()) return undefined;
  const unfence = (s: string) => s.trim().replace(/^```[\w-]*\s*\n/, '').replace(/\n?```\s*$/, '').trim();
  const type = c.type === 'code' || c.type === 'table' ? c.type : 'mermaid';
  const frames = type === 'mermaid' ? (c.frames ?? []).filter((f) => f.content?.trim()).map((f) => ({ content: unfence(f.content), caption: f.caption?.trim() || null })) : [];
  return {
    type,
    content: type === 'table' ? c.content.trim() : unfence(c.content),
    ...(type === 'code' && c.language?.trim() ? { language: c.language.trim().toLowerCase() } : {}),
    ...(c.caption?.trim() ? { caption: fixLatexEscapes(c.caption.trim()) } : {}),
    ...(frames.length ? { frames } : {}),
  };
}

type RawUnit = {
  title: string;
  slug: string;
  summary: string;
  concepts: string[];
  keyFacts: string[];
  levels: { kind: string; title: string; questions: RawQuestion[] }[];
  review: { checked: number; fixed: number; removed: number; notes: string };
};

/** Rohausgabe von Codex in das kanonische Unit-Format überführen (IDs, Normalisierung, Validierung). */
export function normalize(raw: RawUnit, input: Omit<GenerateInput, 'previous' | 'workDir' | 'log'>, knownFiles: string[]): GenerateResult {
  const id = unitId(input.module, input.number);
  const dropped: string[] = [];
  const raws = new Map<string, RawQuestion>();
  const levels = LEVEL_KINDS.map((kind, i) => {
    const rawLevel = raw.levels.find((l) => l.kind === kind) ?? raw.levels[i];
    const qs: Question[] = [];
    for (const rq of rawLevel?.questions ?? []) {
      if (rq.type === 'estimate') continue; // Schätzfragen gibt es nur im Praxis-Level
      const qid = `${id}-l${i + 1}-q${String(qs.length + 1).padStart(2, '0')}`;
      const r = normalizeQuestion(rq, qid, { file: input.file, headings: input.prepared.headings, knownFiles, fallbackConcept: raw.concepts[0] ?? raw.title });
      if (r.ok) {
        qs.push(r.question);
        raws.set(r.question.prompt, rq);
      } else dropped.push(`${kind}: ${r.error}`);
      if (qs.length === 12) break;
    }
    return { id: `${id}-l${i + 1}`, index: i + 1, kind, title: rawLevel?.title?.trim() || LEVEL_TITLES[kind], questions: qs };
  });

  const unit = Unit.parse({
    schemaVersion: 1,
    id,
    module: input.module,
    number: input.number,
    slug: slugify(raw.slug || raw.title),
    title: raw.title.trim(),
    summary: raw.summary.trim(),
    concepts: raw.concepts.map((c) => c.trim()).filter(Boolean).slice(0, 30),
    keyFacts: raw.keyFacts.map((c) => c.trim()).filter(Boolean).slice(0, 30),
    tags: input.prepared.tags.slice(0, 30),
    links: input.prepared.links.slice(0, 50),
    source: { file: input.file, sha256: input.sha256, commit: input.commit },
    generator: {
      model: config.codexModel,
      effort: config.codexEffort,
      reviewEffort: config.codexReviewEffort,
      promptVersion: config.promptVersion,
      generatedAt: new Date().toISOString(),
      review: raw.review,
    },
    levels,
  });
  return { unit, dropped, tokens: 0, raws };
}

/** Generieren (xhigh) → Prüfen (high) → normalisieren/validieren. */
export async function generateUnit(input: GenerateInput): Promise<GenerateResult> {
  const vars = {
    MODULE: input.module,
    MODULE_NAME: MODULE_INFO[input.module].name,
    FILE: input.file,
    UNIT_NUMBER: String(input.number),
    QUESTIONS_PER_LEVEL: String(config.questionsPerLevel),
    TOPIC: input.prepared.topic ?? '–',
    TAGS: input.prepared.tags.join(', ') || '–',
    HEADINGS: formatHeadings(input.prepared.headings),
    IMAGES: input.prepared.images.length
      ? `${input.prepared.images.length} (im Text als „[Bild N – angehängt: …]“ markiert, in derselben Reihenfolge angehängt)`
      : 'keine',
    PREVIOUS_UNITS: formatPrevious(input.previous),
    LINKED_NOTES: formatLinked(input.prepared),
    // 4 Backticks, damit ```mermaid-Blöcke der Notiz die Umrahmung nicht beenden
    SOURCE: `\`\`\`\`markdown\n${input.prepared.text}\n\`\`\`\``,
  };

  input.log(`  → Generierung (${config.codexModel}, effort ${config.codexEffort})`);
  const draft = await codexJson({
    prompt: fill(template('generate-unit.md'), vars),
    effort: config.codexEffort,
    workDir: input.workDir,
    images: input.prepared.images,
    label: 'generate',
    log: input.log,
  });

  input.log(`  → Review (effort ${config.codexReviewEffort})`);
  const reviewed = await codexJson({
    prompt: fill(template('review-unit.md'), { ...vars, UNIT_JSON: JSON.stringify(draft.data, null, 1) }),
    effort: config.codexReviewEffort,
    workDir: input.workDir,
    images: input.prepared.images,
    label: 'review',
    log: input.log,
  });

  const knownFiles = [input.file, ...input.previous.map((p) => p.sourceFile)];
  const result = normalize(reviewed.data as RawUnit, input, knownFiles);
  return { ...result, tokens: draft.tokens + reviewed.tokens };
}

import { Unit, type Unit as UnitType } from './quiz.ts';
import { UnitKnowledge, type UnitKnowledge as KnowledgeType } from './knowledge.ts';
import { mermaidSkeleton } from './mermaid.ts';

export type TranslationField = { path: string; text: string };
type Field = TranslationField;
const unitSymbols = new Set(['ms', 's', 'Hz', 'B', 'kB', 'MB', 'GB', 'KiB', 'MiB', 'GiB', 'bit', 'Bit', 'Byte', 'Bytes', '×', 'PINs']);
const same = (a: unknown, b: unknown) => JSON.stringify(translationShape(a, new Set())) === JSON.stringify(translationShape(b, new Set()));

function add(fields: Field[], path: string, value: unknown) {
  if (typeof value === 'string') fields.push({ path, text: value });
}

export function unitTranslationFields(unit: UnitType): Field[] {
  const fields: Field[] = [];
  add(fields, 'title', unit.title);
  add(fields, 'summary', unit.summary);
  unit.concepts.forEach((v, i) => add(fields, `concepts.${i}`, v));
  unit.keyFacts.forEach((v, i) => add(fields, `keyFacts.${i}`, v));
  unit.levels.forEach((level, li) => {
    add(fields, `levels.${li}.title`, level.title);
    level.questions.forEach((q, qi) => {
      add(fields, `levels.${li}.questions.${qi}.prompt`, q.prompt);
      add(fields, `levels.${li}.questions.${qi}.explanation`, q.explanation);
      q.options.forEach((option, oi) => add(fields, `levels.${li}.questions.${qi}.options.${oi}.text`, option.text));
      if (q.slider && !unitSymbols.has(q.slider.unit ?? '')) add(fields, `levels.${li}.questions.${qi}.slider.unit`, q.slider.unit);
      q.concepts.forEach((v, ci) => add(fields, `levels.${li}.questions.${qi}.concepts.${ci}`, v));
      if (q.context) {
        add(fields, `levels.${li}.questions.${qi}.context.caption`, q.context.caption);
        // Source code is copied byte-for-byte. Mermaid diagrams are translatable fields, but the
        // pipeline only sends their labels to the model; the validator checks the label-free skeleton.
        if (q.context.type === 'table' || q.context.type === 'mermaid') add(fields, `levels.${li}.questions.${qi}.context.content`, q.context.content);
        q.context.frames?.forEach((frame, fi) => {
          add(fields, `levels.${li}.questions.${qi}.context.frames.${fi}.caption`, frame.caption);
          if (q.context!.type === 'mermaid') add(fields, `levels.${li}.questions.${qi}.context.frames.${fi}.content`, frame.content);
        });
      }
    });
  });
  return fields;
}

export function knowledgeTranslationFields(knowledge: KnowledgeType): Field[] {
  const fields: Field[] = [];
  add(fields, 'unitTitle', knowledge.unitTitle);
  add(fields, 'overview', knowledge.overview);
  knowledge.entries.forEach((entry, ei) => {
    add(fields, `entries.${ei}.term`, entry.term);
    add(fields, `entries.${ei}.short`, entry.short);
    add(fields, `entries.${ei}.explanation`, entry.explanation);
    add(fields, `entries.${ei}.example`, entry.example);
    entry.pitfalls.forEach((v, pi) => add(fields, `entries.${ei}.pitfalls.${pi}`, v));
    entry.related.forEach((v, ri) => add(fields, `entries.${ei}.related.${ri}`, v));
  });
  return fields;
}

/** Find code/math spans. Only the prose inside a balanced \text{...} in math may differ. */
export function protectedTokens(text: string): string[] {
  const tokens: string[] = [];
  const re = /```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]*?\$\$|(?<!\\)\$(?!\$)[^$\n]+(?<!\\)\$/g;
  for (const match of text.matchAll(re)) {
    const token = match[0];
    if (!token.startsWith('$')) {
      // Mermaid diagrams may have translated labels; their structure must stay identical.
      const mermaid = /^(`{3,})mermaid[^\n]*\n([\s\S]*?)\1$/.exec(token);
      tokens.push(mermaid ? `mermaid:${mermaidSkeleton(mermaid[2]!)}` : `code:${token}`);
      continue;
    }
    tokens.push(`math:${replaceTextArguments(token)}`);
  }
  return tokens;
}

function replaceTextArguments(formula: string): string {
  let out = '';
  let cursor = 0;
  const matcher = /\\text\s*\{/g;
  for (let match = matcher.exec(formula); match; match = matcher.exec(formula)) {
    const brace = matcher.lastIndex - 1;
    let depth = 1;
    let end = brace + 1;
    for (; end < formula.length && depth; end++) {
      if (formula[end] === '{' && formula[end - 1] !== '\\') depth++;
      else if (formula[end] === '}' && formula[end - 1] !== '\\') depth--;
    }
    if (depth) return formula;
    const text = formula.slice(brace + 1, end - 1);
    // Preserve numbers, punctuation, commands and single-letter variables inside text.
    const skeleton = text.replace(/\\[A-Za-z]+|[\p{L}\p{M}]+|\s+/gu, (token) => token.startsWith('\\') || unitSymbols.has(token) || /^\p{L}$/u.test(token) ? token : '');
    out += formula.slice(cursor, brace + 1) + skeleton + '}';
    cursor = end;
    matcher.lastIndex = end;
  }
  return out + formula.slice(cursor);
}

function stringsByPath(value: unknown, base = '', out = new Map<string, string>()): Map<string, string> {
  if (typeof value === 'string') out.set(base, value);
  else if (Array.isArray(value)) value.forEach((v, i) => stringsByPath(v, base ? `${base}.${i}` : String(i), out));
  else if (value && typeof value === 'object') for (const [key, v] of Object.entries(value)) stringsByPath(v, base ? `${base}.${key}` : key, out);
  return out;
}

function protectedErrors(source: unknown, translated: unknown, fields: Field[]): string[] {
  const original = stringsByPath(source);
  const target = stringsByPath(translated);
  const errors: string[] = [];
  for (const field of fields) {
    const before = original.get(field.path);
    const after = target.get(field.path);
    if (before == null || after == null) continue;
    // Same formulas and code spans byte-for-byte; English word order may move them within the sentence.
    if (!sameProtected(before, after)) errors.push(`${field.path}: code or mathematical notation changed`);
    const markers = (s: string) => s.match(/___/g)?.length ?? 0;
    if (markers(before) !== markers(after)) errors.push(`${field.path}: cloze marker ___ changed`);
    if (!after.trim()) errors.push(`${field.path}: translated field is empty`);
  }
  return errors;
}

function idSequence(unit: UnitType) {
  return unit.levels.map((level) => ({ id: level.id, index: level.index, kind: level.kind, questions: level.questions.map((q) => ({ id: q.id, type: q.type, optionIds: q.options.map((o) => o.id) })) }));
}

function translationShape(value: unknown, allowed: Set<string>, path = ''): unknown {
  if (typeof value === 'string') return allowed.has(path) ? '<translated>' : value;
  if (Array.isArray(value)) return value.map((item, i) => translationShape(item, allowed, `${path}.${i}`));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, translationShape(item, allowed, path ? `${path}.${key}` : key)]));
  return value;
}
function changedStructure(source: unknown, target: unknown, fields: Field[]) {
  const allowed = new Set(fields.map((field) => field.path));
  return !same(translationShape(source, allowed), translationShape(target, allowed));
}

export function validateUnitTranslation(source: UnitType, raw: unknown): string[] {
  const parsed = Unit.safeParse(raw);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  const translated = parsed.data;
  const errors: string[] = [];
  if (changedStructure(source, translated, unitTranslationFields(source))) errors.push('structure or immutable unit fields changed');
  if (!same(idSequence(source), idSequence(translated))) errors.push('level, question, option IDs or their order changed');
  if (source.id !== translated.id || source.module !== translated.module || source.number !== translated.number || source.slug !== translated.slug) errors.push('unit identity fields changed');
  if (!same(source.source, translated.source) || !same(source.generator, translated.generator) || !same(source.tags, translated.tags) || !same(source.links, translated.links)) errors.push('source or generation metadata changed');
  source.levels.forEach((level, li) => level.questions.forEach((q, qi) => {
    const other = translated.levels[li]?.questions[qi];
    if (!other) return;
    const path = `levels.${li}.questions.${qi}`;
    if (!same(q.correct, other.correct)) errors.push(`${path}.correct changed`);
    if (q.difficulty !== other.difficulty) errors.push(`${path}.difficulty changed`);
    const sliderValues = (slider: typeof q.slider) => slider ? { ...slider, unit: null } : undefined;
    if (!same(sliderValues(q.slider), sliderValues(other.slider))) errors.push(`${path}.slider values changed`);
    if (!same(q.source, other.source)) errors.push(`${path}.source changed`);
    if (q.concepts.length !== other.concepts.length) errors.push(`${path}.concepts count changed`);
    if (q.context?.type !== other.context?.type || q.context?.language !== other.context?.language || q.context?.frames?.length !== other.context?.frames?.length) errors.push(`${path}.context structure changed`);
    const diagram = q.context?.type === 'mermaid';
    const sameCode = (a: string, b: string | undefined) => (diagram ? b != null && mermaidSkeleton(a) === mermaidSkeleton(b) : a === b);
    if (q.context && other.context && q.context.type !== 'table' && !sameCode(q.context.content, other.context.content)) errors.push(`${path}.context.content: ${diagram ? 'diagram structure' : 'context code'} changed`);
    if (q.context?.frames && other.context?.frames) q.context.frames.forEach((frame, fi) => {
      if (!sameCode(frame.content, other.context!.frames![fi]?.content)) errors.push(`${path}.context.frames.${fi}.content: ${diagram ? 'diagram structure' : 'content'} changed`);
    });
  }));
  errors.push(...protectedErrors(source, translated, unitTranslationFields(source)));
  return [...new Set(errors)];
}

export function validateKnowledgeTranslation(source: KnowledgeType, raw: unknown): string[] {
  const parsed = UnitKnowledge.safeParse(raw);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  const translated = parsed.data;
  const errors: string[] = [];
  if (changedStructure(source, translated, knowledgeTranslationFields(source))) errors.push('structure or immutable knowledge fields changed');
  if (source.unitId !== translated.unitId || source.module !== translated.module || source.unitNumber !== translated.unitNumber || source.sourceSha !== translated.sourceSha) errors.push('knowledge identity or source fields changed');
  if (!same(source.generator, translated.generator)) errors.push('knowledge generator metadata changed');
  if (source.entries.length !== translated.entries.length) errors.push('knowledge entry count changed');
  source.entries.forEach((entry, i) => {
    const other = translated.entries[i];
    if (!other) return;
    if (entry.id !== other.id || entry.kind !== other.kind) errors.push(`entries.${i}: entry ID or kind changed`);
    if (entry.pitfalls.length !== other.pitfalls.length || entry.related.length !== other.related.length) errors.push(`entries.${i}: pitfalls or related item count changed`);
  });
  errors.push(...protectedErrors(source, translated, knowledgeTranslationFields(source)));
  return [...new Set(errors)];
}


/** Same protected spans (formulas, code, diagram skeletons) as a multiset; order may differ between languages. */
export const sameProtected = (a: string, b: string) => JSON.stringify(protectedTokens(a).sort()) === JSON.stringify(protectedTokens(b).sort());

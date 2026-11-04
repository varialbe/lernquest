import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import katex from 'katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { normalizeMathDelimiters, type Question } from '@lernquest/shared';
import { config } from './config.ts';

/**
 * Formatierungsprüfung wie in der App: Markdown (GFM) + `$…$` (remark-math) + KaTeX.
 * Findet kaputte Formeln, vergessene `$`, rohe LaTeX-Befehle außerhalb von Formeln und Markdown-Reste.
 */
export type LintIssue = { file: string; path: string; kind: string; detail: string; text: string };

const md = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const LATEX_CMD = /\\(frac|mathbb|mathrm|mathit|mathcal|operatorname|cdot|sum|prod|leq|geq|le|ge|neq|ne|in|notin|subseteq|subset|supseteq|cup|cap|land|lor|neg|lnot|to|rightarrow|Rightarrow|Leftrightarrow|iff|times|ldots|dots|cdots|sqrt|text|mid|equiv|pmod|bmod|lfloor|rfloor|lceil|rceil|emptyset|varnothing|forall|exists|alpha|beta|gamma|delta|oplus|log|infty|binom|overline|setminus|circ|vee|wedge|pm|approx)\b/;
const BLANK = String.raw`\underline{\hspace{2em}}`;
/** Titel, Begriffe usw. zeigt die App mit MathText (nur `$…$` und Backticks, kein Markdown). */
const PLAIN_PATH = /(^title$|^unitTitle$|\.term$|^summary$|^concepts\.\d+$|^levels\.\d+\.title$|\.related\.\d+$)/;
const SKIP_PATH = /(^|\.)(id|slug|module|type|kind|correct|source|generator|tags|links|language|sourceSha|unitId|heading|file|commit|sha256|content)$|^generator\.|\.source\./;

function katexError(tex: string, display: boolean): string | null {
  try {
    katex.renderToString(tex.replace(/_{3,}/g, BLANK), { throwOnError: true, strict: false, displayMode: display });
    return null;
  } catch (error) {
    return String((error as Error).message).replace(/^KaTeX parse error: /, '').slice(0, 140);
  }
}

/** Probleme eines Markdown-Textes (Frage, Erklärung, Option, Wissenseintrag). */
export function markdownProblems(text: string): { kind: string; detail: string }[] {
  const out: { kind: string; detail: string }[] = [];
  const visit = (node: { type: string; value?: string; children?: unknown[] }) => {
    if (node.type === 'inlineMath' || node.type === 'math') {
      const error = katexError(node.value ?? '', node.type === 'math');
      if (error) out.push({ kind: 'katex', detail: error });
    } else if (node.type === 'text') {
      const value = node.value ?? '';
      const dollar = value.indexOf('$');
      if (dollar >= 0) out.push({ kind: 'unclosed-$', detail: `…${value.slice(Math.max(0, dollar - 30), dollar + 30)}…` });
      const command = LATEX_CMD.exec(value);
      if (command) out.push({ kind: 'latex-outside-math', detail: command[0] });
      if (value.includes('**')) out.push({ kind: 'markdown', detail: 'unpaired **' });
    }
    for (const child of (node.children ?? []) as (typeof node)[]) visit(child);
  };
  visit(md.parse(normalizeMathDelimiters(text)) as never);
  return out;
}

/** Probleme eines Kurztextes (Titel, Begriff), den die App mit MathText rendert. */
export function plainProblems(text: string): { kind: string; detail: string }[] {
  const out: { kind: string; detail: string }[] = [];
  for (const part of text.split(/(`[^`]+`|\$\$?[^$]+\$\$?)/g)) {
    const math = /^\$\$?([^$]+)\$\$?$/.exec(part);
    if (math) {
      const error = katexError(math[1]!, false);
      if (error) out.push({ kind: 'katex', detail: error });
    } else if (!part.startsWith('`')) {
      if (part.includes('$')) out.push({ kind: 'unclosed-$', detail: part.slice(0, 60) });
      const command = LATEX_CMD.exec(part);
      if (command) out.push({ kind: 'latex-outside-math', detail: command[0] });
      if (/\*\*|(^|\s)_[^_\s][^_]*_(\s|$)/.test(part)) out.push({ kind: 'markdown', detail: 'Markdown in plain text field' });
    }
  }
  return out;
}

const GERMAN = /\b(und|oder|nicht|wenn|dann|eine?[mnrs]?|der|die|das|dem|den|des|ist|sind|wird|werden|gilt|gelten|für|mit|bei|aus|dass|welche[rsn]?|wähle|zwischen|immer|keine?)\b/gi;
/** Deutsche Reste in englischem Fließtext (außerhalb von Formeln, Code und Klammern mit Fachbegriffen). */
export function germanLeftovers(text: string): string[] {
  const prose = text.replace(/```[\s\S]*?```|`[^`]*`|\$\$[\s\S]*?\$\$|\$[^$]*\$|\([^)]*\)|„[^“]*“|"[^"]*"/g, ' ');
  const hits = [...prose.matchAll(GERMAN)].map((m) => m[0]).filter((w) => !/^(die|des)$/i.test(w));
  return hits.length >= 2 ? hits : [];
}

/** Formatfehler einer einzelnen Frage (für das Quality-Gate). */
export function questionFormatProblems(q: Question): string[] {
  const texts: [string, string][] = [['prompt', q.prompt], ['explanation', q.explanation], ...q.options.map((o) => [`option ${o.id}`, o.text] as [string, string])];
  if (q.context?.type === 'table') texts.push(['context', q.context.content]);
  return texts.flatMap(([where, text]) => markdownProblems(text).map((p) => `${where}: ${p.kind} (${p.detail})`));
}

function walk(value: unknown, path: string, visit: (path: string, text: string) => void) {
  if (typeof value === 'string') visit(path, value);
  else if (Array.isArray(value)) value.forEach((item, i) => walk(item, path ? `${path}.${i}` : String(i), visit));
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) walk(item, path ? `${path}.${key}` : key, visit);
}

/** Alle Unit- und Wissensdateien (Deutsch + Englisch) prüfen. */
export function lintAll(): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const base of [config.contentDir, config.knowledgeDir]) {
    for (const mod of ['ds', 'eip', 'era']) {
      for (const sub of ['', 'en']) {
        const dir = join(base, mod, sub);
        if (!existsSync(dir)) continue;
        for (const name of readdirSync(dir).filter((n) => n.endsWith('.json') && !n.endsWith('.meta.json') && !n.endsWith('.prereqs.json') && !n.startsWith('_'))) {
          const file = join(dir, name);
          const rel = relative(join(config.contentDir, '..'), file);
          const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
          walk(data, '', (path, text) => {
            if (!text.trim() || SKIP_PATH.test(path)) return;
            const problems = PLAIN_PATH.test(path) ? plainProblems(text) : markdownProblems(text);
            for (const p of problems) issues.push({ file: rel, path, kind: p.kind, detail: p.detail, text: text.slice(0, 240) });
            if (sub === 'en') {
              const german = germanLeftovers(text);
              if (german.length) issues.push({ file: rel, path, kind: 'german-in-english', detail: german.slice(0, 6).join(', '), text: text.slice(0, 240) });
            }
          });
          // Tabellen-Kontexte sind Markdown, werden aber über `content` übersprungen
          (data.levels as { questions: Question[] }[] | undefined)?.forEach((level, li) => level.questions.forEach((q, qi) => {
            if (q.context?.type !== 'table') return;
            for (const p of markdownProblems(q.context.content)) issues.push({ file: rel, path: `levels.${li}.questions.${qi}.context.content`, kind: p.kind, detail: p.detail, text: q.context.content.slice(0, 240) });
          }));
        }
      }
    }
  }
  return issues;
}

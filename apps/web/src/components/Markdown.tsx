import { lazy, memo, Suspense, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { rehypeHighlightLite } from '../lib/highlight.ts';

const Mermaid = lazy(() => import('./Mermaid.tsx'));
const GAP = '⁣GAP⁣';
const BLANK = String.raw`\underline{\hspace{2em}}`;

/** Klammern ({…}, \left…\right) ausgeglichen? Nur dann darf eine Formel an der Lücke geteilt werden. */
function balanced(tex: string): boolean {
  let depth = 0;
  for (let i = 0; i < tex.length; i++) {
    if (tex[i] === '\\') { i++; continue; }
    if (tex[i] === '{') depth++;
    else if (tex[i] === '}' && --depth < 0) return false;
  }
  return depth === 0 && (tex.match(/\\left\b/g)?.length ?? 0) === (tex.match(/\\right\b/g)?.length ?? 0);
}

/**
 * Lücken `___` innerhalb von `$…$` lassen KaTeX scheitern. Interaktiv wird die Formel an der ersten Lücke
 * geteilt (`$a=$ ___ $b$`), damit dort das Antwortfeld erscheint; sonst wird eine leere Linie gezeichnet.
 * Exportiert für Tests.
 */
export function gapsInMath(text: string, interactive: boolean): string {
  if (!/_{3}/.test(text) || !text.includes('$')) return text;
  // `split` = die eine interaktive Lücke ist schon vergeben (Markdown ersetzt nur das erste ___ im Text)
  let split = !interactive;
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) => {
      if (i % 2) {
        if (/_{3,}/.test(part)) split = true;
        return part;
      }
      let last = 0;
      return part.replace(/\$\$([\s\S]+?)\$\$|(?<!\\)\$((?:\\\$|[^$])+?)\$/g, (whole, display: string | undefined, inline: string | undefined, offset: number) => {
            if (/_{3,}/.test(part.slice(last, offset))) split = true;
            last = offset + whole.length;
            const tex = display ?? inline!;
            if (!/_{3,}/.test(tex)) return whole;
            const at = tex.search(/_{3,}/);
            const left = tex.slice(0, at).replace(/\\\s*$/, '').trimEnd();
            const right = tex.slice(at).replace(/^_{3,}/, '').replace(/^\\\s/, '').trimStart();
            if (!split && inline != null && balanced(left) && balanced(right)) {
              split = true;
              const blankRest = (s: string) => s.replace(/_{3,}/g, BLANK);
              return `${left ? `$${left}$ ` : ''}___${right ? ` $${blankRest(right)}$` : ''}`;
            }
            const filled = tex.replace(/_{3,}/g, BLANK);
            return display != null ? `$$${filled}$$` : `$${filled}$`;
          });
    })
    .join('');
}

/**
 * Markdown mit KaTeX ($…$), Code-Highlighting und Mermaid. Bei Lückentexten wird ___ durch `gap` ersetzt.
 * `inline`: für einzeilige Texte (Kurzfassung, Aufzählungspunkte) – ohne Absatz-Abstände, in einem <span>.
 */
export const Markdown = memo(function Markdown({ text, gap, className = '', inline }: { text: string; gap?: ReactNode; className?: string; inline?: boolean }) {
  const Wrap = inline ? 'span' : 'div';
  const prepared = gapsInMath(text, gap !== undefined);
  const src = gap !== undefined ? prepared.replace(/_{3,}/, `\`${GAP}\``) : prepared;
  return (
    <Wrap className={`prose-q ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }], rehypeHighlightLite]}
        components={{
          code({ className: cls, children }) {
            const lang = /language-(\w+)/.exec(cls ?? '')?.[1];
            const raw = String(children ?? '');
            if (raw === GAP) return <>{gap}</>;
            if (lang === 'mermaid') {
              return (
                <Suspense fallback={<div className="my-2 h-40 animate-pulse rounded-2xl bg-surface-2" />}>
                  <Mermaid code={raw.replace(/\n$/, '')} />
                </Suspense>
              );
            }
            return <code className={cls}>{children}</code>;
          },
          ...(inline ? { p: ({ children }: { children?: ReactNode }) => <>{children}</> } : {}),
          pre({ children, node }) {
            // Mermaid-Blöcke nicht in <pre> einpacken
            const child = node?.children?.[0] as { properties?: { className?: string[] } } | undefined;
            if (child?.properties?.className?.includes('language-mermaid')) return <>{children}</>;
            return <pre>{children}</pre>;
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noreferrer" className="font-bold text-primary underline">
                {children}
              </a>
            );
          },
        }}
      >
        {src}
      </ReactMarkdown>
    </Wrap>
  );
});

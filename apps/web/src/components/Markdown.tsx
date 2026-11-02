import { lazy, memo, Suspense, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { rehypeHighlightLite } from '../lib/highlight.ts';

const Mermaid = lazy(() => import('./Mermaid.tsx'));
const GAP = '⁣GAP⁣';

/**
 * Markdown mit KaTeX ($…$), Code-Highlighting und Mermaid. Bei Lückentexten wird ___ durch `gap` ersetzt.
 * `inline`: für einzeilige Texte (Kurzfassung, Aufzählungspunkte) – ohne Absatz-Abstände, in einem <span>.
 */
export const Markdown = memo(function Markdown({ text, gap, className = '', inline }: { text: string; gap?: ReactNode; className?: string; inline?: boolean }) {
  const Wrap = inline ? 'span' : 'div';
  const src = gap !== undefined ? text.replace(/_{3,}/, `\`${GAP}\``) : text;
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

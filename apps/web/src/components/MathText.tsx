import katex from 'katex';
import { memo } from 'react';

/** Kurzer Text mit Inline-LaTeX in `$…$` und Inline-Code in Backticks (Unit-Titel, Begriffe, Zusammenfassungen) – ohne den ganzen Markdown-Stack. */
export const MathText = memo(function MathText({ text, className }: { text: string; className?: string }) {
  if (!text.includes('$') && !text.includes('`')) return <span className={className}>{text}</span>;
  const parts = text.split(/(`[^`]+`|\$\$?[^$]+\$\$?)/g);
  return (
    <span className={className}>
      {parts.map((p, i) => {
        const c = /^`([^`]+)`$/.exec(p);
        if (c) return <code key={i} className="rounded-md bg-surface-2 px-1 py-px font-mono text-[0.9em] font-bold">{c[1]}</code>;
        const m = /^\$\$?([^$]+)\$\$?$/.exec(p);
        if (!m) return p;
        const html = katex.renderToString(m[1]!, { throwOnError: false, strict: false, output: 'html' });
        return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </span>
  );
});

/** Für aria-labels/Titel: Backticks und LaTeX grob in Klartext (ohne `$`, Befehle wie \mathbb{N} → N). */
export const plainMath = (text: string) => text.replace(/`([^`]+)`/g, '$1').replace(/\$\$?([^$]+)\$\$?/g, (_, m: string) => m.replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1').replace(/\\([a-zA-Z]+)/g, '$1'));

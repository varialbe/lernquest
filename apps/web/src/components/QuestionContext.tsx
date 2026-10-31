import { lazy, Suspense } from 'react';
import type { Question } from '@lernquest/shared';
import { Markdown } from './Markdown.tsx';

const Mermaid = lazy(() => import('./Mermaid.tsx'));

/** Daten zur Frage (Graph, Code, Tabelle), über dem Fragetext. Diagramme lassen sich antippen und erkunden. */
export function QuestionContext({ context }: { context: NonNullable<Question['context']> }) {
  const { type, content, language, caption, frames } = context;
  return (
    <figure className="mb-4">
      {type === 'mermaid' ? (
        <Suspense fallback={<div className="my-2 h-40 animate-pulse rounded-2xl bg-surface-2" />}>
          <Mermaid code={content} caption={caption} frames={frames?.length ? [{ content, caption: caption ?? 'Start' }, ...frames] : undefined} />
        </Suspense>
      ) : type === 'code' ? (
        <Markdown text={`\`\`\`\`${language ?? ''}\n${content}\n\`\`\`\``} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border-2 border-line bg-surface p-2">
          <Markdown text={content} className="[&_table]:my-0 [&_table]:w-full" />
        </div>
      )}
      {caption && type !== 'mermaid' && <figcaption className="mt-1 px-1 text-sm font-bold text-muted">{caption}</figcaption>}
      {caption && type === 'mermaid' && !frames?.length && <figcaption className="px-1 text-sm font-bold text-muted">{caption}</figcaption>}
    </figure>
  );
}

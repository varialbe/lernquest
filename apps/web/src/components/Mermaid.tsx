import { useEffect, useId, useState } from 'react';

type MermaidApi = typeof import('mermaid').default;
let loader: Promise<MermaidApi> | null = null;
let themeOf: 'dark' | 'light' | null = null;

const isDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

/** Mermaid wird erst geladen, wenn ein Diagramm angezeigt wird (eigener Chunk). */
async function getMermaid(): Promise<MermaidApi> {
  loader ??= import('mermaid').then((m) => m.default);
  const mermaid = await loader;
  const want = isDark() ? 'dark' : 'light';
  if (themeOf !== want) {
    const css = getComputedStyle(document.documentElement);
    const v = (n: string) => css.getPropertyValue(n).trim();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: 'Nunito Variable, ui-rounded, sans-serif',
      themeVariables: {
        darkMode: want === 'dark',
        background: 'transparent',
        primaryColor: want === 'dark' ? '#2b2550' : '#efeaff',
        primaryBorderColor: v('--c-primary') || '#7c5cff',
        primaryTextColor: v('--c-text') || '#241d3d',
        lineColor: want === 'dark' ? '#a69fca' : '#6f6790',
        secondaryColor: want === 'dark' ? '#1f3a33' : '#e3f9ee',
        tertiaryColor: want === 'dark' ? '#3a2a1f' : '#fff3e0',
        fontSize: '15px',
      },
      flowchart: { curve: 'basis', htmlLabels: true, padding: 10 },
    });
    themeOf = want;
  }
  return mermaid;
}

export default function Mermaid({ code }: { code: string }) {
  const id = `m${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [scheme, setScheme] = useState(isDark());

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const h = () => setScheme(mq.matches);
    mq?.addEventListener('change', h);
    return () => mq?.removeEventListener('change', h);
  }, []);

  useEffect(() => {
    let alive = true;
    getMermaid()
      .then((m) => m.render(`${id}-${scheme ? 'd' : 'l'}`, code))
      .then((r) => alive && setSvg(r.svg))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [code, id, scheme]);

  if (error)
    return (
      <pre>
        <code>{code}</code>
      </pre>
    );
  if (!svg) return <div className="my-2 h-40 animate-pulse rounded-2xl bg-surface-2" />;
  return (
    <div
      className="my-2 flex justify-center overflow-x-auto rounded-2xl border-2 border-line bg-surface-2 p-3 [&_svg]:h-auto [&_svg]:max-w-full"
      role="img"
      aria-label="Diagramm"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

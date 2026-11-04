import { useCommonT } from '../i18n/common.ts';
import { lazy, Suspense, useEffect, useId, useState } from 'react';
import { Icon } from './icons.tsx';

type MermaidApi = typeof import('mermaid').default;
let loader: Promise<MermaidApi> | null = null;
let themeKey: string | null = null;
let seq = 0;

const DiagramExplorer = lazy(() => import('./DiagramExplorer.tsx'));

const isDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
/** Hell/Dunkel + Farbschema aus dem Shop: ändert sich eins davon, wird Mermaid neu initialisiert. */
const currentThemeKey = () => `${isDark() ? 'd' : 'l'}:${document.documentElement.dataset.theme ?? 'default'}`;

/** Mermaid wird erst geladen, wenn ein Diagramm angezeigt wird (eigener Chunk). */
async function getMermaid(): Promise<MermaidApi> {
  loader ??= import('mermaid').then((m) => m.default);
  const mermaid = await loader;
  const want = currentThemeKey();
  if (themeKey !== want) {
    const dark = isDark();
    const css = getComputedStyle(document.documentElement);
    const v = (n: string, d: string) => css.getPropertyValue(n).trim() || d;
    const primary = v('--c-primary', '#7c5cff');
    const surface = v('--c-surface', dark ? '#1c1930' : '#ffffff');
    // Knotenfarbe aus der Theme-Farbe mischen (Mermaid versteht kein color-mix)
    const mix = (hex: string, base: string, t: number) => {
      const p = (h: string) => (h.length === 4 ? [1, 2, 3].map((i) => parseInt(h[i]! + h[i]!, 16)) : [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
      if (!/^#[0-9a-f]{3,6}$/i.test(hex) || !/^#[0-9a-f]{3,6}$/i.test(base)) return dark ? '#2b2550' : '#efeaff';
      const a = p(hex);
      const b = p(base);
      return `#${a.map((x, i) => Math.round(x * t + b[i]! * (1 - t)).toString(16).padStart(2, '0')).join('')}`;
    };
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: 'Nunito Variable, ui-rounded, sans-serif',
      themeVariables: {
        darkMode: dark,
        background: 'transparent',
        primaryColor: mix(primary, surface, dark ? 0.28 : 0.14),
        primaryBorderColor: primary,
        primaryTextColor: v('--c-text', '#241d3d'),
        lineColor: v('--c-muted', dark ? '#a69fca' : '#6f6790'),
        secondaryColor: dark ? '#1f3a33' : '#e3f9ee',
        tertiaryColor: dark ? '#3a2a1f' : '#fff3e0',
        fontSize: '15px',
      },
      flowchart: { curve: 'basis', htmlLabels: true, padding: 10 },
    });
    themeKey = want;
  }
  return mermaid;
}

/** Rendert Mermaid-Code zu SVG; neu bei Wechsel von Hell/Dunkel oder Farbschema. */
export function useMermaidSvg(code: string): { svg: string | null; error: boolean } {
  const base = `m${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [state, setState] = useState<{ svg: string | null; error: boolean }>({ svg: null, error: false });
  const [key, setKey] = useState(currentThemeKey);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const h = () => setKey(currentThemeKey());
    mq?.addEventListener('change', h);
    const mo = new MutationObserver(h);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mq?.removeEventListener('change', h);
      mo.disconnect();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    getMermaid()
      .then((m) => m.render(`${base}-${++seq}`, code))
      .then((r) => alive && setState({ svg: r.svg, error: false }))
      .catch(() => alive && setState({ svg: null, error: true }));
    return () => {
      alive = false;
    };
  }, [code, base, key]);
  return state;
}

export type DiagramFrame = { content: string; caption: string | null };

/** Diagramm in der Frage; Antippen öffnet den Erkunden-Modus (Vollbild, Zoom, Schritte). */
export default function Mermaid({ code, frames, caption }: { code: string; frames?: DiagramFrame[]; caption?: string | null }) {
  const ct = useCommonT();
  const { svg, error } = useMermaidSvg(code);
  const [open, setOpen] = useState(false);
  const steps: DiagramFrame[] = frames?.length ? frames : [{ content: code, caption: caption ?? null }];

  if (error)
    return (
      <pre>
        <code>{code}</code>
      </pre>
    );
  if (!svg) return <div className="my-2 h-40 animate-pulse rounded-2xl bg-surface-2" />;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative my-2 block w-full overflow-hidden rounded-2xl border-2 border-line bg-surface-2 p-3 text-left active:scale-[0.99]"
        aria-label={`Diagramm erkunden${frames?.length ? ` (${frames.length} Schritte)` : ''}`}
      >
        <div className="flex justify-center [&_svg]:h-auto [&_svg]:max-h-[46dvh] [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
        <span className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded-xl bg-surface/90 px-2 py-1 text-xs font-black text-primary shadow-card">
          <Icon name="search" size={14} />
          {frames?.length ? `${frames.length} Schritte` : ct("Erkunden")}
        </span>
      </button>
      {open && (
        <Suspense fallback={null}>
          <DiagramExplorer frames={steps} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}

import { useCommonT } from '../i18n/common.ts';
import Panzoom, { type PanzoomObject } from '@panzoom/panzoom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { sfx } from '../lib/sound.ts';
import { Icon } from './icons.tsx';
import { useMermaidSvg, type DiagramFrame } from './Mermaid.tsx';

/** Knoten-ID aus einem Mermaid-Flowchart-Knoten (data-id oder id „…-flowchart-A-12“). */
function nodeIdOf(el: Element): string | null {
  const d = (el as HTMLElement).dataset?.id;
  if (d) return d;
  return /flowchart-(.+)-\d+$/.exec(el.id)?.[1] ?? null;
}

/** Tipp auf einen Knoten: Knoten, seine Kanten und Nachbarn hervorheben, Rest ausgrauen. Erneut tippen/ins Leere → zurücksetzen. */
function highlight(svg: SVGSVGElement, target: Element | null) {
  svg.querySelectorAll('.lq-hl').forEach((e) => e.classList.remove('lq-hl'));
  const node = target?.closest('g.node');
  const id = node ? nodeIdOf(node) : null;
  if (!node || !id || node.classList.contains('lq-sel')) {
    svg.classList.remove('lq-focus');
    svg.querySelectorAll('.lq-sel').forEach((e) => e.classList.remove('lq-sel'));
    return;
  }
  svg.querySelectorAll('.lq-sel').forEach((e) => e.classList.remove('lq-sel'));
  node.classList.add('lq-hl', 'lq-sel');
  const neighbours = new Set<string>();
  // Kanten: data-id/id „L_<von>_<nach>_<n>“ (Pfade und Beschriftungen)
  svg.querySelectorAll('[data-id^="L_"], [id*="-L_"], [id^="L_"]').forEach((e) => {
    const eid = (e as HTMLElement).dataset?.id ?? e.id.slice(e.id.indexOf('L_'));
    const m = /^L_(.+)_\d+$/.exec(eid);
    if (!m) return;
    const body = m[1]!;
    let other: string | null = null;
    if (body.startsWith(`${id}_`)) other = body.slice(id.length + 1);
    else if (body.endsWith(`_${id}`)) other = body.slice(0, -(id.length + 1));
    if (other === null) return;
    neighbours.add(other);
    e.classList.add('lq-hl');
    e.closest('g.edgeLabel')?.classList.add('lq-hl');
  });
  svg.querySelectorAll('g.node').forEach((n) => {
    const nid = nodeIdOf(n);
    if (nid && neighbours.has(nid)) n.classList.add('lq-hl');
  });
  svg.classList.add('lq-focus');
}

function Stage({ frame, onReady }: { frame: DiagramFrame; onReady: (el: HTMLDivElement | null) => void }) {
  const ct = useCommonT();
  const { svg, error } = useMermaidSvg(frame.content);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!svg || !ref.current) return;
    const el = ref.current.querySelector('svg');
    if (el) {
      // Mermaid setzt max-width in px – im Vollbild auf die Bildschirmbreite skalieren
      el.style.maxWidth = '100%';
      el.style.maxHeight = '100%';
      el.removeAttribute('height');
      el.style.width = '100%';
      el.style.height = 'auto';
    }
    onReady(ref.current);
  }, [svg, onReady]);
  if (error) return <p className="p-6 text-center font-bold text-error">{ct("Diagramm konnte nicht gezeichnet werden.")}</p>;
  if (!svg) return <div className="h-60 w-full animate-pulse rounded-3xl bg-surface-2" />;
  return <div ref={ref} className="lq-diagram w-full max-w-[min(100vw,900px)] px-3" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Vollbild: Pinch-Zoom, Pan, Doppeltipp = zurücksetzen, Schritte blättern, Knoten antippen = hervorheben. */
export default function DiagramExplorer({ frames, onClose }: { frames: DiagramFrame[]; onClose: () => void }) {
  const ct = useCommonT();
  const [i, setI] = useState(0);
  const area = useRef<HTMLDivElement>(null);
  const pz = useRef<PanzoomObject | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const frame = frames[i]!;

  // Seite dahinter nicht scrollen lassen
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI((x) => Math.min(frames.length - 1, x + 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', esc);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', esc);
    };
  }, [onClose, frames.length]);

  const onReady = useCallback((el: HTMLDivElement | null) => {
    pz.current?.destroy();
    pz.current = null;
    content.current = el;
    if (!el) return;
    // Zoom/Pan bleibt beim Blättern erhalten, damit man einen Ausschnitt Schritt für Schritt verfolgen kann
    const prev = (el.parentElement as HTMLElement & { _lqPz?: { scale: number; x: number; y: number } })._lqPz;
    pz.current = Panzoom(el, { maxScale: 8, minScale: 0.6, step: 0.4, canvas: true, touchAction: 'none', cursor: 'grab', startScale: prev?.scale ?? 1, startX: prev?.x ?? 0, startY: prev?.y ?? 0 });
  }, []);

  useEffect(() => {
    const a = area.current;
    if (!a) return;
    const wheel = (e: WheelEvent) => pz.current?.zoomWithWheel(e);
    a.addEventListener('wheel', wheel, { passive: false });
    // Tipp vs. Ziehen/Pinch unterscheiden; zwei Tipps kurz hintereinander = zurücksetzen.
    // Capture-Phase, weil Panzoom pointerdown nicht weiterreicht.
    const active = new Set<number>();
    let multi = false;
    let start: { x: number; y: number; t: number } | null = null;
    let lastTap = 0;
    const pd = (e: PointerEvent) => {
      active.add(e.pointerId);
      if (active.size > 1) multi = true;
      else start = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    };
    const pu = (e: PointerEvent) => {
      if (!active.delete(e.pointerId)) return;
      const wasMulti = multi;
      if (active.size === 0) multi = false;
      if (wasMulti || !start) return;
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      const quick = e.timeStamp - start.t < 350;
      start = null;
      if (moved > 8 || !quick) return;
      const svg = content.current?.querySelector('svg');
      if (e.timeStamp - lastTap < 320) {
        lastTap = 0;
        pz.current?.reset();
        if (svg) highlight(svg, null);
        return;
      }
      lastTap = e.timeStamp;
      if (svg) highlight(svg, e.target as Element);
    };
    const cancel = (e: PointerEvent) => {
      active.delete(e.pointerId);
      if (!active.size) multi = false;
    };
    a.addEventListener('pointerdown', pd, true);
    window.addEventListener('pointerup', pu, true);
    window.addEventListener('pointercancel', cancel, true);
    return () => {
      a.removeEventListener('wheel', wheel);
      a.removeEventListener('pointerdown', pd, true);
      window.removeEventListener('pointerup', pu, true);
      window.removeEventListener('pointercancel', cancel, true);
    };
  }, []);

  useEffect(() => () => pz.current?.destroy(), []);

  const go = (d: number) => {
    const n = Math.max(0, Math.min(frames.length - 1, i + d));
    if (n === i) return;
    // aktuellen Ausschnitt für den nächsten Schritt merken
    const host = content.current?.parentElement as (HTMLElement & { _lqPz?: unknown }) | undefined;
    if (host && pz.current) host._lqPz = { scale: pz.current.getScale(), ...pz.current.getPan() };
    sfx.tap();
    setI(n);
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col bg-bg" role="dialog" aria-modal aria-label={ct("Diagramm erkunden")}>
      <div className="safe-top flex items-center gap-2 px-3 pb-2 pt-2">
        <button onClick={onClose} aria-label={ct("Schließen")} className="rounded-xl p-2 text-muted hover:bg-surface-2">
          <Icon name="x" size={26} weight={2.8} />
        </button>
        <p className="min-w-0 flex-1 truncate text-sm font-black text-muted">
          {frames.length > 1 ? ct("Schritt {p0} von {p1}", { p0: i + 1, p1: frames.length }) : ct("Diagramm")}
        </p>
        <button onClick={() => pz.current?.zoomOut()} aria-label={ct("Verkleinern")} className="h-10 w-10 rounded-xl border-2 border-line text-xl font-black">
          −
        </button>
        <button onClick={() => pz.current?.zoomIn()} aria-label={ct("Vergrößern")} className="h-10 w-10 rounded-xl border-2 border-line text-xl font-black">
          +
        </button>
        <button onClick={() => pz.current?.reset()} aria-label={ct("Ansicht zurücksetzen")} className="h-10 w-10 rounded-xl border-2 border-line">
          <Icon name="expand" size={20} className="mx-auto" />
        </button>
      </div>

      <div ref={area} className="relative flex flex-1 items-center justify-center overflow-hidden" style={{ touchAction: 'none' }}>
        <div className="flex h-full w-full items-center justify-center">
          <Stage key={i} frame={frame} onReady={onReady} />
        </div>
        <p className="pointer-events-none absolute inset-x-3 bottom-2 mx-auto w-fit rounded-xl bg-bg/85 px-3 py-1 text-center text-xs font-bold text-muted backdrop-blur">{ct("Zwei Finger: zoomen · Doppeltipp: zurücksetzen · Knoten antippen: hervorheben")}</p>
      </div>

      {(frame.caption || frames.length > 1) && (
        <div className="safe-bottom border-t-2 border-line bg-surface px-4 pb-3 pt-3">
          {frame.caption && <p className="mb-3 text-center font-extrabold">{frame.caption}</p>}
          {frames.length > 1 && (
            <div className="flex items-center gap-3">
              <button onClick={() => go(-1)} disabled={i === 0} aria-label={ct("Vorheriger Schritt")} className="flex h-12 w-14 items-center justify-center rounded-2xl border-2 border-line disabled:opacity-30">
                <Icon name="chevronLeft" size={26} weight={3} />
              </button>
              <div className="flex flex-1 justify-center gap-1.5">
                {frames.map((_, k) => (
                  <button key={k} onClick={() => go(k - i)} aria-label={ct("Schritt {p0}", { p0: k + 1 })} className={`h-2.5 rounded-full transition-all ${k === i ? 'w-6 bg-primary' : 'w-2.5 bg-line-strong'}`} />
                ))}
              </div>
              <button onClick={() => go(1)} disabled={i === frames.length - 1} aria-label={ct("Nächster Schritt")} className="flex h-12 w-14 items-center justify-center rounded-2xl bg-primary text-white shadow-[0_4px_0_var(--c-primary-dark)] disabled:opacity-30">
                <Icon name="chevronRight" size={26} weight={3} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}

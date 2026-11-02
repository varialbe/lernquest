import { animate, AnimatePresence, motion, useMotionValue, useTransform } from 'motion/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { MathText, plainMath } from './MathText.tsx';

type Variant = 'primary' | 'success' | 'error' | 'secondary' | 'gold' | 'ghost' | 'danger-outline';
const variants: Record<Variant, string> = {
  primary: 'bg-primary text-white shadow-[0_4px_0_var(--c-primary-dark)] hover:brightness-105',
  success: 'bg-success text-white shadow-[0_4px_0_var(--c-success-dark)] hover:brightness-105',
  error: 'bg-error text-white shadow-[0_4px_0_var(--c-error-dark)] hover:brightness-105',
  gold: 'bg-gold text-[#4a3300] shadow-[0_4px_0_var(--c-gold-dark)] hover:brightness-105',
  secondary: 'bg-surface text-primary border-2 border-line shadow-[0_4px_0_var(--c-border)] hover:bg-surface-2',
  ghost: 'bg-transparent text-primary shadow-none hover:bg-primary-soft',
  'danger-outline': 'bg-surface text-error border-2 border-line shadow-[0_4px_0_var(--c-border)]',
};

export function Button({ variant = 'primary', full, className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; full?: boolean }) {
  const disabled = rest.disabled ? 'bg-locked! text-muted! shadow-[0_4px_0_var(--c-locked-dark)]! border-transparent!' : '';
  return (
    <button {...rest} className={`btn3d ${variants[variant]} ${disabled} ${full ? 'w-full' : ''} ${className}`}>
      {children}
    </button>
  );
}

export function Card({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={`rounded-3xl border-2 border-line bg-surface p-4 shadow-card ${onClick ? 'cursor-pointer active:scale-[0.99] transition-transform' : ''} ${className}`}>
      {children}
    </div>
  );
}

export function ProgressBar({ value, color = 'var(--c-success)', height = 16, className = '' }: { value: number; color?: string; height?: number; className?: string }) {
  return (
    <div className={`relative w-full overflow-hidden rounded-full bg-locked ${className}`} style={{ height }} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <motion.div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ background: color }}
        initial={false}
        animate={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        transition={{ type: 'spring', stiffness: 120, damping: 20 }}
      >
        <div className="absolute left-2 right-2 top-[22%] h-[22%] rounded-full bg-white/35" />
        {value > 0 && (
          <motion.div
            key={Math.round(value * 1000)}
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-10 -skew-x-12 bg-gradient-to-r from-transparent via-white/60 to-transparent motion-reduce:hidden"
            initial={{ left: '-20%', opacity: 1 }}
            animate={{ left: '110%', opacity: 0.2 }}
            transition={{ duration: 0.7, ease: 'easeOut', delay: 0.15 }}
          />
        )}
      </motion.div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted" role="status">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-line border-t-primary" />
      {label && <span className="font-bold">{label}</span>}
    </div>
  );
}

export function Pill({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-extrabold uppercase tracking-wide ${className}`}>{children}</span>;
}

/** Bottom-Sheet (mobil) bzw. zentriertes Modal. */
/**
 * Nach unten wegwischen (Bottom-Sheet): Touch zieht das Sheet nur, solange der Inhalt ganz oben ist –
 * sonst wird normal gescrollt. Mit der Maus über den Griff. Weit genug oder schnell genug → schließen.
 */
function useSwipeToClose(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const y = useMotionValue(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startY = 0;
    let startT = 0;
    let dragging = false;
    let tracking = false;
    const finish = (dy: number, dt: number) => {
      const fast = dy > 60 && dy / Math.max(dt, 1) > 0.6; // px/ms
      if (dy > 120 || fast) {
        onClose(); // Ausblenden übernimmt die exit-Animation (läuft von der aktuellen Position weiter nach unten)
      } else void animate(y, 0, { type: 'spring', stiffness: 500, damping: 40 });
    };
    const onStart = (e: TouchEvent) => {
      startY = e.touches[0]!.clientY;
      startT = Date.now();
      dragging = false;
      tracking = el.scrollTop <= 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const dy = e.touches[0]!.clientY - startY;
      if (!dragging) {
        if (dy < -4 || el.scrollTop > 0) {
          tracking = false; // nach oben → normal scrollen
          return;
        }
        if (dy < 6) return;
        dragging = true;
      }
      e.preventDefault(); // kein Gummiband-Scrollen, stattdessen das Sheet ziehen
      y.set(Math.max(0, dy));
    };
    const onEnd = (e: TouchEvent) => {
      if (!dragging) return;
      dragging = false;
      finish((e.changedTouches[0]?.clientY ?? startY) - startY, Date.now() - startT);
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [onClose, y]);
  /** Maus/Stift: am Griff ziehen */
  const onHandlePointerDown = (e: { pointerType: string; clientY: number }) => {
    if (e.pointerType === 'touch') return;
    const startY = e.clientY;
    const startT = Date.now();
    const move = (ev: PointerEvent) => y.set(Math.max(0, ev.clientY - startY));
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const dy = ev.clientY - startY;
      if (dy > 120 || (dy > 60 && dy / Math.max(Date.now() - startT, 1) > 0.6)) onClose();
      else void animate(y, 0, { type: 'spring', stiffness: 500, damping: 40 });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return { ref, y, onHandlePointerDown };
}

export function Modal({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  return <AnimatePresence>{open && <Sheet onClose={onClose} title={title}>{children}</Sheet>}</AnimatePresence>;
}

function Sheet({ onClose, children, title }: { onClose: () => void; children: ReactNode; title?: string }) {
  const swipe = useSwipeToClose(onClose);
  // Hintergrund wird beim Ziehen heller
  const backdrop = useTransform(swipe.y, [0, 400], [1, 0.2]);
  return (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div className="absolute inset-0 bg-black/45" style={{ opacity: backdrop }} aria-hidden />
          <motion.div
            ref={swipe.ref}
            style={{ y: swipe.y }}
            role="dialog"
            aria-modal
            aria-label={title ? plainMath(title) : undefined}
            // safe-area-Abstand zusätzlich zum normalen Innenabstand (sonst klebt der Button unten und sein 3D-Schatten wird abgeschnitten)
            className="relative max-h-[92dvh] w-full overscroll-contain max-w-md overflow-y-auto rounded-t-3xl bg-surface p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl"
            initial={{ y: 60, opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            variants={{ out: () => ({ y: Math.max(swipe.y.get() + 160, 80), opacity: 0, transition: { duration: 0.2 } }) }}
            exit="out"
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="-mx-5 -mt-5 mb-1 flex cursor-grab touch-none justify-center pb-2 pt-3 active:cursor-grabbing sm:hidden" onPointerDown={swipe.onHandlePointerDown} aria-hidden>
              <div className="h-1.5 w-12 rounded-full bg-line" />
            </div>
            {title && <h2 className="mb-3 text-xl font-black"><MathText text={title} /></h2>}
            {children}
          </motion.div>
        </motion.div>
  );
}

export function Toast({ message, kind = 'info' }: { message: string | null; kind?: 'info' | 'error' | 'success' }) {
  const cls = kind === 'error' ? 'bg-error text-white' : kind === 'success' ? 'bg-success text-white' : 'bg-ink text-surface';
  return (
    <AnimatePresence>
      {message && (
        <motion.div className={`fixed left-1/2 top-4 z-[60] max-w-[90vw] -translate-x-1/2 rounded-2xl px-4 py-3 text-sm font-bold shadow-xl ${cls}`} initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -40, opacity: 0 }}>
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between px-1">
      <h2 className="text-lg font-black">{children}</h2>
      {action}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; color?: string }[] }) {
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1" role="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={`shrink-0 rounded-2xl border-2 px-3.5 py-1.5 text-sm font-extrabold transition-colors ${active ? 'text-white' : 'border-line bg-surface text-muted'}`}
            style={active ? { background: o.color ?? 'var(--c-primary)', borderColor: o.color ?? 'var(--c-primary)' } : undefined}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

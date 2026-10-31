import { motion } from 'motion/react';
import { useMemo } from 'react';
import type { Slider } from '@lernquest/shared';
import { Icon } from './icons.tsx';
import { sfx } from '../lib/sound.ts';

/** Zahl hübsch formatieren (de-DE, große Zahlen kompakt lesbar). */
export function fmtNum(v: number): string {
  const abs = Math.abs(v);
  const digits = abs >= 100 || Number.isInteger(v) ? 0 : abs >= 10 ? 1 : 2;
  return v.toLocaleString('de-DE', { maximumFractionDigits: digits });
}

/** Regler-Mapping: Position 0…1000 ↔ Wert (linear oder logarithmisch, auf step bzw. 2 signifikante Stellen gerundet). */
export function useSliderScale(s: Slider) {
  return useMemo(() => {
    const STEPS = 1000;
    const clamp = (v: number) => Math.min(s.max, Math.max(s.min, v));
    if (s.scale === 'log') {
      const a = Math.log(s.min);
      const b = Math.log(s.max);
      const nice = (v: number) => {
        const p = 10 ** (Math.floor(Math.log10(v)) - 1);
        return clamp(Math.max(s.step, Math.round(v / p) * p));
      };
      return {
        toValue: (pos: number) => nice(Math.exp(a + (pos / STEPS) * (b - a))),
        toPos: (v: number) => (Math.log(clamp(v)) - a) / (b - a) * STEPS,
        STEPS,
      };
    }
    const n = Math.round((s.max - s.min) / s.step);
    return {
      toValue: (pos: number) => clamp(+(s.min + Math.round((pos / STEPS) * n) * s.step).toFixed(6)),
      toPos: (v: number) => ((clamp(v) - s.min) / (s.max - s.min)) * STEPS,
      STEPS,
    };
  }, [s]);
}

/** Schätz-/Zahlenfrage mit Schieberegler und ± Feinjustierung. */
export function EstimateInput({ slider, value, onChange, reveal, correct }: { slider: Slider; value: number | null; onChange: (v: number) => void; reveal: boolean; correct: boolean }) {
  const scale = useSliderScale(slider);
  const start = scale.toValue(scale.STEPS / 2);
  const v = value ?? start;
  const pos = scale.toPos(v);
  const nudge = (dir: 1 | -1) => {
    sfx.tick();
    if (slider.scale === 'log') onChange(scale.toValue(Math.min(scale.STEPS, Math.max(0, pos + dir * 10))));
    else onChange(Math.min(slider.max, Math.max(slider.min, +(v + dir * slider.step).toFixed(6))));
  };
  const lo = scale.toPos(slider.answer - slider.tolerance) / 10;
  const hi = scale.toPos(slider.answer + slider.tolerance) / 10;
  const ans = scale.toPos(slider.answer) / 10;

  return (
    <div className="rounded-3xl border-2 border-line bg-surface p-4 shadow-[0_4px_0_var(--c-border)]">
      <div className="flex items-center justify-center gap-3">
        <button type="button" aria-label="weniger" disabled={reveal} onClick={() => nudge(-1)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border-2 border-line bg-surface-2 text-2xl font-black text-muted disabled:opacity-40">
          −
        </button>
        <motion.div key={reveal ? 'r' : 'e'} initial={{ scale: 0.9 }} animate={{ scale: 1 }} className={`min-w-0 flex-1 text-center ${value === null ? 'text-muted' : reveal ? (correct ? 'text-success' : 'text-error') : 'text-primary'}`}>
          <span className="text-4xl font-black tabular-nums" aria-live="polite">
            {value === null ? '?' : fmtNum(v)}
          </span>
          {slider.unit && <span className="ml-1.5 text-lg font-extrabold">{slider.unit}</span>}
        </motion.div>
        <button type="button" aria-label="mehr" disabled={reveal} onClick={() => nudge(1)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border-2 border-line bg-surface-2 text-2xl font-black text-muted disabled:opacity-40">
          +
        </button>
      </div>

      <div className="relative mt-5 h-10">
        {/* Spur */}
        <div className="absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-full bg-locked" />
        <div className="absolute left-0 top-1/2 h-3 -translate-y-1/2 rounded-full bg-primary/70" style={{ width: `${pos / 10}%` }} />
        {reveal && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute top-1/2 h-5 -translate-y-1/2 rounded-full bg-success/60" style={{ left: `${lo}%`, width: `${Math.max(1.2, hi - lo)}%` }} />
            <motion.div initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="absolute -top-1 -translate-x-1/2 text-success" style={{ left: `${ans}%` }} aria-hidden>
              <Icon name="star" size={18} fill="currentColor" weight={1.5} />
            </motion.div>
          </>
        )}
        <input
          type="range"
          min={0}
          max={scale.STEPS}
          step={1}
          value={pos}
          disabled={reveal}
          aria-label="Schätzwert"
          aria-valuetext={`${fmtNum(v)} ${slider.unit ?? ''}`}
          onChange={(e) => {
            sfx.tick();
            onChange(scale.toValue(Number(e.target.value)));
          }}
          className="lq-range absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent"
        />
      </div>
      <div className="mt-1 flex justify-between text-xs font-extrabold text-muted">
        <span>{fmtNum(slider.min)}</span>
        {slider.scale === 'log' && <span>logarithmisch</span>}
        <span>{fmtNum(slider.max)}</span>
      </div>
    </div>
  );
}

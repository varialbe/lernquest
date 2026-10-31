/** Kleine synthetische Sounds (WebAudio, keine Dateien) + Haptik (iOS-App) bzw. Vibration. */
import { haptic } from './native.ts';

let ctx: AudioContext | null = null;
let out: AudioNode | null = null;
let muted = localStorage.getItem('lq.muted') === '1';

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  localStorage.setItem('lq.muted', m ? '1' : '0');
}

/** Gemeinsamer Ausgang: Kompressor, damit überlagerte Sounds nicht übersteuern. */
function bus(c: AudioContext) {
  if (out) return out;
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  const master = c.createGain();
  master.gain.value = 0.9;
  comp.connect(master).connect(c.destination);
  out = comp;
  return out;
}

type ToneOpts = { type?: OscillatorType; gain?: number; glide?: number; attack?: number };
/** Ein Ton mit weicher Hüllkurve; `glide` zieht die Tonhöhe bis zum Ende auf diese Frequenz. */
function tone(freq: number, start: number, dur: number, typeOrOpts: OscillatorType | ToneOpts = 'sine', gainArg = 0.16) {
  if (!ctx) return;
  const o2: ToneOpts = typeof typeOrOpts === 'string' ? { type: typeOrOpts, gain: gainArg } : typeOrOpts;
  const t0 = ctx.currentTime + start;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = o2.type ?? 'sine';
  o.frequency.setValueAtTime(freq, t0);
  if (o2.glide) o.frequency.exponentialRampToValueAtTime(o2.glide, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o2.gain ?? 0.16, t0 + (o2.attack ?? 0.015));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(bus(ctx));
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

/** Kurzes gefiltertes Rauschen (Whoosh, Glitzer) */
function noise(start: number, dur: number, { from = 800, to = 4000, gain = 0.05, q = 1.2 } = {}) {
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const len = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(from, t0);
  f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(bus(ctx));
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

function play(fn: () => void) {
  if (muted) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    fn();
  } catch {
    /* kein Audio verfügbar */
  }
}

/** Halbtonschritte über einer Grundfrequenz */
const st = (base: number, semis: number) => base * 2 ** (semis / 12);
let lastTick = -Infinity;

export const sfx = {
  tap: () => play(() => tone(660, 0, 0.05, 'triangle', 0.06)),
  /** Auswahl einer Antwort – etwas weicher als tap */
  select: () => {
    play(() => tone(520, 0, 0.06, { type: 'sine', gain: 0.07, glide: 640 }));
    void haptic('tap');
  },
  /** Richtig – mit jeder Combo einen Halbton höher (max. eine Oktave) */
  correct: (combo = 1) => {
    const up = Math.min(12, Math.max(0, combo - 1));
    play(() => {
      tone(st(784, up), 0, 0.12, 'triangle');
      tone(st(1175, up), 0.09, 0.18, 'triangle');
      if (combo >= 3) tone(st(1568, up), 0.17, 0.22, { type: 'sine', gain: 0.07 });
    });
    void haptic('success');
  },
  wrong: () => {
    play(() => {
      tone(220, 0, 0.16, 'square', 0.07);
      tone(175, 0.12, 0.22, 'square', 0.07);
    });
    void haptic('error');
  },
  /** Combo-Meilenstein (3, 5, 10 …) */
  combo: (n: number) =>
    play(() => {
      noise(0, 0.25, { from: 600, to: 5000, gain: 0.035 });
      [0, 4, 7, 12].forEach((s, i) => tone(st(659 + Math.min(n, 10) * 12, s), 0.04 + i * 0.05, 0.16, { type: 'triangle', gain: 0.07 }));
    }),
  complete: () =>
    play(() => {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.22, 'triangle', 0.14));
      tone(1319, 0.42, 0.4, 'sine', 0.1);
    }),
  coin: () => play(() => [988, 1319].forEach((f, i) => tone(f, i * 0.07, 0.12, 'square', 0.05))),
  /** Stern i (1–3) im Abschlussbildschirm – aufsteigend */
  star: (i: number) =>
    play(() => {
      tone(st(880, [0, 4, 7][i - 1] ?? 0), 0, 0.2, { type: 'triangle', gain: 0.15 });
      tone(st(1760, [0, 4, 7][i - 1] ?? 0), 0.02, 0.28, { type: 'sine', gain: 0.06 });
    }),
  /** Streak verlängert – warmer Akkord mit „Flamme“ */
  streak: () =>
    play(() => {
      noise(0, 0.5, { from: 300, to: 1800, gain: 0.04, q: 0.8 });
      [392, 494, 587].forEach((f) => tone(f, 0.05, 0.6, { type: 'triangle', gain: 0.07, attack: 0.06 }));
      tone(784, 0.3, 0.5, { type: 'sine', gain: 0.06 });
    }),
  /** Pet entwickelt sich – Glitzer-Arpeggio */
  evolve: () =>
    play(() => {
      noise(0, 1.1, { from: 2000, to: 9000, gain: 0.03, q: 2 });
      [0, 4, 7, 11, 12, 16, 19, 24].forEach((s, i) => tone(st(523, s), i * 0.08, 0.35, { type: 'triangle', gain: 0.08 }));
      tone(st(523, 24), 0.7, 0.9, { type: 'sine', gain: 0.08 });
    }),
  /** Abzeichen freigeschaltet */
  achievement: () =>
    play(() => {
      tone(1047, 0, 0.3, { type: 'sine', gain: 0.09 });
      tone(1319, 0.08, 0.3, { type: 'sine', gain: 0.08 });
      tone(1568, 0.16, 0.5, { type: 'sine', gain: 0.08 });
      noise(0.1, 0.4, { from: 4000, to: 9000, gain: 0.02, q: 3 });
    }),
  /** Tagesaufgabe eingelöst */
  claim: () =>
    play(() => {
      [1175, 1568, 1976].forEach((f, i) => tone(f, i * 0.06, 0.14, 'square', 0.04));
      noise(0.05, 0.3, { from: 3000, to: 8000, gain: 0.025, q: 2 });
    }),
  duelWin: () =>
    play(() => {
      [523, 659, 784].forEach((f, i) => tone(f, i * 0.11, 0.18, { type: 'square', gain: 0.05 }));
      [1047, 1319].forEach((f) => tone(f, 0.36, 0.6, { type: 'triangle', gain: 0.08 }));
    }),
  duelLose: () =>
    play(() => {
      tone(392, 0, 0.25, { type: 'triangle', gain: 0.07, glide: 330 });
      tone(330, 0.22, 0.45, { type: 'triangle', gain: 0.07, glide: 262 });
    }),
  /** Schieberegler – leises Klicken, gedrosselt */
  tick: () => {
    const now = performance.now();
    if (now - lastTick < 45) return;
    lastTick = now;
    play(() => tone(1800, 0, 0.02, { type: 'square', gain: 0.05, attack: 0.002 }));
  },
  /** Letzte Sekunden im Klausur-Check */
  clock: (urgent: boolean) => play(() => tone(urgent ? 1320 : 990, 0, 0.05, { type: 'sine', gain: urgent ? 0.07 : 0.04, attack: 0.003 })),
  /** Wechsel zur nächsten Frage */
  whoosh: () => play(() => noise(0, 0.18, { from: 400, to: 2400, gain: 0.09 })),
};

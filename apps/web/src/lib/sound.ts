/** Kleine synthetische Sounds (WebAudio, keine Dateien) + Vibration, wo verfügbar. */
let ctx: AudioContext | null = null;
let muted = localStorage.getItem('lq.muted') === '1';

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  localStorage.setItem('lq.muted', m ? '1' : '0');
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.16) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, ctx.currentTime + start);
  g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + start);
  o.stop(ctx.currentTime + start + dur + 0.02);
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

export const sfx = {
  tap: () => play(() => tone(660, 0, 0.05, 'triangle', 0.06)),
  correct: () => {
    play(() => {
      tone(784, 0, 0.12, 'triangle');
      tone(1175, 0.09, 0.18, 'triangle');
    });
    navigator.vibrate?.(18);
  },
  wrong: () => {
    play(() => {
      tone(220, 0, 0.16, 'square', 0.07);
      tone(175, 0.12, 0.22, 'square', 0.07);
    });
    navigator.vibrate?.([40, 40, 40]);
  },
  complete: () =>
    play(() => {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.22, 'triangle', 0.14));
      tone(1319, 0.42, 0.4, 'sine', 0.1);
    }),
  coin: () => play(() => [988, 1319].forEach((f, i) => tone(f, i * 0.07, 0.12, 'square', 0.05))),
};

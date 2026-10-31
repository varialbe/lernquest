import confetti from 'canvas-confetti';

/** Dezente Partikel-Effekte. Bei „Bewegung reduzieren“ (System) passiert nichts. */
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Mittelpunkt eines Elements (oder einer vorher gemerkten Position) als confetti-Origin (0–1) */
function originOf(el: Element | DOMRect | null | undefined, fallback = { x: 0.5, y: 0.7 }) {
  if (!el) return fallback;
  const r = el instanceof DOMRect ? el : el.getBoundingClientRect();
  if (!r.width && !r.height) return fallback;
  return { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight };
}

const GOLD = ['#ffe27a', '#f5b301', '#ffd23f', '#fff3b0'];

export const fx = {
  /** Richtig beantwortet – kleine Konfetti-Wolke, mit Combo etwas mehr */
  correct(combo: number) {
    if (reduced()) return;
    void confetti({
      particleCount: Math.min(40 + combo * 8, 90),
      spread: 60 + Math.min(combo, 6) * 5,
      startVelocity: 28,
      origin: { y: 0.82 },
      scalar: 0.8,
      colors: ['#22c55e', '#7c5cff', '#f5b301', '#38bdf8'],
      disableForReducedMotion: true,
    });
  },
  /** Combo-Meilenstein – Funken in Flammenfarben von oben rechts (Combo-Anzeige) */
  combo(el?: Element | null) {
    if (reduced()) return;
    const origin = originOf(el, { x: 0.85, y: 0.06 });
    void confetti({ particleCount: 26, spread: 100, startVelocity: 18, gravity: 0.9, ticks: 90, scalar: 0.6, shapes: ['circle'], colors: ['#ff8a3d', '#ffb347', '#ffd23f', '#ff5f6d'], origin, disableForReducedMotion: true });
  },
  /** Münzen springen aus einem Element (Tagesaufgabe einlösen) */
  coins(el?: Element | DOMRect | null) {
    if (reduced()) return;
    const origin = originOf(el);
    void confetti({ particleCount: 18, spread: 70, startVelocity: 22, gravity: 1.1, ticks: 80, scalar: 0.9, shapes: ['circle'], colors: GOLD, origin, disableForReducedMotion: true });
  },
  /** Sterne-Glitzer (Pet-Entwicklung, Abzeichen) */
  sparkle(el?: Element | null, big = false) {
    if (reduced()) return;
    const origin = originOf(el, { x: 0.5, y: 0.5 });
    const opts = { spread: 360, startVelocity: big ? 26 : 16, gravity: 0.4, ticks: big ? 140 : 90, decay: 0.92, shapes: ['star'] as confetti.Shape[], colors: GOLD, origin, disableForReducedMotion: true };
    void confetti({ ...opts, particleCount: big ? 40 : 18, scalar: 1.1 });
    void confetti({ ...opts, particleCount: big ? 20 : 8, scalar: 0.6 });
  },
  /** Seitliche Kanonen (Level fertig, Duell gewonnen) */
  celebrate() {
    if (reduced()) return;
    const fire = (x: number) => confetti({ particleCount: 70, angle: x < 0.5 ? 60 : 120, spread: 70, origin: { x, y: 0.7 }, colors: ['#7c5cff', '#22c55e', '#f5b301', '#38bdf8', '#f472b6'], disableForReducedMotion: true });
    void fire(0.1);
    void fire(0.9);
  },
};

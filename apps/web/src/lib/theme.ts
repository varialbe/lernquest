import { MODULE_INFO, THEMES, type ModuleId } from '@lernquest/shared';

/**
 * Farbschema aus dem Shop. Mit Standard-Theme bekommt jedes Modul seine eigene Farbe;
 * mit einem gekauften Theme färbt sich der ganze Lernpfad in der Theme-Farbe (sonst sähe man den Wechsel kaum).
 */
const KEY = 'lq.theme';
const current = () => document.documentElement.dataset.theme ?? 'default';

export const moduleColor = (m: ModuleId) => (current() !== 'default' && THEMES[current()] ? 'var(--c-primary)' : MODULE_INFO[m].color);

/** Aktuelle Hauptfarbe als Hex (für Canvas/Konfetti, die keine CSS-Variablen kennen) */
export const primaryHex = () => THEMES[current()]?.primary ?? THEMES.default!.primary;

/** Theme setzen, merken (kein Aufblitzen in Lila beim nächsten Start) und die Statusleisten-Farbe anpassen. */
export function applyTheme(theme: string) {
  const t = THEMES[theme] ? theme : 'default';
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* privater Modus */
  }
  document.querySelector('meta[name="theme-color"][media*="light"]')?.setAttribute('content', THEMES[t]!.primary);
}

/** Beim Start, bevor /api/me geladen ist */
export function restoreTheme() {
  try {
    const t = localStorage.getItem(KEY);
    if (t) applyTheme(t);
  } catch {
    /* egal */
  }
}

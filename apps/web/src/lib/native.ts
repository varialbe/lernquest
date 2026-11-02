import { Capacitor } from '@capacitor/core';
import type { AppUpdateManifest } from '@lernquest/shared';

/** Läuft die App als iOS-App (Capacitor)? Im Browser/PWA sind alle Funktionen hier No-ops. */
export const isNative = Capacitor.isNativePlatform();

const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';
/** Version dieses Web-Builds; identisch mit der Version des Live-Update-Pakets */
export const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'dev';
const STARTED = Date.now();

// ---------- Haptik ----------
// iOS-App: Capacitor-Haptics (UIKit-Feedback-Generatoren). Bisher wurde für jeden Tap ein neuer Generator ohne prepare()
// erzeugt und nach Hintergrund/Mitteilung nie neu initialisiert. Unterbricht iOS die Audio-/Haptik-Sitzung der App
// (Mitteilungston, Anruf, Kontrollzentrum), bleiben diese Feedbacks danach oft stumm.
// Jetzt: ein vorbereiteter Selection-Generator, der bei jeder Rückkehr neu angelegt wird, plus Fallback auf vibrate().
// Browser/PWA: navigator.vibrate gibt es auf dem iPhone nicht – dort löst ab iOS 18 ein verstecktes
// <input type="checkbox" switch> beim Umschalten das System-Haptik-Feedback aus (nur innerhalb einer Nutzergeste).
type HapticKind = 'tap' | 'success' | 'error';
type HapticsApi = typeof import('@capacitor/haptics');
let hapticsApi: Promise<HapticsApi> | null = null;
let selectionReady = false;
let lastHapticFail = 0;

function nativeHaptics() {
  hapticsApi ??= import('@capacitor/haptics');
  return hapticsApi;
}

/** Bei Rückkehr in die App / erster Berührung: Generator neu anlegen und vorbereiten (weckt die Taptic Engine). */
export function reviveHaptics() {
  if (isNative) {
    void nativeHaptics()
      .then(async ({ Haptics }) => {
        await Haptics.selectionEnd().catch(() => {});
        await Haptics.selectionStart();
        selectionReady = true;
      })
      .catch(() => {
        selectionReady = false;
      });
  } else switchEl = null; // WebKit kann das Element nach dem Hintergrund verwerfen → neu anlegen
}

let switchEl: HTMLLabelElement | null = null;
const switchSupported = () => typeof document !== 'undefined' && /iP(hone|ad|od)|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;
function switchTick(times = 1) {
  if (!switchEl?.isConnected) {
    const label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    label.appendChild(input);
    document.body.appendChild(label);
    switchEl = label;
  }
  for (let i = 0; i < times; i++) switchEl.click();
}

export async function haptic(kind: HapticKind) {
  if (!isNative) {
    if (navigator.vibrate) navigator.vibrate(kind === 'error' ? [40, 40, 40] : kind === 'success' ? 18 : 6);
    else if (switchSupported()) {
      // synchron, damit es noch innerhalb der Geste passiert
      try {
        switchTick(kind === 'error' ? 2 : 1);
      } catch {
        /* egal */
      }
    }
    return;
  }
  try {
    const { Haptics, ImpactStyle, NotificationType } = await nativeHaptics();
    if (kind === 'tap') {
      if (!selectionReady) {
        await Haptics.selectionStart();
        selectionReady = true;
      }
      await Haptics.selectionChanged();
    } else {
      await Haptics.notification({ type: kind === 'success' ? NotificationType.Success : NotificationType.Error });
      if (kind === 'error') await Haptics.impact({ style: ImpactStyle.Medium });
    }
  } catch (e) {
    selectionReady = false;
    // Fallback: vibrate() startet jedes Mal eine frische Haptik-Engine
    try {
      const { Haptics } = await nativeHaptics();
      await Haptics.vibrate({ duration: kind === 'tap' ? 10 : 30 });
    } catch {
      /* keine Haptik verfügbar */
    }
    if (Date.now() - lastHapticFail > 60_000) {
      lastHapticFail = Date.now();
      void reportUpdateError('haptic', e);
    }
  }
}

// ---------- Live-Updates ----------
let checking = false;
let stage: 'manifest' | 'plugin' | 'download' | 'activate' = 'manifest';

function reportUpdateError(where: string, e: unknown) {
  const error = e instanceof Error ? e.message : String(e);
  return fetch(`${BASE}/api/app/diag`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: APP_VERSION, stage: where, error: error.slice(0, 500) }),
  }).catch(() => {});
}
/**
 * Holt das neueste Web-Paket vom eigenen Server (Manifest über /api/app/update, ZIP unter /app-updates/).
 * Direkt nach dem Start wird es sofort aktiviert (die App lädt einmal neu), sonst beim nächsten Wechsel in den Hintergrund.
 * Startet ein Paket nicht sauber, rollt der Updater automatisch zurück (notifyAppReady fehlt dann).
 */
export async function checkForUpdate() {
  if (!isNative || checking) return;
  checking = true;
  stage = 'manifest';
  try {
    const res = await fetch(`${BASE}/api/app/update`, { cache: 'no-store' });
    if (!res.ok) return;
    const latest = (await res.json()) as AppUpdateManifest;
    if (!latest.version || latest.version === APP_VERSION) return;
    stage = 'plugin';
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
    const { bundles } = await CapacitorUpdater.list();
    let bundle = bundles.find((b) => b.version === latest.version && b.status !== 'error' && b.status !== 'deleted');
    stage = 'download';
    // Prüfsumme ist Pflicht (SHA-256 der ZIP, hex) – ohne sie bricht das Plugin vor dem Download ab
    bundle ??= await CapacitorUpdater.download({ url: latest.url.startsWith('http') ? latest.url : `${BASE}${latest.url}`, version: latest.version, checksum: latest.checksum });
    stage = 'activate';
    if (Date.now() - STARTED < 8000) await CapacitorUpdater.set({ id: bundle.id });
    else await CapacitorUpdater.next({ id: bundle.id });
    // alte Pakete aufräumen
    for (const b of bundles) if (b.id !== bundle.id && b.version !== APP_VERSION && b.id !== 'builtin') void CapacitorUpdater.delete({ id: b.id }).catch(() => {});
  } catch (e) {
    // offline → still; alles andere an den Server melden, damit es nicht wieder unbemerkt hängt
    if (stage !== 'manifest') void reportUpdateError(stage, e);
  } finally {
    checking = false;
  }
}

// ---------- Start ----------
export async function initNative(onResume: () => void) {
  if (!isNative) return;
  const [{ CapacitorUpdater }, { App }, { StatusBar, Style }] = await Promise.all([import('@capgo/capacitor-updater'), import('@capacitor/app'), import('@capacitor/status-bar')]);
  await CapacitorUpdater.notifyAppReady();
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const applyBar = () => void StatusBar.setStyle({ style: dark.matches ? Style.Dark : Style.Light }).catch(() => {});
  applyBar();
  dark.addEventListener('change', applyBar);
  reviveHaptics();
  void App.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) return;
    reviveHaptics();
    onResume();
    void checkForUpdate();
  });
  void checkForUpdate();
}

// ---------- Lokale Erinnerungen (iOS-App: Web-Push gibt es dort nicht) ----------
const REMINDER_KEY = 'lq.localReminders';
const REMINDER_IDS = [101, 102, 103, 104, 105, 106, 107];
export const localRemindersOn = () => {
  try {
    return localStorage.getItem(REMINDER_KEY) === '1';
  } catch {
    return false;
  }
};

export async function setLocalReminders(on: boolean) {
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  if (on) {
    const p = await LocalNotifications.requestPermissions();
    if (p.display !== 'granted') throw new Error('Mitteilungen sind für LernQuest aus – in den iOS-Einstellungen erlauben.');
  }
  localStorage.setItem(REMINDER_KEY, on ? '1' : '0');
  if (!on) await LocalNotifications.cancel({ notifications: REMINDER_IDS.map((id) => ({ id })) });
}

const RECAP_ID = 120;
/**
 * Wochenrückblick in der iOS-App: lokale Mitteilung am nächsten Sonntag 18 Uhr, Inhalt von GET /api/recap.
 * Wird bei jedem Öffnen neu geplant, der Inhalt ist also der Stand des letzten Öffnens.
 */
let recapPlanned: { on: boolean; at: number } | null = null;
export async function scheduleRecap(on: boolean, force = false) {
  if (!isNative) return;
  // höchstens alle 30 min neu planen (me ändert sich nach jedem Level)
  if (!force && recapPlanned?.on === on && Date.now() - recapPlanned.at < 30 * 60_000) return;
  recapPlanned = { on, at: Date.now() };
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  await LocalNotifications.cancel({ notifications: [{ id: RECAP_ID }] });
  if (!on || !localRemindersOn()) return;
  const { api } = await import('./api.ts');
  const r = await api<{ title: string; body: string }>('/api/recap');
  const now = new Date();
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((7 - now.getDay()) % 7), 18, 0, 0);
  if (at <= now) at.setDate(at.getDate() + 7);
  await LocalNotifications.schedule({ notifications: [{ id: RECAP_ID, title: r.title, body: r.body, schedule: { at } }] });
}

/** Plant die Abend-Erinnerung für die nächsten 7 Tage neu (heute nur, wenn das Tagesziel noch offen ist). */
export async function rescheduleReminders(s: { streak: number; todayXp: number; dailyGoal: number; hour?: number }) {
  if (!isNative || !localRemindersOn()) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  await LocalNotifications.cancel({ notifications: REMINDER_IDS.map((id) => ({ id })) });
  const hour = s.hour ?? 19;
  const now = new Date();
  const notifications = REMINDER_IDS.flatMap((id, day) => {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + day, hour, 0, 0);
    if (at <= now || (day === 0 && s.todayXp >= s.dailyGoal)) return [];
    const streak = day === 0 ? s.streak : 0;
    return [
      {
        id,
        title: streak > 0 ? `🔥 Dein ${streak}-Tage-Streak wartet!` : 'Zeit für eine kleine Runde 📚',
        body: streak > 0 ? 'Ein Level reicht, um ihn zu retten.' : 'Ein Level, ein paar Minuten – dein Pet freut sich.',
        schedule: { at },
      },
    ];
  });
  if (notifications.length) await LocalNotifications.schedule({ notifications });
}

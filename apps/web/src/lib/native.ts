import { Capacitor } from '@capacitor/core';
import type { AppUpdateManifest } from '@lernquest/shared';

/** Läuft die App als iOS-App (Capacitor)? Im Browser/PWA sind alle Funktionen hier No-ops. */
export const isNative = Capacitor.isNativePlatform();

const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';
/** Version dieses Web-Builds; identisch mit der Version des Live-Update-Pakets */
export const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'dev';
const STARTED = Date.now();

// ---------- Haptik ----------
export async function haptic(kind: 'tap' | 'success' | 'error') {
  if (!isNative) {
    navigator.vibrate?.(kind === 'error' ? [40, 40, 40] : kind === 'success' ? 18 : 6);
    return;
  }
  const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics');
  if (kind === 'tap') await Haptics.impact({ style: ImpactStyle.Light });
  else await Haptics.notification({ type: kind === 'success' ? NotificationType.Success : NotificationType.Error });
}

// ---------- Live-Updates ----------
let checking = false;
/**
 * Holt das neueste Web-Paket vom eigenen Server (Manifest über /api/app/update, ZIP unter /app-updates/).
 * Direkt nach dem Start wird es sofort aktiviert (die App lädt einmal neu), sonst beim nächsten Wechsel in den Hintergrund.
 * Startet ein Paket nicht sauber, rollt der Updater automatisch zurück (notifyAppReady fehlt dann).
 */
export async function checkForUpdate() {
  if (!isNative || checking) return;
  checking = true;
  try {
    const res = await fetch(`${BASE}/api/app/update`, { cache: 'no-store' });
    if (!res.ok) return;
    const latest = (await res.json()) as AppUpdateManifest;
    if (!latest.version || latest.version === APP_VERSION) return;
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
    const { bundles } = await CapacitorUpdater.list();
    let bundle = bundles.find((b) => b.version === latest.version && b.status !== 'error' && b.status !== 'deleted');
    bundle ??= await CapacitorUpdater.download({ url: latest.url.startsWith('http') ? latest.url : `${BASE}${latest.url}`, version: latest.version });
    if (Date.now() - STARTED < 8000) await CapacitorUpdater.set({ id: bundle.id });
    else await CapacitorUpdater.next({ id: bundle.id });
    // alte Pakete aufräumen
    for (const b of bundles) if (b.id !== bundle.id && b.version !== APP_VERSION && b.id !== 'builtin') void CapacitorUpdater.delete({ id: b.id }).catch(() => {});
  } catch {
    /* offline oder Server nicht erreichbar – nächster Versuch beim nächsten Öffnen */
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
  void App.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) return;
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

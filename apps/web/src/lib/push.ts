import { currentText } from '../i18n/common.ts';
import { api } from './api.ts';

const b64ToBytes = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) => !!a && a.byteLength === b.byteLength && new Uint8Array(a).every((x, i) => x === b[i]);

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Browser-Fehler beim Abonnieren in verständliche Hinweise übersetzen. */
function explain(e: unknown): Error {
  const name = e instanceof DOMException ? e.name : '';
  const msg = e instanceof Error ? e.message : String(e);
  if (name === 'AbortError' || /push service/i.test(msg)) {
    const brave = 'brave' in navigator;
    return new Error(
      brave
        ? currentText("Brave blockiert Push: brave://settings/privacy → „Google-Dienste für Push-Nachrichten verwenden“ aktivieren, Browser neu starten.")
        : currentText("Der Push-Dienst des Browsers ist nicht erreichbar (privates Fenster, Firewall/VPN oder deaktivierte Google-Dienste?). Versuch es in einem normalen Chrome-, Edge-, Firefox- oder Safari-Fenster."),
    );
  }
  if (name === 'NotAllowedError') return new Error(currentText("Benachrichtigungen sind für diese Seite blockiert – in den Website-Einstellungen erlauben."));
  return e instanceof Error ? e : new Error(msg);
}

/** Abendliche Streak-Erinnerung aktivieren (iOS: nur als installierte Web-App). */
export async function enablePush(vapidKey: string) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(currentText("Benachrichtigungen wurden nicht erlaubt."));
  const reg = await navigator.serviceWorker.ready;
  const key = b64ToBytes(vapidKey);
  // Altes Abo mit anderem Schlüssel (z. B. von einem früheren Build) blockiert sonst das neue
  const old = await reg.pushManager.getSubscription();
  if (old && !sameKey(old.options.applicationServerKey, key)) await old.unsubscribe();
  let sub: PushSubscription;
  try {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  } catch (e) {
    // Chrome meldet gelegentlich einmalig „push service error“ – ein zweiter Versuch klappt dann
    await new Promise((r) => setTimeout(r, 800));
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    } catch {
      throw explain(e);
    }
  }
  await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
  await sub.unsubscribe();
}

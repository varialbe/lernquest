import { api } from './api.ts';

const b64ToBytes = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Abendliche Streak-Erinnerung aktivieren (iOS: nur als installierte Web-App). */
export async function enablePush(vapidKey: string) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Benachrichtigungen wurden nicht erlaubt.');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapidKey) });
  await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
  await sub.unsubscribe();
}

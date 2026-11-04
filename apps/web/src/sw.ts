/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();
// Old API responses have no locale/authentication Vary headers. Do not reuse them.
self.addEventListener('activate', (event) => event.waitUntil(Promise.all(['lq-api', 'lq-api-v2'].map((name) => caches.delete(name)))));
cleanupOutdatedCaches();

// App-Shell + Assets (Bilder, Fonts, KaTeX, Mermaid-Chunks)
precacheAndRoute(self.__WB_MANIFEST);
// Basis-Pfad aus dem Scope ("/" oder "/lernen/")
const BASE = new URL(self.registration.scope).pathname;
registerRoute(new NavigationRoute(createHandlerBoundToURL(`${BASE}index.html`), { denylist: [new RegExp(`^${BASE}api/`)] }));

// Bereits geladene Level, Pfad und Profil offline verfügbar halten
// Cache.put replaces an existing URL even when its response varies by language.
// Give each session/language its own cache URL; network requests keep the real URL.
const localizedApiCache = {
  async cacheKeyWillBeUsed({ request }: { request: Request }) {
    const auth = request.headers.get('authorization') ?? '';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(auth));
    const session = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const locale = ['accept-language', 'x-lq-locale', 'x-lq-device-locale'].map((name) => request.headers.get(name) ?? '').join('|');
    const url = new URL(request.url);
    url.searchParams.set('__lq_session', session);
    url.searchParams.set('__lq_locale', locale);
    return new Request(url, request);
  },
};
registerRoute(
  ({ url, request }) => request.method === 'GET' && new RegExp(`^${BASE}api/(levels/|knowledge/|path$|me$|config$|shop$|practice$)`).test(url.pathname),
  new NetworkFirst({ cacheName: 'lq-api-v3', networkTimeoutSeconds: 4, plugins: [localizedApiCache] }),
);

// Web Push: Streak-Erinnerung
self.addEventListener('push', (event) => {
  const data = (() => {
    try {
      return event.data?.json() ?? {};
    } catch {
      return { title: 'LernQuest', body: event.data?.text() };
    }
  })() as { title?: string; body?: string; url?: string };
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'LernQuest', {
      body: data.body ?? (/^de/i.test(navigator.language) ? 'Zeit für eine kleine Lernrunde!' : 'Time for a short learning round!'),
      icon: `${BASE}app-icons/icon-192.png`,
      badge: `${BASE}app-icons/icon-192.png`,
      // Server-URLs sind relativ zur App ("/duels") → unter den Basis-Pfad hängen
      data: { url: `${BASE}${(data.url ?? '/').replace(/^\//, '')}` },
      tag: 'lq-reminder',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? BASE;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => 'focus' in w);
      if (win) return win.focus().then((w) => w.navigate(url));
      return self.clients.openWindow(url);
    }),
  );
});

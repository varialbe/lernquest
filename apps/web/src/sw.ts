/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();

// App-Shell + Assets (Bilder, Fonts, KaTeX, Mermaid-Chunks)
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));

// Bereits geladene Level, Pfad und Profil offline verfügbar halten
registerRoute(
  ({ url, request }) => request.method === 'GET' && /^\/api\/(levels\/|path$|me$|config$|shop$|practice$)/.test(url.pathname),
  new NetworkFirst({ cacheName: 'lq-api', networkTimeoutSeconds: 4 }),
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
      body: data.body ?? 'Zeit für eine kleine Lernrunde!',
      icon: '/app-icons/icon-192.png',
      badge: '/app-icons/icon-192.png',
      data: { url: data.url ?? '/' },
      tag: 'lq-reminder',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => 'focus' in w);
      if (win) return win.focus().then((w) => w.navigate(url));
      return self.clients.openWindow(url);
    }),
  );
});

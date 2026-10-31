import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { Router } from 'wouter';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App.tsx';
import { ApiError } from './lib/api.ts';
import { initAudioLifecycle } from './lib/sound.ts';
import { restoreTheme } from './lib/theme.ts';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
      refetchOnWindowFocus: true,
    },
  },
});

// Safari ignoriert user-scalable=no: Pinch-Zoom der ganzen Seite hier abfangen (Diagramm-Zoom läuft über Pointer-Events)
document.addEventListener('gesturestart', (e) => e.preventDefault());

restoreTheme();

// Sounds/Haptik nach Mitteilungen und Hintergrund wiederbeleben (iOS)
initAudioLifecycle();

// Service Worker nur im Web (nicht in der Capacitor-App)
if (!('Capacitor' in window)) registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <App />
      </Router>
    </QueryClientProvider>
  </StrictMode>,
);

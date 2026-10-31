import { defineConfig, devices } from '@playwright/test';

/** Läuft gegen `vite preview` (Proxy /api → lokale API) oder gegen BASE_URL (z. B. die echte Domain). */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:4173',
    ...devices['iPhone 14'],
    defaultBrowserType: 'chromium',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    serviceWorkers: 'block',
  },
  webServer: process.env.BASE_URL
    ? undefined
    : { command: 'npx vite preview --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: true, timeout: 60_000 },
});

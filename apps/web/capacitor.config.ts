import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'xyz.varialbe.lernquest',
  appName: 'LernQuest',
  webDir: 'dist',
  backgroundColor: '#f7f5ff',
  ios: { contentInset: 'never', scheme: 'App', limitsNavigationsToAppBoundDomains: false },
  plugins: {
    // Live-Updates ohne Cloud: die App fragt selbst /api/app/update (siehe src/lib/native.ts)
    // statsUrl '' = keine Telemetrie an Capgo-Server
    CapacitorUpdater: { autoUpdate: false, appReadyTimeout: 15000, resetWhenUpdate: true, statsUrl: '' },
    LocalNotifications: { presentationOptions: ['banner', 'sound'] },
  },
};

export default config;

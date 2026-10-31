import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'xyz.varialbe.lernquest',
  appName: 'LernQuest',
  webDir: 'dist',
  backgroundColor: '#f7f5ff',
  ios: { contentInset: 'never', scheme: 'App', limitsNavigationsToAppBoundDomains: false },
  plugins: {
    // Live-Updates ohne Cloud: die App fragt selbst /api/app/update (siehe src/lib/native.ts)
    CapacitorUpdater: { autoUpdate: false, appReadyTimeout: 15000, resetWhenUpdate: true },
    LocalNotifications: { presentationOptions: ['banner', 'sound'] },
  },
};

export default config;

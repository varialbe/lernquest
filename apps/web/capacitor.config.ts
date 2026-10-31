import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'xyz.varialbe.lernquest',
  appName: 'LernQuest',
  webDir: 'dist',
  backgroundColor: '#f7f5ff',
  ios: { contentInset: 'never', scheme: 'App', limitsNavigationsToAppBoundDomains: false },
};

export default config;

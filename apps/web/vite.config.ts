import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/** Basis-Pfad: '/' für lern.varialbe.xyz und die iOS-App, '/lernen/' für mateenbatt.de/lernen (deploy-web.sh) */
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2}'], maximumFileSizeToCacheInBytes: 6 * 1024 * 1024 },
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'LernQuest',
        short_name: 'LernQuest',
        description: 'Lerne DS, EIP und ERA spielerisch – jeden Tag ein bisschen.',
        lang: 'de',
        theme_color: '#7c5cff',
        background_color: '#f7f5ff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        id: base,
        icons: [
          { src: `${base}app-icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${base}app-icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
          { src: `${base}app-icons/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: { host: '127.0.0.1', port: 5173, proxy: { '/api': 'http://127.0.0.1:3460' } },
  preview: { host: '127.0.0.1', port: 4173, proxy: { '/api': 'http://127.0.0.1:3460' } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});

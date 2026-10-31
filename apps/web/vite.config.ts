import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
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
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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

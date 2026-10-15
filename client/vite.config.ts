/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'YASH MOBILE POS',
        short_name: 'YASH POS',
        description: 'Point of sale and inventory for YASH MOBILE',
        theme_color: '#0f3d91',
        background_color: '#f5f7fb',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // app shell only; API responses are never cached by the service worker
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/uploads/, /^\/install/],
      },
    }),
  ],
  server: {
    port: 5173,
    // the Laravel API (php artisan serve)
    proxy: { '/api': 'http://localhost:8000', '/uploads': 'http://localhost:8000' },
  },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'] },
});

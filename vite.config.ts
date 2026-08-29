import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

function guardPreloadHelperForWorkers(): Plugin {
  const PRELOAD_HELPER_ID = '\0vite/preload-helper.js';
  const CONDITION = 'deps && deps.length > 0';
  return {
    name: 'guard-preload-helper-for-workers',
    transform(code, id) {
      if (id !== PRELOAD_HELPER_ID || !code.includes(CONDITION)) return null;
      return code.replace(CONDITION, `typeof document !== "undefined" && ${CONDITION}`);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    guardPreloadHelperForWorkers(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'robots.txt'],
      manifest: {
        name: 'Cube Timer & Trainer',
        short_name: 'CubeTrainer',
        description: 'Next-gen CFOP Speedcubing Timer & Smart Cube Trainer',
        theme_color: '#101116',
        background_color: '#101116',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json,woff2}'],
      },
    }),
  ],
  optimizeDeps: {
    exclude: ['cubing'],
  },
  worker: {
    format: 'es',
  },
});

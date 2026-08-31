import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * NPPES and Overpass send no CORS headers, so browser dev goes through these
 * proxies. The Tauri build does not use them - it issues requests from Rust,
 * where CORS does not apply. See src/lib/http.ts for the switch.
 */
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api/nppes': {
        target: 'https://npiregistry.cms.hhs.gov',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/nppes/, '/api'),
      },
      '/api/overpass': {
        target: 'https://overpass-api.de',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/overpass/, '/api/interpreter'),
      },
    },
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
});

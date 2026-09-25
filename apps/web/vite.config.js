import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// المنفذ 5173 للواجهة، وكل طلب /api يُمرَّر لخادم التعبير على 4000
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: '0.0.0.0',
    port: Number(process.env.WEB_PORT || 5173),
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.API_URL || 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
      // توثيق الـ API — حتى يعمل رابط /openapi.json في وضع التطوير أيضاً
      '/openapi.json': {
        target: process.env.API_URL || 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});

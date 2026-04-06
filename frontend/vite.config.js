import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // REST API calls
      '/api': {
        target: 'http://localhost:80',
        changeOrigin: true,
      },
      // WebSocket is NOT proxied through Vite — Vite's WS proxy conflicts with
      // its own HMR socket. In dev, VITE_WS_BASE_URL points directly at Caddy.
    },
  },
});

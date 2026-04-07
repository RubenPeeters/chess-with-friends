import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { copyFileSync, existsSync } from 'fs';

// Copies stockfish.js from node_modules into public/ so it can be loaded as a Web Worker.
function copyStockfish() {
  const src  = 'node_modules/stockfish/src/stockfish.js';
  const dest = 'public/stockfish.js';
  return {
    name: 'copy-stockfish',
    buildStart() { if (existsSync(src)) copyFileSync(src, dest); },
    configureServer() { if (existsSync(src)) copyFileSync(src, dest); },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), copyStockfish()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:80',
        changeOrigin: true,
      },
    },
  },
});

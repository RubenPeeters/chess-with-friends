import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { copyFileSync, existsSync } from 'fs';

// Copies stockfish.js from node_modules into public/ so it can be loaded as a Web Worker.
function copyStockfish() {
  // Try both known locations across stockfish package versions
  const candidates = [
    'node_modules/stockfish/src/stockfish.js',
    'node_modules/stockfish/stockfish.js',
  ];
  const dest = 'public/stockfish.js';
  function copy() {
    for (const src of candidates) {
      if (existsSync(src)) { copyFileSync(src, dest); return; }
    }
    console.warn('[vite] stockfish.js not found in node_modules — engine analysis will be disabled');
  }
  return {
    name: 'copy-stockfish',
    buildStart()    { copy(); },
    configureServer() { copy(); },
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

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Copies the Stockfish 16 single-threaded WASM build (loader + .wasm + NNUE
 * weights) from node_modules into `public/stockfish/` so they're served by
 * Vite in dev and shipped in `dist/` for production.
 *
 * The single-threaded build is used because the multi-threaded build requires
 * COOP/COEP cross-origin-isolation headers, which Caddy isn't currently
 * configured to send. Single-threaded is slower but works in any browser
 * without server-side changes.
 *
 * Files are copied at plugin startup (so dev mode picks them up) and again on
 * `buildStart` (so production builds always have a fresh copy). The destination
 * directory is gitignored.
 */
function stockfishAssets() {
  const srcDir = path.resolve(__dirname, 'node_modules/stockfish/src');
  const destDir = path.resolve(__dirname, 'public/stockfish');
  const files = [
    'stockfish-nnue-16-single.js',
    'stockfish-nnue-16-single.wasm',
    'nn-5af11540bbfe.nnue',
  ];

  function copy() {
    if (!fs.existsSync(srcDir)) {
      console.warn('[stockfish-assets] node_modules/stockfish not found — run `npm install`');
      return;
    }
    fs.mkdirSync(destDir, { recursive: true });
    for (const f of files) {
      const from = path.join(srcDir, f);
      const to = path.join(destDir, f);
      if (!fs.existsSync(from)) {
        console.warn(`[stockfish-assets] missing source: ${from}`);
        continue;
      }
      // Skip if already up-to-date (same size + mtime) — avoids re-copying the
      // 39 MB NNUE file on every dev-server restart.
      try {
        const s = fs.statSync(from);
        const d = fs.statSync(to);
        if (s.size === d.size && s.mtimeMs === d.mtimeMs) continue;
      } catch { /* dest doesn't exist yet */ }
      fs.copyFileSync(from, to);
      fs.utimesSync(to, fs.statSync(from).atime, fs.statSync(from).mtime);
    }
  }

  return {
    name: 'stockfish-assets',
    buildStart: copy,
    configResolved: copy,
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), stockfishAssets()],
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

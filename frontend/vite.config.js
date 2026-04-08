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

  /**
   * @param {{ strict: boolean }} opts
   *   `strict: true` throws on missing files (used by `buildStart` so a
   *   broken production build fails fast instead of shipping a `dist/`
   *   without the engine). `strict: false` only warns (used by
   *   `configResolved` in dev so a still-installing node_modules doesn't
   *   block the dev server from starting).
   */
  function copy({ strict }) {
    if (!fs.existsSync(srcDir)) {
      const msg = `[stockfish-assets] node_modules/stockfish not found at ${srcDir} — run \`npm install\``;
      if (strict) throw new Error(msg);
      console.warn(msg);
      return;
    }
    fs.mkdirSync(destDir, { recursive: true });
    for (const f of files) {
      const from = path.join(srcDir, f);
      const to = path.join(destDir, f);
      if (!fs.existsSync(from)) {
        const msg = `[stockfish-assets] missing source file: ${from}`;
        if (strict) throw new Error(msg);
        console.warn(msg);
        continue;
      }
      // Skip if already up-to-date (same size + mtime) — avoids re-copying the
      // 39 MB NNUE file on every dev-server restart.
      const srcStat = fs.statSync(from);
      try {
        const destStat = fs.statSync(to);
        if (srcStat.size === destStat.size && srcStat.mtimeMs === destStat.mtimeMs) continue;
      } catch { /* dest doesn't exist yet */ }
      fs.copyFileSync(from, to);
      fs.utimesSync(to, srcStat.atime, srcStat.mtime);
    }
  }

  return {
    name: 'stockfish-assets',
    // Production builds must fail hard if the engine is missing — better
    // than silently shipping a `dist/` with a broken review screen.
    buildStart() { copy({ strict: true }); },
    // Dev startup is lenient: a partially installed node_modules shouldn't
    // prevent `npm run dev` from coming up.
    configResolved() { copy({ strict: false }); },
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

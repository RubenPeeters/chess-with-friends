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
  // Captured from `configResolved` and read by `buildStart`. Vite's plugin
  // model fires `buildStart` in BOTH `vite build` and `vite dev` (the dev
  // server runs the same Rollup hooks as a one-off bundler), so we can't
  // unconditionally treat `buildStart` as a "production only" signal.
  let isBuildCommand = false;

  const srcDir = path.resolve(__dirname, 'node_modules/stockfish/src');
  const destDir = path.resolve(__dirname, 'public/stockfish');
  // The NNUE filename hash (`nn-5af11540bbfe.nnue`) is the network-weights
  // file that ships with stockfish@16.0.0 specifically. `package.json` pins
  // stockfish to an exact version so it's stable today, but if you bump the
  // dep you MUST also update this filename (and probably the engine/wasm
  // names too) — `ls node_modules/stockfish/src/nn-*.nnue` to find the new
  // hash. The plugin's strict-mode check will fail the build loudly if this
  // ever drifts, so a stale entry won't ship silently.
  const files = [
    'stockfish-nnue-16-single.js',
    'stockfish-nnue-16-single.wasm',
    'nn-5af11540bbfe.nnue',
  ];

  /**
   * @param {{ strict: boolean }} opts
   *   `strict: true` throws on missing files (used in production builds so a
   *   broken `dist/` is never shipped). `strict: false` only warns (used in
   *   dev so a still-installing or partially-installed node_modules doesn't
   *   prevent the dev server from coming up).
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
    // configResolved fires once before any other hook in both serve and
    // build modes — record which command we're in so buildStart can branch.
    // The lenient copy here is enough to populate `public/stockfish/` for
    // the dev server (Vite serves anything in public/ as a static asset).
    configResolved(config) {
      isBuildCommand = config.command === 'build';
      copy({ strict: false });
    },
    // buildStart fires for `vite build` AND `vite dev`. Only enforce strict
    // in production builds so a broken `dist/` is never shipped; in dev,
    // stay lenient so a missing/partial node_modules doesn't kill startup.
    buildStart() { copy({ strict: isBuildCommand }); },
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

import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Runs Stockfish 16 NNUE (single-threaded WASM) as a Web Worker and exposes a
 * simple analyze(fen) API. Evaluation is always normalised to white's
 * perspective (positive = white better).
 *
 * The worker script and its sibling .wasm + .nnue files are copied from
 * `node_modules/stockfish/src/` into `public/stockfish/` by the
 * `stockfishAssets` Vite plugin (see `vite.config.js`) so they're served by
 * Vite in dev and shipped in `dist/` in production — no manual file copies,
 * no Dockerfile downloads.
 *
 * The single-threaded build is used because the multi-threaded build requires
 * COOP/COEP cross-origin-isolation headers, which Caddy isn't sending today.
 */
const STOCKFISH_URL = '/stockfish/stockfish-nnue-16-single.js';

export function useStockfish() {
  const workerRef  = useRef(null);
  const fenTurnRef = useRef('w'); // separate ref — Worker objects don't support custom props

  const [ready,      setReady]      = useState(false);
  const [evaluation, setEvaluation] = useState(null);

  useEffect(() => {
    let worker;
    try {
      worker = new Worker(STOCKFISH_URL);
    } catch (e) {
      console.warn(`[Stockfish] Could not load ${STOCKFISH_URL}:`, e);
      return;
    }
    workerRef.current = worker;

    worker.onerror = (e) => console.error('[Stockfish] Worker error:', e);

    worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data ?? '');

      // Step 2 of UCI handshake: engine identified itself, now ask if ready
      if (line === 'uciok') {
        worker.postMessage('isready');
        return;
      }

      // Step 3: engine is ready
      if (line === 'readyok') {
        setReady(true);
        return;
      }

      // Parse evaluation lines
      if (!line.startsWith('info')) return;
      const depthM = line.match(/\bdepth (\d+)/);
      if (!depthM) return;
      const depth = parseInt(depthM[1], 10);
      if (depth < 4) return; // skip noise from very shallow depths

      const turn   = fenTurnRef.current;
      const cpM    = line.match(/\bscore cp (-?\d+)/);
      const mateM  = line.match(/\bscore mate (-?\d+)/);

      if (cpM) {
        const raw = parseInt(cpM[1], 10);
        // Stockfish reports from side-to-move's perspective — normalise to white's
        setEvaluation({ cp: turn === 'b' ? -raw : raw, mate: null, depth });
      } else if (mateM) {
        const raw = parseInt(mateM[1], 10);
        setEvaluation({ cp: null, mate: turn === 'b' ? -raw : raw, depth });
      }
    };

    // Step 1 of UCI handshake
    worker.postMessage('uci');

    return () => {
      try { worker.postMessage('quit'); } catch {}
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const analyze = useCallback((fen) => {
    const worker = workerRef.current;
    if (!worker || !ready) return;

    fenTurnRef.current = fen.split(' ')[1] ?? 'w';

    // Don't clear evaluation to null here — the previous eval stays visible
    // until the new search's first depth-4+ info line overwrites it. This
    // avoids the jarring snap-to-center flash on every position change.

    // `ucinewgame` is intentionally NOT sent between positions: we're
    // analysing different positions of the same review session, not starting
    // a new game, and the prior `stop` is enough to abort any in-flight
    // search before submitting the new position.
    worker.postMessage('stop');
    worker.postMessage(`position fen ${fen}`);
    worker.postMessage('go depth 18');
  }, [ready]);

  return { analyze, evaluation, ready };
}

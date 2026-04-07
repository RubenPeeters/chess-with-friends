import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Runs Stockfish as a Web Worker and exposes a simple analyze(fen) API.
 * Evaluation is always normalised to white's perspective (positive = white better).
 *
 * Requires /stockfish.js in the public folder.
 * vite.config.js copies it from node_modules automatically.
 */
export function useStockfish() {
  const workerRef  = useRef(null);
  const fenTurnRef = useRef('w'); // separate ref — Worker objects don't support custom props

  const [ready,      setReady]      = useState(false);
  const [evaluation, setEvaluation] = useState(null);

  useEffect(() => {
    let worker;
    try {
      worker = new Worker('/stockfish.js');
    } catch (e) {
      console.warn('[Stockfish] Could not load /stockfish.js — does the file exist in public/?', e);
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
    setEvaluation(null);

    worker.postMessage('stop');
    worker.postMessage('ucinewgame');
    worker.postMessage(`position fen ${fen}`);
    worker.postMessage('go depth 18');
  }, [ready]);

  return { analyze, evaluation, ready };
}

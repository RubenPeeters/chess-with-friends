import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Evaluates chess positions using Stockfish running as a Web Worker.
 * Returns evaluation normalised to white's perspective (positive = white better).
 *
 * Requires /stockfish.js to be present in the public folder.
 * vite.config.js copies it from node_modules/stockfish/src/stockfish.js automatically.
 */
export function useStockfish() {
  const workerRef  = useRef(null);
  const readyRef   = useRef(false);
  const pendingRef = useRef(null); // fen queued before worker was ready

  const [ready,      setReady]      = useState(false);
  const [evaluation, setEvaluation] = useState(null);
  // evaluation: { cp: number|null, mate: number|null, depth: number }
  // cp is always from WHITE's perspective

  useEffect(() => {
    let worker;
    try {
      worker = new Worker('/stockfish.js');
    } catch {
      console.warn('[Stockfish] Could not load /stockfish.js');
      return;
    }
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data);

      if (line === 'readyok') {
        readyRef.current = true;
        setReady(true);
        if (pendingRef.current) {
          _send(`position fen ${pendingRef.current.fen}`);
          _send(`go depth 18`);
          pendingRef.current = null;
        }
        return;
      }

      // Parse eval lines: "info depth N ... score cp X ..." or "... score mate X ..."
      if (!line.startsWith('info')) return;
      const depthM = line.match(/\bdepth (\d+)/);
      if (!depthM) return;
      const depth = parseInt(depthM[1], 10);

      // Determine whose turn it was (stored alongside each analysis request)
      const fenTurn = workerRef.current._fenTurn ?? 'w';

      const cpM   = line.match(/\bscore cp (-?\d+)/);
      const mateM = line.match(/\bscore mate (-?\d+)/);

      if (cpM) {
        // Normalise: Stockfish always reports from side-to-move's perspective
        const rawCp = parseInt(cpM[1], 10);
        const cp    = fenTurn === 'b' ? -rawCp : rawCp;
        setEvaluation({ cp, mate: null, depth });
      } else if (mateM) {
        const rawMate = parseInt(mateM[1], 10);
        const mate    = fenTurn === 'b' ? -rawMate : rawMate;
        setEvaluation({ cp: null, mate, depth });
      }
    };

    worker.onerror = (err) => console.warn('[Stockfish] Worker error:', err);

    function _send(msg) { worker.postMessage(msg); }

    worker.postMessage('uci');
    worker.postMessage('isready');

    return () => {
      worker.postMessage('quit');
      worker.terminate();
      workerRef.current = null;
      readyRef.current  = false;
    };
  }, []);

  const analyze = useCallback((fen) => {
    if (!workerRef.current) return;
    setEvaluation(null);

    const turn = fen.split(' ')[1] ?? 'w';
    workerRef.current._fenTurn = turn;

    if (!readyRef.current) {
      pendingRef.current = { fen };
      return;
    }

    workerRef.current.postMessage('stop');
    workerRef.current.postMessage(`position fen ${fen}`);
    workerRef.current.postMessage('go depth 18');
  }, []);

  return { analyze, evaluation, ready };
}

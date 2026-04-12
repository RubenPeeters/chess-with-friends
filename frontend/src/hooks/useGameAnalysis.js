import { useEffect, useRef, useState } from 'react';

/**
 * Batch-analyse every position in a game and classify each move as
 * good / inaccuracy / mistake / blunder based on the eval delta.
 *
 * Spawns its own Stockfish worker (separate from the eval-bar worker) so
 * batch analysis and live cursor analysis don't compete for the same
 * engine instance.
 *
 * @param {{ san: string, fen: string }[] | null} moves — the game's move list
 * @returns {{
 *   annotations: Array<{ eval: {cp,mate,depth}, classification: string } | null>,
 *   summary: { white: {inaccuracies,mistakes,blunders}, black: {inaccuracies,mistakes,blunders} },
 *   progress: { done: number, total: number },
 *   isAnalyzing: boolean,
 * }}
 */

const STOCKFISH_URL = '/stockfish/stockfish-nnue-16-single.js';
const BATCH_DEPTH = 14;
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Thresholds (centipawns lost by the mover)
const INACCURACY_CP = 50;
const MISTAKE_CP = 150;
const BLUNDER_CP = 300;

/** Convert an eval to a pseudo-centipawn value for delta comparison.
 *  Mate evaluations are mapped to large values so they dominate any cp-based eval. */
function evalToCp(ev) {
  if (!ev) return 0;
  if (ev.mate !== null) {
    const sign = ev.mate > 0 ? 1 : -1;
    return sign * (30000 - Math.abs(ev.mate) * 100);
  }
  return ev.cp;
}

function classify(cpLoss) {
  if (cpLoss >= BLUNDER_CP) return 'blunder';
  if (cpLoss >= MISTAKE_CP) return 'mistake';
  if (cpLoss >= INACCURACY_CP) return 'inaccuracy';
  return 'good';
}

export function useGameAnalysis(moves) {
  const [annotations, setAnnotations] = useState([]);
  const [progress, setProgress]       = useState({ done: 0, total: 0 });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!moves || moves.length === 0) {
      setAnnotations([]);
      setProgress({ done: 0, total: 0 });
      setIsAnalyzing(false);
      return;
    }

    cancelRef.current = false;
    setAnnotations(new Array(moves.length).fill(null));
    setProgress({ done: 0, total: moves.length });
    setIsAnalyzing(true);

    let worker;
    try {
      worker = new Worker(STOCKFISH_URL);
    } catch {
      setIsAnalyzing(false);
      return;
    }

    // Positions to evaluate: starting position + one per move (N+1 total).
    // We need eval[i] and eval[i+1] to classify move i.
    const fens = [START_FEN, ...moves.map((m) => m.fen)];
    const evals = new Array(fens.length).fill(null);
    let posIdx = 0;       // which FEN we're currently analysing
    let bestEval = null;  // highest-depth eval seen for the current position

    function analyzePosition(idx) {
      if (cancelRef.current || idx >= fens.length) {
        finalize();
        return;
      }
      posIdx = idx;
      bestEval = null;
      const fen = fens[idx];
      const turn = fen.split(' ')[1] ?? 'w';
      worker._turn = turn;
      worker.postMessage('stop');
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage(`go depth ${BATCH_DEPTH}`);
    }

    function finalize() {
      // Compute annotations from the eval pairs
      const results = [];
      const summary = {
        white: { inaccuracies: 0, mistakes: 0, blunders: 0 },
        black: { inaccuracies: 0, mistakes: 0, blunders: 0 },
      };

      for (let i = 0; i < moves.length; i++) {
        const prevEv = evals[i];
        const currEv = evals[i + 1];

        if (!prevEv || !currEv) {
          results.push(null);
          continue;
        }

        const prevCp = evalToCp(prevEv);
        const currCp = evalToCp(currEv);
        const isWhiteMove = i % 2 === 0;

        // "loss" = how many centipawns the mover gave away.
        // White wants eval to go up; black wants it to go down.
        const loss = isWhiteMove ? (prevCp - currCp) : (currCp - prevCp);
        const cpLoss = Math.max(0, loss);
        const cls = classify(cpLoss);

        const side = isWhiteMove ? 'white' : 'black';
        if (cls === 'inaccuracy') summary[side].inaccuracies++;
        if (cls === 'mistake') summary[side].mistakes++;
        if (cls === 'blunder') summary[side].blunders++;

        results.push({ eval: currEv, classification: cls });
      }

      setAnnotations(results);
      setIsAnalyzing(false);
    }

    worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data ?? '');

      if (line === 'uciok') { worker.postMessage('isready'); return; }
      if (line === 'readyok') { analyzePosition(0); return; }

      // Parse eval from info lines
      if (line.startsWith('info')) {
        const depthM = line.match(/\bdepth (\d+)/);
        if (!depthM) return;
        const depth = parseInt(depthM[1], 10);
        if (depth < 4) return;

        const turn = worker._turn ?? 'w';
        const cpM  = line.match(/\bscore cp (-?\d+)/);
        const mateM = line.match(/\bscore mate (-?\d+)/);

        let ev = null;
        if (cpM) {
          const raw = parseInt(cpM[1], 10);
          ev = { cp: turn === 'b' ? -raw : raw, mate: null, depth };
        } else if (mateM) {
          const raw = parseInt(mateM[1], 10);
          ev = { cp: null, mate: turn === 'b' ? -raw : raw, depth };
        }
        if (ev && (!bestEval || depth > bestEval.depth)) {
          bestEval = ev;
        }
      }

      // `bestmove` signals the search is done for this position
      if (line.startsWith('bestmove')) {
        evals[posIdx] = bestEval;
        setProgress({ done: Math.min(posIdx, moves.length), total: moves.length });
        analyzePosition(posIdx + 1);
      }
    };

    worker.onerror = () => { setIsAnalyzing(false); };
    worker.postMessage('uci');

    return () => {
      cancelRef.current = true;
      try { worker.postMessage('quit'); } catch {}
      worker.terminate();
    };
  }, [moves]);

  const summary = (() => {
    const s = { white: { inaccuracies: 0, mistakes: 0, blunders: 0 }, black: { inaccuracies: 0, mistakes: 0, blunders: 0 } };
    annotations.forEach((a, i) => {
      if (!a) return;
      const side = i % 2 === 0 ? 'white' : 'black';
      if (a.classification === 'inaccuracy') s[side].inaccuracies++;
      if (a.classification === 'mistake') s[side].mistakes++;
      if (a.classification === 'blunder') s[side].blunders++;
    });
    return s;
  })();

  return { annotations, summary, progress, isAnalyzing };
}

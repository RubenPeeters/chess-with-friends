import { useState, useEffect } from 'react';
import { Board } from './Board.jsx';
import { EvalBar } from './EvalBar.jsx';
import { apiFetch } from '../api.js';
import { identifyOpening } from '../utils/openings.js';
import { useStockfish } from '../hooks/useStockfish.js';
import { useGameAnalysis } from '../hooks/useGameAnalysis.js';

/**
 * Render a finished game (or precomputed game data) with a review board, eval
 * bar, move list and engine analysis.
 *
 * Data source is one of:
 *   - `gameId`  — fetched from the social /history/:id endpoint (existing
 *     "review one of my own games" flow).
 *   - `data`    — a precomputed game object in the same shape the social
 *     /history/:id endpoint returns. Used by the PGN-paste flow, where the
 *     caller has already parsed the PGN via `utils/pgn.js#parsePgn`. Keeps
 *     parsing/validation outside this component so callers can surface errors
 *     in their own UI before navigating here.
 *
 * Pass exactly one.
 */
export function GameReview({ gameId, data: providedData, token, onClose, inline = false }) {
  const [data, setData]       = useState(providedData ?? null);
  const [cursor, setCursor]   = useState(0); // 0 = start, n = after move n
  const [loading, setLoading] = useState(!providedData);
  const [error, setError]     = useState('');
  const { analyze, evaluation, ready: sfReady } = useStockfish();
  const { annotations, summary, progress, isAnalyzing } = useGameAnalysis(inline ? data?.moves : null);

  useEffect(() => {
    setCursor(0);

    if (providedData) {
      // Caller already parsed/loaded the data — use it directly, no fetch.
      setData(providedData);
      setError('');
      setLoading(false);
      return;
    }

    if (gameId) {
      setLoading(true); setError(''); setData(null);
      apiFetch(`/api/social/history/${gameId}`, { token })
        .then((d) => { setData(d); setLoading(false); })
        .catch((e) => { setError(e.message); setLoading(false); });
      return;
    }

    setError('No game source provided');
    setLoading(false);
  }, [gameId, providedData, token]);

  // Trigger Stockfish analysis whenever the position changes (inline/page mode only)
  useEffect(() => {
    if (!inline || !sfReady || !data) return;
    const currentFen = cursor === 0 ? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' : data.moves[cursor - 1].fen;
    analyze(currentFen);
  }, [cursor, sfReady, data, inline, analyze]);

  // Keyboard navigation
  useEffect(() => {
    if (!data) return;
    const total = data.moves.length;
    function onKey(e) {
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowDown')  setCursor((c) => Math.max(0, c - 1));
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp')    setCursor((c) => Math.min(total, c + 1));
      if (e.key === 'Home') setCursor(0);
      if (e.key === 'End')  setCursor(total);
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [data, onClose]);

  const fen     = !data || cursor === 0 ? 'start' : data.moves[cursor - 1].fen;
  const total   = data?.moves.length ?? 0;
  const opening = data ? identifyOpening(data.moves.map((m) => m.san)) : null;

  // Pair moves into rows: [[w1,b1],[w2,b2],...]
  const movePairs = data?.moves.reduce((pairs, move, i) => {
    if (i % 2 === 0) pairs.push([move]);
    else pairs[pairs.length - 1].push(move);
    return pairs;
  }, []) ?? [];

  const resultLabel = !data ? '' : (() => {
    const { result } = data.game;
    if (result === 'draw')  return '½ – ½';
    if (result === 'white') return '1 – 0';
    if (result === 'black') return '0 – 1';
    return '?';
  })();

  const gameInfo = data && (
    <div className="flex flex-col gap-0.5 min-w-0">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="font-display font-bold text-base text-on-surface">
          {data.game.white_name} vs {data.game.black_name}
        </span>
        <span className="font-mono text-xs bg-[#f1f2f4] text-muted px-2.5 py-1 rounded-sm">
          {data.game.time_control}
        </span>
        <span className="font-mono text-xs text-primary font-bold">{resultLabel}</span>
      </div>
      {opening && (
        <span className="font-mono text-[0.68rem] text-muted">
          {opening.eco} · {opening.name}
        </span>
      )}
    </div>
  );

  // Shared navigation controls — used by both inline and modal layouts.
  const navControls = (
    <>
      <div className="flex items-center gap-2">
        <NavBtn onClick={() => setCursor(0)}                                      disabled={cursor === 0}     title="First (Home)">⏮</NavBtn>
        <NavBtn onClick={() => setCursor((c) => Math.max(0, c - 1))}              disabled={cursor === 0}     title="Previous (←)">◀</NavBtn>
        <span className="font-mono text-sm text-muted w-20 text-center tabular-nums">{cursor} / {total}</span>
        <NavBtn onClick={() => setCursor((c) => Math.min(total, c + 1))}          disabled={cursor === total} title="Next (→)">▶</NavBtn>
        <NavBtn onClick={() => setCursor(total)}                                   disabled={cursor === total} title="Last (End)">⏭</NavBtn>
      </div>
      <p className="font-mono text-[0.65rem] text-muted/60">Use ← → arrow keys to navigate</p>
    </>
  );

  const boardAndNav = (
    <div className="flex flex-col items-center gap-4 w-full">
      <Board fen={fen} playerColour="white" onMove={() => {}} gameOver={true} animated={false} maxWidth={680} />
      {navControls}
    </div>
  );

  // Key moments — moves classified as inaccuracy or worse, for the summary panel.
  const keyMoments = annotations
    .map((a, i) => a && a.classification !== 'good' ? { moveIdx: i, ...a } : null)
    .filter(Boolean);

  const moveList = (
    <div className="bg-white rounded-md border border-black/[0.04] p-4 h-full overflow-y-auto">
      {/* Analysis progress / summary */}
      {inline && (isAnalyzing || annotations.some(Boolean)) && (
        <div className="mb-3 pb-3 border-b border-black/[0.05]">
          {isAnalyzing && (
            <div className="flex items-center gap-2 mb-2">
              <div className="w-full h-1.5 bg-surface-high rounded-sm overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }}
                />
              </div>
              <span className="font-mono text-[0.6rem] text-muted whitespace-nowrap">
                {progress.done}/{progress.total}
              </span>
            </div>
          )}
          {!isAnalyzing && annotations.some(Boolean) && (
            <div className="flex gap-4 text-[0.65rem] font-mono">
              <div className="flex flex-col gap-0.5">
                <span className="text-muted uppercase tracking-wider text-[0.5rem]">White</span>
                <span>
                  <span className="text-yellow-600">{summary.white.inaccuracies}?!</span>{' '}
                  <span className="text-orange-600">{summary.white.mistakes}?</span>{' '}
                  <span className="text-danger">{summary.white.blunders}??</span>
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-muted uppercase tracking-wider text-[0.5rem]">Black</span>
                <span>
                  <span className="text-yellow-600">{summary.black.inaccuracies}?!</span>{' '}
                  <span className="text-orange-600">{summary.black.mistakes}?</span>{' '}
                  <span className="text-danger">{summary.black.blunders}??</span>
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {movePairs.length === 0 && (
        <p className="font-mono text-xs text-muted text-center py-4">No moves recorded</p>
      )}
      <div className="grid grid-cols-[24px_1fr_1fr] gap-y-0.5 gap-x-1">
        {movePairs.map((pair, pairIdx) => (
          <div key={pairIdx} className="contents">
            <span className="font-mono text-[0.68rem] text-muted self-center text-right leading-tight py-0.5">{pairIdx + 1}.</span>
            <MoveChip
              san={pair[0].san}
              active={cursor === pairIdx * 2 + 1}
              onClick={() => setCursor(pairIdx * 2 + 1)}
              classification={annotations[pairIdx * 2]?.classification}
            />
            {pair[1]
              ? <MoveChip
                  san={pair[1].san}
                  active={cursor === pairIdx * 2 + 2}
                  onClick={() => setCursor(pairIdx * 2 + 2)}
                  classification={annotations[pairIdx * 2 + 1]?.classification}
                />
              : <span />
            }
          </div>
        ))}
      </div>
      {resultLabel && (
        <div className="mt-3 pt-3 border-t border-black/[0.05] text-center">
          <span className="font-mono text-sm font-bold text-on-surface">{resultLabel}</span>
        </div>
      )}

      {/* Key moments */}
      {keyMoments.length > 0 && !isAnalyzing && (
        <div className="mt-3 pt-3 border-t border-black/[0.05]">
          <p className="font-mono text-[0.55rem] text-muted uppercase tracking-wider mb-2">Key moments</p>
          <div className="flex flex-col gap-1">
            {keyMoments.map((km) => {
              const moveNum = Math.floor(km.moveIdx / 2) + 1;
              const isWhite = km.moveIdx % 2 === 0;
              const label = isWhite ? `${moveNum}. ${data.moves[km.moveIdx].san}` : `${moveNum}... ${data.moves[km.moveIdx].san}`;
              const evalStr = km.eval
                ? km.eval.mate !== null
                  ? `M${Math.abs(km.eval.mate)}`
                  : (km.eval.cp >= 0 ? '+' : '') + (km.eval.cp / 100).toFixed(1)
                : '';
              return (
                <button
                  key={km.moveIdx}
                  onClick={() => setCursor(km.moveIdx + 1)}
                  className="flex items-center gap-2 text-left bg-transparent border-0 cursor-pointer hover:bg-surface-high rounded-sm px-1.5 py-1 transition-colors"
                >
                  <ClassificationBadge cls={km.classification} />
                  <span className="font-mono text-[0.68rem] text-on-surface">{label}</span>
                  <span className="font-mono text-[0.6rem] text-muted ml-auto">{evalStr}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  // ── Inline / page mode ───────────────────────────────────────────────────────
  if (inline) {
    return (
      <div className="max-w-[1280px] mx-auto">
        {loading && <p className="font-body text-sm text-muted py-12 text-center">Loading game…</p>}
        {error   && <p className="font-mono text-sm text-danger py-12 text-center">{error}</p>}
        {data && (
          <>
            <div className="mb-6">{gameInfo}</div>
            <div className="flex flex-col lg:flex-row gap-6 lg:items-start">
              {/* Board column — eval bar sits *next to the board*, not the
                  entire nav stack, so its height matches the board exactly. */}
              <div className="flex flex-col items-center gap-4 flex-1 min-w-0">
                {/* Eval bar + board row */}
                <div className="flex gap-3 items-stretch w-full justify-center">
                  <div className="flex-shrink-0">
                    <EvalBar evaluation={evaluation} orientation="white" />
                  </div>
                  <Board fen={fen} playerColour="white" onMove={() => {}} gameOver={true} animated={false} maxWidth={680} />
                </div>
                {/* Navigation + tip below the board row */}
                {navControls}
              </div>
              {/* Move list — fixed-width side panel */}
              <div className="w-full lg:w-80 flex-shrink-0">
                {moveList}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Modal mode ───────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 bg-on-surface/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-surface rounded-md shadow-[0_24px_64px_rgba(0,0,0,0.2)] w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 bg-white border-b border-surface-high flex-shrink-0">
          {gameInfo ?? <div />}
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-high hover:bg-surface-highest text-muted border-0 cursor-pointer transition-colors flex-shrink-0 ml-3">✕</button>
        </div>
        {loading && <div className="flex-1 flex items-center justify-center"><p className="font-body text-sm text-muted">Loading game…</p></div>}
        {error   && <div className="flex-1 flex items-center justify-center"><p className="font-mono text-sm text-danger">{error}</p></div>}
        {data && (
          <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
            <div className="flex flex-col items-center gap-4 p-5 lg:flex-1 overflow-y-auto">{boardAndNav}</div>
            <div className="lg:w-52 border-t lg:border-t-0 lg:border-l border-surface-high bg-white overflow-y-auto flex-shrink-0 p-3">{moveList}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function NavBtn({ children, onClick, disabled, title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="w-9 h-9 flex items-center justify-center rounded-md bg-surface-high text-on-surface border-0 cursor-pointer hover:bg-surface-highest transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-sm font-bold"
    >
      {children}
    </button>
  );
}

const CLS_COLORS = {
  inaccuracy: 'text-yellow-600',
  mistake:    'text-orange-600',
  blunder:    'text-danger',
};
const CLS_SYMBOLS = {
  inaccuracy: '?!',
  mistake:    '?',
  blunder:    '??',
};
const CLS_BG = {
  inaccuracy: 'bg-yellow-100',
  mistake:    'bg-orange-100',
  blunder:    'bg-red-100',
};

function ClassificationBadge({ cls }) {
  if (!cls || cls === 'good') return null;
  return (
    <span className={`font-mono text-[0.6rem] font-bold ${CLS_COLORS[cls]}`}>
      {CLS_SYMBOLS[cls]}
    </span>
  );
}

function MoveChip({ san, active, onClick, classification }) {
  const hasBadge = classification && classification !== 'good';
  return (
    <button
      onClick={onClick}
      className={[
        'font-mono text-[0.78rem] px-1.5 py-0.5 rounded text-left border-0 cursor-pointer transition-colors w-full truncate flex items-center gap-1',
        active && hasBadge
          ? `${CLS_BG[classification]} ring-2 ring-primary font-semibold`
          : active
            ? 'bg-primary text-on-primary font-semibold'
            : hasBadge
              ? `${CLS_BG[classification]} text-on-surface hover:opacity-80`
              : 'bg-transparent text-on-surface hover:bg-surface-high',
      ].join(' ')}
    >
      {san}
      <ClassificationBadge cls={classification} />
    </button>
  );
}

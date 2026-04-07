import { useState, useEffect, useCallback } from 'react';
import { Board } from './Board.jsx';
import { apiFetch } from '../api.js';

export function GameReview({ gameId, token, onClose }) {
  const [data, setData]       = useState(null);
  const [cursor, setCursor]   = useState(0); // 0 = start, n = after move n
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    setLoading(true); setError(''); setData(null); setCursor(0);
    apiFetch(`/api/social/history/${gameId}`, { token })
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [gameId, token]);

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

  const fen   = !data || cursor === 0 ? 'start' : data.moves[cursor - 1].fen;
  const total = data?.moves.length ?? 0;

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

  return (
    <div
      className="fixed inset-0 bg-on-surface/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-surface rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.2)] w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-white border-b border-surface-high flex-shrink-0">
          {data ? (
            <div className="flex items-center gap-3 min-w-0">
              <span className="font-display font-bold text-base text-on-surface truncate">
                {data.game.white_name} vs {data.game.black_name}
              </span>
              <span className="font-mono text-xs bg-surface-high text-muted px-2.5 py-1 rounded-full flex-shrink-0">
                {data.game.time_control}
              </span>
              <span className="font-mono text-xs text-primary font-bold flex-shrink-0">{resultLabel}</span>
            </div>
          ) : <div />}
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-high hover:bg-surface-highest text-muted border-0 cursor-pointer transition-colors flex-shrink-0 ml-3"
          >✕</button>
        </div>

        {/* Body */}
        {loading && (
          <div className="flex-1 flex items-center justify-center">
            <p className="font-body text-sm text-muted">Loading game…</p>
          </div>
        )}
        {error && (
          <div className="flex-1 flex items-center justify-center">
            <p className="font-mono text-sm text-danger">{error}</p>
          </div>
        )}

        {data && (
          <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">

            {/* Board + nav */}
            <div className="flex flex-col items-center gap-4 p-5 lg:flex-1 overflow-y-auto">
              <Board
                fen={fen}
                playerColour="white"
                onMove={() => {}}
                gameOver={true}
                animated={false}
              />

              {/* Navigation controls */}
              <div className="flex items-center gap-2">
                <NavBtn onClick={() => setCursor(0)}         disabled={cursor === 0}     title="First (Home)">⏮</NavBtn>
                <NavBtn onClick={() => setCursor((c) => Math.max(0, c - 1))}     disabled={cursor === 0}     title="Previous (←)">◀</NavBtn>
                <span className="font-mono text-sm text-muted w-20 text-center tabular-nums">
                  {cursor} / {total}
                </span>
                <NavBtn onClick={() => setCursor((c) => Math.min(total, c + 1))} disabled={cursor === total} title="Next (→)">▶</NavBtn>
                <NavBtn onClick={() => setCursor(total)}     disabled={cursor === total} title="Last (End)">⏭</NavBtn>
              </div>
              <p className="font-mono text-[0.65rem] text-muted/60">Use ← → arrow keys to navigate</p>
            </div>

            {/* Move list */}
            <div className="lg:w-52 border-t lg:border-t-0 lg:border-l border-surface-high bg-white overflow-y-auto flex-shrink-0">
              <div className="p-3">
                {movePairs.length === 0 && (
                  <p className="font-mono text-xs text-muted text-center py-4">No moves recorded</p>
                )}
                <div className="grid grid-cols-[24px_1fr_1fr] gap-y-0.5 gap-x-1">
                  {movePairs.map((pair, pairIdx) => (
                    <div key={pairIdx} className="contents">
                      <span className="font-mono text-[0.68rem] text-muted self-center text-right leading-tight py-0.5">
                        {pairIdx + 1}.
                      </span>
                      <MoveChip
                        san={pair[0].san}
                        active={cursor === pairIdx * 2 + 1}
                        onClick={() => setCursor(pairIdx * 2 + 1)}
                      />
                      {pair[1]
                        ? <MoveChip
                            san={pair[1].san}
                            active={cursor === pairIdx * 2 + 2}
                            onClick={() => setCursor(pairIdx * 2 + 2)}
                          />
                        : <span />
                      }
                    </div>
                  ))}
                </div>

                {/* Result */}
                {resultLabel && (
                  <div className="mt-3 pt-3 border-t border-surface-high text-center">
                    <span className="font-mono text-sm font-bold text-on-surface">{resultLabel}</span>
                  </div>
                )}
              </div>
            </div>
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
      className="w-9 h-9 flex items-center justify-center rounded-xl bg-surface-high text-on-surface border-0 cursor-pointer hover:bg-surface-highest transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-sm font-bold"
    >
      {children}
    </button>
  );
}

function MoveChip({ san, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={[
        'font-mono text-[0.78rem] px-1.5 py-0.5 rounded text-left border-0 cursor-pointer transition-colors w-full truncate',
        active
          ? 'bg-primary text-on-primary font-semibold'
          : 'bg-transparent text-on-surface hover:bg-surface-high',
      ].join(' ')}
    >
      {san}
    </button>
  );
}

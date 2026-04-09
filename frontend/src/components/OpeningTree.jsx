import { useState, useEffect, useCallback, useMemo } from 'react';
import { Chess } from 'chess.js';
import { Board } from './Board.jsx';
import { identifyOpening } from '../utils/openings.js';
import { apiFetch } from '../api.js';

export function OpeningTree({ accountId, token }) {
  const [moves, setMoves]       = useState([]);   // current move prefix as array of SAN
  const [data, setData]         = useState(null);  // API response
  const [loading, setLoading]   = useState(true);

  const prefix = moves.join(' ');

  const fetchOpenings = useCallback(async () => {
    setLoading(true);
    try {
      const params = prefix ? `?moves=${encodeURIComponent(prefix)}` : '';
      const result = await apiFetch(
        `/api/social/external/accounts/${accountId}/openings${params}`,
        { token }
      );
      setData(result);
    } catch (err) {
      console.error('[opening-tree] fetch error:', err.message);
      setData({ totalGames: 0, stats: { wins: 0, draws: 0, losses: 0, winRate: 0 }, moves: [] });
    } finally {
      setLoading(false);
    }
  }, [accountId, token, prefix]);

  useEffect(() => { fetchOpenings(); }, [fetchOpenings]);

  // Compute the current FEN by replaying the prefix moves
  const currentFen = useMemo(() => {
    if (moves.length === 0) return 'start';
    const chess = new Chess();
    for (const san of moves) {
      try { chess.move(san); } catch { break; }
    }
    return chess.fen();
  }, [moves]);

  const opening = useMemo(() => identifyOpening(moves), [moves]);

  function drillDown(move) {
    setMoves((prev) => [...prev, move]);
  }

  function goToDepth(depth) {
    setMoves((prev) => prev.slice(0, depth));
  }

  // Build breadcrumb items: "Root", "1. e4", "1... e5", "2. Nf3", etc.
  const breadcrumbs = useMemo(() => {
    const items = [{ label: 'Root', depth: 0 }];
    for (let i = 0; i < moves.length; i++) {
      const moveNum = Math.floor(i / 2) + 1;
      const isWhite = i % 2 === 0;
      const label = isWhite ? `${moveNum}. ${moves[i]}` : `${moveNum}... ${moves[i]}`;
      items.push({ label, depth: i + 1 });
    }
    return items;
  }, [moves]);

  return (
    <div className="flex flex-col gap-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {breadcrumbs.map((bc, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-muted text-xs">›</span>}
            <button
              onClick={() => goToDepth(bc.depth)}
              className={[
                'font-mono text-xs border-0 cursor-pointer transition-colors rounded-sm px-1.5 py-0.5',
                i === breadcrumbs.length - 1
                  ? 'bg-primary text-on-primary font-semibold'
                  : 'bg-transparent text-muted hover:text-on-surface hover:bg-surface-high',
              ].join(' ')}
            >
              {bc.label}
            </button>
          </span>
        ))}
      </div>

      {/* Opening name */}
      {opening && (
        <p className="font-mono text-[0.68rem] text-muted">
          {opening.eco} · {opening.name}
        </p>
      )}

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Mini board */}
        <div className="flex-shrink-0">
          <Board
            fen={currentFen}
            playerColour="white"
            onMove={() => {}}
            gameOver={true}
            animated={false}
            maxWidth={280}
          />
        </div>

        {/* Move table */}
        <div className="flex-1 min-w-0">
          {loading ? (
            <p className="font-body text-sm text-muted py-8 text-center">Loading…</p>
          ) : !data || data.moves.length === 0 ? (
            <p className="font-body text-sm text-muted py-8 text-center">No games at this depth.</p>
          ) : (
            <>
              {/* Summary */}
              <div className="flex items-center gap-4 mb-4 font-mono text-xs text-muted">
                <span>{data.totalGames} games</span>
                <span className="text-success">{data.stats.wins}W</span>
                <span>{data.stats.draws}D</span>
                <span className="text-danger">{data.stats.losses}L</span>
                <span>({Math.round(data.stats.winRate * 100)}%)</span>
              </div>

              {/* Rows */}
              <div className="flex flex-col gap-1">
                {data.moves.map((m) => {
                  const total = m.wins + m.draws + m.losses;
                  const wPct = total > 0 ? (m.wins / total) * 100 : 0;
                  const dPct = total > 0 ? (m.draws / total) * 100 : 0;
                  const lPct = total > 0 ? (m.losses / total) * 100 : 0;
                  return (
                    <button
                      key={m.move}
                      onClick={() => drillDown(m.move)}
                      className="flex items-center gap-3 p-3 bg-white rounded-md border border-black/[0.04] hover:border-primary/20 hover:shadow-sm transition-all cursor-pointer w-full text-left"
                    >
                      {/* Move */}
                      <span className="font-mono text-sm font-bold text-on-surface w-14 flex-shrink-0">
                        {m.move}
                      </span>

                      {/* W/D/L bar */}
                      <div className="flex-1 h-4 rounded-sm overflow-hidden flex">
                        <div className="bg-success/70 h-full" style={{ width: `${wPct}%` }} />
                        <div className="bg-surface-high h-full" style={{ width: `${dPct}%` }} />
                        <div className="bg-danger/60 h-full" style={{ width: `${lPct}%` }} />
                      </div>

                      {/* Stats */}
                      <span className="font-mono text-[0.62rem] text-muted w-12 text-right flex-shrink-0">
                        {m.count}
                      </span>
                      <span className="font-mono text-[0.62rem] font-semibold text-on-surface w-12 text-right flex-shrink-0">
                        {Math.round(m.winRate * 100)}%
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

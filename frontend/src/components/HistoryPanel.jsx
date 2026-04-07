import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api.js';

const PAGE_SIZE = 10;
const TYPE_ICON = { bullet: '⚡', blitz: '🔥', rapid: '⏱', classical: '♞' };

export function HistoryPanel({ token, userId, onViewGame, onViewProfile }) {
  const [games, setGames]     = useState([]);
  const [offset, setOffset]   = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const load = useCallback(async (off) => {
    if (!token) return;
    setLoading(true); setError('');
    try {
      const rows = await apiFetch(`/api/social/history?limit=${PAGE_SIZE}&offset=${off}`, { token });
      setGames((prev) => (off === 0 ? rows : [...prev, ...rows]));
      setHasMore(rows.length === PAGE_SIZE);
      setOffset(off + rows.length);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { setGames([]); setOffset(0); setHasMore(true); load(0); }, [load]);

  if (loading && games.length === 0) return (
    <div className="flex flex-col gap-3">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-[68px] rounded-2xl bg-surface-high animate-pulse" />
      ))}
    </div>
  );
  if (error) return (
    <p className="font-mono text-sm text-danger bg-danger-bg rounded-xl px-4 py-3">{error}</p>
  );
  if (games.length === 0) return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <span className="text-4xl">♟</span>
      <p className="font-body text-sm text-muted">No finished games yet.<br />Create a game and play some chess!</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-2.5">
      {games.map((g) => {
        const isWhite   = g.white_id === userId;
        const myColour  = isWhite ? 'white' : 'black';
        const oppId     = isWhite ? g.black_id : g.white_id;
        const oppName   = isWhite ? g.black_name : g.white_name;
        const oppRating = isWhite
          ? (g.black_rating != null ? Math.round(Number(g.black_rating)) : '?')
          : (g.white_rating != null ? Math.round(Number(g.white_rating)) : '?');
        const outcome = g.result === 'draw' ? 'draw' : g.result === myColour ? 'win' : 'loss';
        const date    = new Date(g.ended_at ?? g.created_at).toLocaleDateString(undefined, {
          month: 'short', day: 'numeric', year: 'numeric',
        });

        const outcomeConfig = {
          win:  { label: 'WIN',  bar: 'bg-success', chip: 'bg-success-bg text-success' },
          loss: { label: 'LOSS', bar: 'bg-danger',  chip: 'bg-danger-bg text-danger' },
          draw: { label: 'DRAW', bar: 'bg-muted',   chip: 'bg-surface-high text-muted' },
        }[outcome];

        return (
          <div
            key={g.id}
            onClick={() => onViewGame?.(g.id)}
            className="flex items-stretch rounded-2xl bg-white border border-surface-high overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.05)] cursor-pointer hover:border-primary/30 hover:shadow-[0_2px_12px_rgba(0,90,183,0.08)] transition-all"
          >
            {/* Left accent bar */}
            <div className={`w-1 flex-shrink-0 ${outcomeConfig.bar} opacity-80`} />

            {/* Content */}
            <div className="flex items-center gap-3 px-4 py-3.5 flex-1 min-w-0">
              <span className={`font-mono text-[0.6rem] font-bold tracking-[0.08em] px-2.5 py-1.5 rounded-lg min-w-[44px] text-center flex-shrink-0 ${outcomeConfig.chip}`}>
                {outcomeConfig.label}
              </span>

              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <span className="font-body text-[0.9375rem] font-semibold text-on-surface truncate">
                  vs{' '}
                  <button
                    onClick={(e) => { e.stopPropagation(); onViewProfile?.(oppId); }}
                    className="text-primary underline underline-offset-2 bg-transparent border-0 cursor-pointer font-semibold hover:opacity-70 transition-opacity p-0"
                  >
                    {oppName}
                  </button>
                  <span className="font-mono text-xs text-muted font-normal ml-1">({oppRating})</span>
                </span>
                <span className="font-mono text-[0.68rem] text-muted flex items-center gap-1.5">
                  <span>{TYPE_ICON[g.game_type] ?? '♟'}</span>
                  {g.time_control} · {date}
                </span>
              </div>

              <div
                className="w-4 h-4 rounded-full flex-shrink-0 border-2 border-surface-high shadow-sm"
                style={{ background: myColour === 'white' ? '#f8fafc' : '#1e293b' }}
                title={`You played ${myColour}`}
              />
            </div>
          </div>
        );
      })}

      {hasMore && (
        <button className="btn-ghost self-center mt-2" onClick={() => load(offset)} disabled={loading}>
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}

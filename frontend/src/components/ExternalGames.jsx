import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../api.js';
import { OpeningTree } from './OpeningTree.jsx';

export function ExternalGames({ account, token, onViewGame, onBack }) {
  const [view, setView]       = useState('games'); // 'games' | 'openings'
  const [games, setGames]     = useState([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const limit = 20;
  const fetchIdRef = useRef(0);

  const fetchGames = useCallback(async () => {
    const id = ++fetchIdRef.current;
    setLoading(true); setError('');
    try {
      const data = await apiFetch(
        `/api/social/external/accounts/${account.id}/games?page=${page}&limit=${limit}`,
        { token }
      );
      if (id !== fetchIdRef.current) return; // stale response from rapid page change
      setGames(data.games);
      setTotal(data.total);
    } catch (err) {
      if (id !== fetchIdRef.current) return;
      setError(err.message);
    } finally {
      if (id === fetchIdRef.current) setLoading(false);
    }
  }, [account.id, token, page]);

  useEffect(() => { fetchGames(); }, [fetchGames]);

  const totalPages = Math.ceil(total / limit);

  async function handleViewGame(gameId) {
    setError('');
    try {
      const data = await apiFetch(`/api/social/external/games/${gameId}`, { token });
      onViewGame(data);
    } catch (err) {
      setError(`Failed to load game: ${err.message}`);
    }
  }

  const resultBadge = (result, playerColor) => {
    if (!result) return <span className="text-muted">?</span>;
    if (result === 'draw') return <span className="text-muted font-semibold">½</span>;
    if (result === playerColor) return <span className="text-success font-semibold">W</span>;
    return <span className="text-danger font-semibold">L</span>;
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="font-body text-sm text-muted hover:text-on-surface bg-transparent border-0 cursor-pointer transition-colors"
        >
          ← Accounts
        </button>
        <h3 className="font-display font-bold text-base text-on-surface">
          {account.username}'s games
        </h3>
        <span className="font-mono text-xs text-muted">{total} games</span>
        {/* View toggle */}
        <div className="ml-auto flex items-center gap-1 bg-surface-high rounded-md p-0.5">
          {['games', 'openings'].map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={[
                'font-body text-xs font-semibold px-3 py-1.5 rounded-sm border-0 cursor-pointer transition-all capitalize',
                view === v ? 'bg-white text-on-surface shadow-sm' : 'bg-transparent text-muted hover:text-on-surface',
              ].join(' ')}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <p className="font-mono text-xs text-danger bg-danger-bg rounded-md px-4 py-2.5">{error}</p>
      )}

      {/* Opening tree view */}
      {view === 'openings' && (
        <OpeningTree accountId={account.id} token={token} />
      )}

      {/* Game list */}
      {view === 'games' && loading ? (
        <p className="font-body text-sm text-muted text-center py-8">Loading games…</p>
      ) : view === 'games' && !error && games.length === 0 ? (
        <p className="font-body text-sm text-muted text-center py-8">No games synced yet. Go back and click Sync.</p>
      ) : view === 'games' ? (
        <div className="flex flex-col gap-2">
          {games.map((g) => (
            <button
              key={g.id}
              onClick={() => handleViewGame(g.id)}
              className="bg-white rounded-md border border-black/[0.04] p-4 flex items-center gap-4 w-full text-left cursor-pointer hover:border-primary/20 hover:shadow-sm transition-all"
            >
              <div className="w-8 text-center text-lg">
                {resultBadge(g.result, g.player_color)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-display font-bold text-sm text-on-surface truncate">
                  {g.white_name} vs {g.black_name}
                </p>
                <p className="font-mono text-[0.62rem] text-muted truncate">
                  {g.eco && `${g.eco} · `}{g.opening_name ?? 'Unknown opening'}
                  {g.time_control && ` · ${g.time_control}`}
                </p>
              </div>
              {g.played_at && (
                <span className="font-mono text-[0.6rem] text-muted whitespace-nowrap">
                  {new Date(g.played_at).toLocaleDateString()}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : null}

      {/* Pagination */}
      {view === 'games' && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 py-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="font-body text-sm text-muted hover:text-on-surface bg-transparent border-0 cursor-pointer disabled:opacity-30"
          >
            ← Prev
          </button>
          <span className="font-mono text-xs text-muted">{page} / {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="font-body text-sm text-muted hover:text-on-surface bg-transparent border-0 cursor-pointer disabled:opacity-30"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

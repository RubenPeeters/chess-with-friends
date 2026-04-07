import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api.js';

const PAGE_SIZE = 10;

/**
 * Paginated match history panel.
 * Shows finished games with opponent, result, time control, and date.
 */
export function HistoryPanel({ token, userId, onJoinGame }) {
  const [games, setGames]     = useState([]);
  const [offset, setOffset]   = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const load = useCallback(async (off) => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const rows = await apiFetch(
        `/api/social/history?limit=${PAGE_SIZE}&offset=${off}`,
        { token }
      );
      setGames((prev) => (off === 0 ? rows : [...prev, ...rows]));
      setHasMore(rows.length === PAGE_SIZE);
      setOffset(off + rows.length);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    setGames([]);
    setOffset(0);
    setHasMore(true);
    load(0);
  }, [load]);

  if (loading && games.length === 0) {
    return <p style={s.empty}>Loading…</p>;
  }

  if (error) {
    return <p style={s.errorMsg}>{error}</p>;
  }

  if (games.length === 0) {
    return <p style={s.empty}>No finished games yet. Play some chess!</p>;
  }

  return (
    <div style={s.wrap}>
      {games.map((g) => {
        const isWhite   = g.white_id === userId;
        const myColour  = isWhite ? 'white' : 'black';
        const oppName   = isWhite ? g.black_name : g.white_name;
        const oppRating = isWhite
          ? (g.black_rating != null ? Math.round(Number(g.black_rating)) : '?')
          : (g.white_rating != null ? Math.round(Number(g.white_rating)) : '?');
        const outcome   =
          g.result === 'draw'   ? 'draw'
          : g.result === myColour ? 'win'
          : 'loss';
        const date = new Date(g.ended_at ?? g.created_at).toLocaleDateString(undefined, {
          month: 'short', day: 'numeric', year: 'numeric',
        });

        return (
          <div key={g.id} style={s.row}>
            <div style={s.chip(outcome)}>{outcome.toUpperCase()}</div>
            <div style={s.info}>
              <span style={s.opponent}>vs {oppName} <span style={s.oppRating}>({oppRating})</span></span>
              <span style={s.meta}>{g.time_control} · {date}</span>
            </div>
            <div style={{ ...s.colourDot, background: myColour === 'white' ? '#f8fafc' : '#1e293b', border: '1px solid #cbd5e1' }} title={`You played ${myColour}`} />
          </div>
        );
      })}

      {hasMore && (
        <button style={s.loadMore} onClick={() => load(offset)} disabled={loading}>
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}

function outcomeColor(outcome) {
  if (outcome === 'win')  return { bg: '#dcfce7', color: '#15803d' };
  if (outcome === 'loss') return { bg: '#fee2e2', color: '#b91c1c' };
  return { bg: 'var(--surface-high)', color: 'var(--on-surface-muted)' };
}

const s = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  empty: {
    fontFamily: 'var(--font-body)',
    fontSize: '0.9375rem',
    color: 'var(--on-surface-muted)',
    textAlign: 'center',
    paddingTop: '2rem',
  },
  errorMsg: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.8125rem',
    color: '#b91c1c',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--surface-high)',
  },
  chip: (outcome) => {
    const { bg, color } = outcomeColor(outcome);
    return {
      fontFamily: 'var(--font-mono)',
      fontSize: '0.65rem',
      fontWeight: 700,
      letterSpacing: '0.06em',
      padding: '0.25rem 0.5rem',
      borderRadius: '0.25rem',
      background: bg,
      color,
      whiteSpace: 'nowrap',
      minWidth: 40,
      textAlign: 'center',
    };
  },
  info: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.125rem',
    flex: 1,
    minWidth: 0,
  },
  opponent: {
    fontFamily: 'var(--font-body)',
    fontSize: '0.9375rem',
    fontWeight: 600,
    color: 'var(--on-surface)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  oppRating: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.75rem',
    color: 'var(--on-surface-muted)',
    fontWeight: 400,
  },
  meta: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.7rem',
    color: 'var(--on-surface-muted)',
    letterSpacing: '0.02em',
  },
  colourDot: {
    width: 12,
    height: 12,
    borderRadius: '50%',
    flexShrink: 0,
  },
  loadMore: {
    fontFamily: 'var(--font-body)',
    fontSize: '0.875rem',
    fontWeight: 500,
    padding: '0.5rem',
    border: 'none',
    background: 'none',
    color: 'var(--primary)',
    cursor: 'pointer',
    textDecoration: 'underline',
    textUnderlineOffset: 3,
    alignSelf: 'center',
    marginTop: '0.25rem',
  },
};

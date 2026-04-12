import { useState, useEffect } from 'react';
import { apiFetch } from '../api.js';

const TYPES   = ['bullet', 'blitz', 'rapid', 'classical'];
const ICONS   = { bullet: '⚡', blitz: '🔥', rapid: '⏱', classical: '♞' };
const OUTCOME_STYLE = {
  win:  'bg-success-bg text-success',
  loss: 'bg-danger-bg text-danger',
  draw: 'bg-surface-high text-muted',
};

export function PlayerProfile({ userId, token, onClose, onViewGame }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    setLoading(true); setError(''); setData(null);
    apiFetch(`/api/social/users/${userId}`, { token })
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [userId, token]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const initial     = data?.user.display_name?.[0]?.toUpperCase() ?? '?';
  const displayName = data?.user.display_name ?? '';
  const memberYear  = data ? new Date(data.user.created_at).getFullYear() : '';

  return (
    <div
      className="fixed inset-0 bg-on-surface/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-surface-lowest rounded-md shadow-[0_24px_64px_rgba(0,0,0,0.2)] w-full max-w-md max-h-[88vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-surface-high flex-shrink-0">
          {data ? (
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-primary-gradient text-on-primary font-display font-bold text-xl flex items-center justify-center flex-shrink-0 shadow-[0_2px_10px_rgba(0,90,183,0.25)]">
                {initial}
              </div>
              <div>
                <h2 className="font-display font-bold text-lg text-on-surface leading-tight">{displayName}</h2>
                <p className="font-mono text-[0.68rem] text-muted">Member since {memberYear}</p>
              </div>
            </div>
          ) : <div className="w-12 h-12 rounded-full bg-surface-high animate-pulse" />}
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-high hover:bg-surface-highest text-muted border-0 cursor-pointer transition-colors"
          >✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-6 flex flex-col gap-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-12 rounded-md bg-surface-high animate-pulse" />
              ))}
            </div>
          )}
          {error && <p className="font-mono text-sm text-danger text-center py-12 px-6">{error}</p>}

          {data && (
            <div className="p-5 flex flex-col gap-6">

              {/* Ratings grid */}
              <div>
                <h3 className="font-mono text-[0.68rem] font-semibold text-muted uppercase tracking-[0.08em] mb-3">
                  Ratings
                </h3>
                <div className="grid grid-cols-2 gap-2.5">
                  {TYPES.map((type) => {
                    const r = data.ratings[type];
                    return (
                      <div key={type} className="bg-surface rounded-md px-4 py-3.5 border border-surface-high">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className="text-base leading-none">{ICONS[type]}</span>
                          <span className="font-mono text-[0.65rem] text-muted uppercase tracking-[0.06em] capitalize">
                            {type}
                          </span>
                        </div>
                        <span className="font-mono text-[1.5rem] font-bold text-on-surface leading-none">
                          {r ? Math.round(Number(r.rating)) : '—'}
                        </span>
                        {r && (
                          <span className="font-mono text-[0.65rem] text-muted block mt-0.5">
                            ±{Math.round(Number(r.rd))} RD
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Recent games */}
              {data.recent_games.length > 0 && (
                <div>
                  <h3 className="font-mono text-[0.68rem] font-semibold text-muted uppercase tracking-[0.08em] mb-3">
                    Recent games
                  </h3>
                  <div className="flex flex-col gap-2">
                    {data.recent_games.map((g) => {
                      const isWhite = g.white_id === userId;
                      const myColour = isWhite ? 'white' : 'black';
                      const oppName  = isWhite ? g.black_name : g.white_name;
                      const outcome  = g.result === 'draw'
                        ? 'draw'
                        : g.result === myColour ? 'win' : 'loss';
                      const date = new Date(g.ended_at).toLocaleDateString(undefined, {
                        month: 'short', day: 'numeric',
                      });

                      return (
                        <div
                          key={g.id}
                          onClick={() => onViewGame?.(g.id)}
                          className="flex items-center gap-3 px-4 py-3 rounded-md bg-surface border border-surface-high cursor-pointer hover:border-primary/30 hover:shadow-[0_2px_8px_rgba(0,90,183,0.08)] transition-all"
                        >
                          <span className={`font-mono text-[0.6rem] font-bold tracking-[0.06em] px-2.5 py-1.5 rounded-lg min-w-[44px] text-center flex-shrink-0 ${OUTCOME_STYLE[outcome]}`}>
                            {outcome.toUpperCase()}
                          </span>
                          <span className="font-body text-sm text-on-surface flex-1 truncate">
                            vs {oppName}
                          </span>
                          <span className="font-mono text-[0.68rem] text-muted flex-shrink-0">{g.time_control}</span>
                          <span className="font-mono text-[0.65rem] text-muted/60 flex-shrink-0">{date}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {data.recent_games.length === 0 && (
                <div className="text-center py-6">
                  <p className="font-body text-sm text-muted">No finished games yet.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

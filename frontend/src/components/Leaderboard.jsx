import { useState, useEffect } from 'react';
import { apiFetch } from '../api.js';

const TYPES = [
  { key: 'bullet',    label: 'Bullet',    icon: '⚡' },
  { key: 'blitz',     label: 'Blitz',     icon: '🔥' },
  { key: 'rapid',     label: 'Rapid',     icon: '⏱' },
  { key: 'classical', label: 'Classical', icon: '♞' },
];

const MEDALS = ['🥇', '🥈', '🥉'];

export function Leaderboard({ token, onClose, onViewProfile }) {
  const [type, setType]       = useState('rapid');
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    setLoading(true); setError(''); setData(null);
    apiFetch(`/api/social/users/leaderboard?type=${type}`, { token })
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [type, token]);

  return (
    <div
      className="fixed inset-0 bg-on-surface/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-surface rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.2)] w-full max-w-md max-h-[88vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-white border-b border-surface-high flex-shrink-0">
          <span className="font-display font-bold text-base text-on-surface">Leaderboard</span>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-high hover:bg-surface-highest text-muted border-0 cursor-pointer transition-colors"
          >✕</button>
        </div>

        {/* Type selector */}
        <div className="flex gap-1 p-3 bg-white border-b border-surface-high flex-shrink-0">
          {TYPES.map((t) => (
            <button
              key={t.key}
              onClick={() => setType(t.key)}
              className={[
                'flex-1 flex items-center justify-center gap-1.5 font-body text-sm py-2 rounded-xl border-0 cursor-pointer transition-all',
                type === t.key
                  ? 'bg-primary text-on-primary font-semibold shadow-sm'
                  : 'bg-surface text-muted hover:text-on-surface hover:bg-surface-high',
              ].join(' ')}
            >
              <span className="text-base leading-none">{t.icon}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <p className="font-body text-sm text-muted">Loading…</p>
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center py-12">
              <p className="font-mono text-sm text-danger">{error}</p>
            </div>
          )}
          {data && data.players.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <p className="font-body text-sm text-muted">No players yet for this time control.</p>
            </div>
          )}
          {data && data.players.length > 0 && (
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-high">
                  <th className="font-mono text-[0.65rem] text-muted uppercase tracking-[0.06em] text-left px-5 py-3 w-10">#</th>
                  <th className="font-mono text-[0.65rem] text-muted uppercase tracking-[0.06em] text-left px-2 py-3">Player</th>
                  <th className="font-mono text-[0.65rem] text-muted uppercase tracking-[0.06em] text-right px-5 py-3">Rating</th>
                </tr>
              </thead>
              <tbody>
                {data.players.map((p, i) => (
                  <tr
                    key={p.id}
                    className="border-b border-surface-high last:border-0 hover:bg-surface-high/50 transition-colors"
                  >
                    <td className="px-5 py-3 text-center">
                      {i < 3
                        ? <span className="text-base leading-none">{MEDALS[i]}</span>
                        : <span className="font-mono text-sm text-muted">{i + 1}</span>
                      }
                    </td>
                    <td className="px-2 py-3">
                      <button
                        onClick={() => onViewProfile(p.id)}
                        className="font-body text-sm font-medium text-on-surface hover:text-primary border-0 bg-transparent cursor-pointer transition-colors text-left"
                      >
                        {p.display_name}
                      </button>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="font-mono text-sm font-bold text-on-surface">
                        {Math.round(p.rating)}
                      </span>
                      <span className="font-mono text-[0.65rem] text-muted ml-1.5">
                        ±{Math.round(p.rd)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

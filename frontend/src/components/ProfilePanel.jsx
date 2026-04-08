import { useState, useEffect } from 'react';
import { apiFetch } from '../api.js';

const TYPES = ['bullet', 'blitz', 'rapid', 'classical'];
const ICONS = { bullet: '⚡', blitz: '🔥', rapid: '⏱', classical: '♞' };

export function ProfilePanel({ token, user, onLogout = null }) {
  const [ratings, setRatings]             = useState({});
  const [selectedType, setSelectedType]   = useState('rapid');
  const [ratingHistory, setRatingHistory] = useState([]);

  useEffect(() => {
    if (!token) return;
    apiFetch('/api/social/history/me/rating', { token })
      .then(setRatings)
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token) return;
    setRatingHistory([]);
    apiFetch(`/api/social/history/me/rating/history?type=${selectedType}`, { token })
      .then(setRatingHistory)
      .catch(() => {});
  }, [token, selectedType]);

  const initial     = (user?.display_name ?? user?.displayName ?? '?')[0].toUpperCase();
  const displayName = user?.display_name ?? user?.displayName ?? 'Player';

  return (
    <div className="flex flex-col p-5">

      {/* Avatar + name */}
      <div className="flex flex-col items-center gap-3 py-5 text-center">
        <div className="w-[68px] h-[68px] rounded-full bg-primary-gradient text-on-primary font-display font-extrabold text-[1.75rem] flex items-center justify-center shadow-[0_4px_20px_rgba(0,90,183,0.3)]">
          {initial}
        </div>
        <div className="flex flex-col gap-0.5">
          <h2 className="font-display font-bold text-[1.1rem] text-on-surface leading-tight">{displayName}</h2>
          <p className="font-mono text-[0.68rem] text-muted break-all">{user?.email ?? ''}</p>
        </div>
      </div>

      <div className="h-px bg-surface-high mb-4" />

      {/* Ratings grid */}
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[0.65rem] text-muted uppercase tracking-[0.08em]">Ratings</span>
        <div className="grid grid-cols-2 gap-1.5">
          {TYPES.map((type) => {
            const r      = ratings[type];
            const active = type === selectedType;
            return (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                className={[
                  'flex flex-col gap-0.5 rounded-md px-3 py-2.5 text-left border-0 cursor-pointer transition-all',
                  active
                    ? 'bg-primary/10 ring-1 ring-primary/30'
                    : 'bg-surface hover:bg-surface-high',
                ].join(' ')}
              >
                <div className="flex items-center gap-1">
                  <span className="text-xs leading-none">{ICONS[type]}</span>
                  <span className="font-mono text-[0.6rem] text-muted uppercase tracking-[0.05em] capitalize">{type}</span>
                </div>
                <span className="font-mono text-[1.25rem] font-bold text-on-surface leading-none">
                  {r ? Math.round(Number(r.rating)) : '—'}
                </span>
              </button>
            );
          })}
        </div>

        {/* Sparkline for the selected type */}
        {ratingHistory.length >= 2 && (
          <div className="bg-surface rounded-md px-3 py-2.5 border border-surface-high mt-1">
            <span className="font-mono text-[0.6rem] text-muted uppercase tracking-[0.06em]">
              {ICONS[selectedType]} {selectedType} history
            </span>
            <RatingSparkline data={ratingHistory} />
          </div>
        )}
      </div>

      {/* Sign out */}
      {onLogout && (
        <button
          onClick={onLogout}
          className="font-body text-[0.8125rem] font-medium text-muted underline underline-offset-[3px] bg-transparent border-0 cursor-pointer mt-6 self-center hover:text-danger transition-colors"
        >
          Sign out
        </button>
      )}
    </div>
  );
}

function RatingSparkline({ data }) {
  const W = 200, H = 44, PAD = 4;
  const ratings = data.map((d) => Number(d.rating));
  const min   = Math.min(...ratings);
  const max   = Math.max(...ratings);
  const range = max - min || 1;

  const xs = data.map((_, i) => PAD + (i / (data.length - 1)) * (W - PAD * 2));
  const ys = ratings.map((r) => H - PAD - ((r - min) / range) * (H - PAD * 2));

  const polyline = xs.map((x, i) => `${x},${ys[i]}`).join(' ');
  const isUp  = ratings[ratings.length - 1] >= ratings[0];
  const trend = isUp ? '#15803d' : '#b91c1c';

  return (
    <div className="w-full mt-1.5">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="overflow-visible" aria-label="Rating history">
        <defs>
          <linearGradient id={`sg-${isUp ? 'up' : 'dn'}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={trend} stopOpacity="0.2" />
            <stop offset="100%" stopColor={trend} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`${xs[0]},${H} ${polyline} ${xs[xs.length-1]},${H}`} fill={`url(#sg-${isUp ? 'up' : 'dn'})`} />
        <polyline points={polyline} fill="none" stroke={trend} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={xs[xs.length-1]} cy={ys[ys.length-1]} r="3" fill={trend} stroke="white" strokeWidth="1.5" />
      </svg>
      <div className="flex justify-between mt-0.5">
        <span className="font-mono text-[0.6rem] text-muted">{Math.round(ratings[0])}</span>
        <span className={`font-mono text-[0.6rem] font-semibold ${isUp ? 'text-success' : 'text-danger'}`}>
          {isUp ? '▲' : '▼'} {Math.abs(Math.round(ratings[ratings.length - 1] - ratings[0]))}
        </span>
        <span className="font-mono text-[0.6rem] text-muted">{Math.round(ratings[ratings.length - 1])}</span>
      </div>
    </div>
  );
}

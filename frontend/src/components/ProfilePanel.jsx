import { useState, useEffect } from 'react';
import { apiFetch } from '../api.js';

export function ProfilePanel({ token, user, onLogout }) {
  const [rating, setRating]               = useState(null);
  const [ratingHistory, setRatingHistory] = useState([]);

  useEffect(() => {
    if (!token) return;
    apiFetch('/api/social/history/me/rating', { token }).then(setRating).catch(() => {});
    apiFetch('/api/social/history/me/rating/history', { token }).then(setRatingHistory).catch(() => {});
  }, [token]);

  const initial     = (user?.display_name ?? user?.displayName ?? '?')[0].toUpperCase();
  const displayName = user?.display_name ?? user?.displayName ?? 'Player';

  return (
    <div className="flex flex-col gap-0 p-5">
      {/* Profile header */}
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        {/* Avatar */}
        <div className="w-[68px] h-[68px] rounded-full bg-primary-gradient text-on-primary font-display font-extrabold text-[1.75rem] flex items-center justify-center shadow-[0_4px_20px_rgba(0,90,183,0.3)]">
          {initial}
        </div>

        {/* Name + email */}
        <div className="flex flex-col gap-0.5">
          <h2 className="font-display font-bold text-[1.125rem] text-on-surface leading-tight">{displayName}</h2>
          <p className="font-mono text-[0.68rem] text-muted tracking-[0.02em] break-all">{user?.email ?? ''}</p>
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-surface-high mx-1 mb-4" />

      {/* Rating card */}
      <div className="flex flex-col items-center gap-1 bg-surface rounded-2xl px-4 py-4 w-full border border-surface-high">
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">
          Glicko-2 Rating
        </span>
        {rating ? (
          <>
            <span className="font-mono text-[2.25rem] font-bold text-on-surface leading-none nums-tabular mt-0.5">
              {Math.round(Number(rating.rating))}
            </span>
            <span className="font-mono text-[0.7rem] text-muted">
              ±{Math.round(Number(rating.rd))} RD
            </span>
          </>
        ) : (
          <>
            <span className="font-mono text-[2.25rem] font-bold text-on-surface leading-none mt-0.5">—</span>
            <span className="font-mono text-[0.7rem] text-muted">No games yet</span>
          </>
        )}

        {ratingHistory.length >= 2 && <RatingSparkline data={ratingHistory} />}
      </div>

      {/* Sign out */}
      <button
        onClick={onLogout}
        className="font-body text-[0.8125rem] font-medium text-muted underline underline-offset-[3px] bg-transparent border-0 cursor-pointer mt-5 self-center hover:text-danger transition-colors"
      >
        Sign out
      </button>
    </div>
  );
}

function RatingSparkline({ data }) {
  const W = 180, H = 44, PAD = 4;
  const ratings = data.map((d) => Number(d.rating));
  const min = Math.min(...ratings);
  const max = Math.max(...ratings);
  const range = max - min || 1;

  const xs = data.map((_, i) => PAD + (i / (data.length - 1)) * (W - PAD * 2));
  const ys = ratings.map((r) => H - PAD - ((r - min) / range) * (H - PAD * 2));

  const polyline = xs.map((x, i) => `${x},${ys[i]}`).join(' ');
  const isUp  = ratings[ratings.length - 1] >= ratings[0];
  const trend = isUp ? '#15803d' : '#b91c1c';

  return (
    <div className="w-full mt-2">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="overflow-visible" aria-label="Rating history">
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={trend} stopOpacity="0.2" />
            <stop offset="100%" stopColor={trend} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`${xs[0]},${H} ${polyline} ${xs[xs.length-1]},${H}`} fill="url(#sparkGrad)" />
        <polyline points={polyline} fill="none" stroke={trend} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={xs[xs.length-1]} cy={ys[ys.length-1]} r="3" fill={trend} stroke="white" strokeWidth="1.5" />
      </svg>
      <div className="flex justify-between mt-0.5">
        <span className="font-mono text-[0.6rem] text-muted">{Math.round(ratings[0])}</span>
        <span className={`font-mono text-[0.6rem] font-semibold ${isUp ? 'text-success' : 'text-danger'}`}>
          {isUp ? '▲' : '▼'} {Math.round(Math.abs(ratings[ratings.length-1] - ratings[0]))}
        </span>
        <span className="font-mono text-[0.6rem] text-muted">{Math.round(ratings[ratings.length-1])}</span>
      </div>
    </div>
  );
}

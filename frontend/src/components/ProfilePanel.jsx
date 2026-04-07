import { useState, useEffect } from 'react';
import { apiFetch } from '../api.js';

/**
 * Left-column profile card shown in the lobby.
 * Displays the player's display name, Glicko-2 rating ± RD,
 * a rating history sparkline, and a sign-out button.
 */
export function ProfilePanel({ token, user, onLogout }) {
  const [rating, setRating]           = useState(null);
  const [ratingHistory, setRatingHistory] = useState([]);

  useEffect(() => {
    if (!token) return;
    apiFetch('/api/social/history/me/rating', { token })
      .then(setRating)
      .catch(() => {});
    apiFetch('/api/social/history/me/rating/history', { token })
      .then(setRatingHistory)
      .catch(() => {});
  }, [token]);

  const initial = (user?.display_name ?? user?.displayName ?? '?')[0].toUpperCase();
  const displayName = user?.display_name ?? user?.displayName ?? 'Player';

  return (
    <div style={s.panel}>
      {/* Avatar */}
      <div style={s.avatar}>{initial}</div>

      {/* Name */}
      <h2 style={s.name}>{displayName}</h2>
      <p style={s.email}>{user?.email ?? ''}</p>

      {/* Rating */}
      <div style={s.ratingCard}>
        <span style={s.ratingLabel}>Glicko-2 Rating</span>
        {rating ? (
          <>
            <span style={s.ratingValue}>{Math.round(Number(rating.rating))}</span>
            <span style={s.rdValue}>± {Math.round(Number(rating.rd))} RD</span>
          </>
        ) : (
          <span style={s.ratingValue}>—</span>
        )}

        {/* Sparkline — only shown once there are at least 2 data points */}
        {ratingHistory.length >= 2 && (
          <RatingSparkline data={ratingHistory} />
        )}
      </div>

      {/* Sign out */}
      <button style={s.logoutBtn} onClick={onLogout}>
        Sign out
      </button>
    </div>
  );
}

// ── Sparkline component ───────────────────────────────────────────────────────

function RatingSparkline({ data }) {
  const W = 200, H = 48, PAD = 4;

  const ratings = data.map((d) => Number(d.rating));
  const min = Math.min(...ratings);
  const max = Math.max(...ratings);
  const range = max - min || 1;

  const xs = data.map((_, i) => PAD + (i / (data.length - 1)) * (W - PAD * 2));
  const ys = ratings.map((r) => H - PAD - ((r - min) / range) * (H - PAD * 2));

  const polyline = xs.map((x, i) => `${x},${ys[i]}`).join(' ');

  const last = ratings[ratings.length - 1];
  const first = ratings[0];
  const trend = last >= first ? '#15803d' : '#b91c1c';

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      style={{ marginTop: '0.5rem', overflow: 'visible' }}
      aria-label="Rating history sparkline"
    >
      {/* Subtle area fill */}
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={trend} stopOpacity="0.18" />
          <stop offset="100%" stopColor={trend} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`${xs[0]},${H} ${polyline} ${xs[xs.length - 1]},${H}`}
        fill="url(#sparkGrad)"
      />
      {/* Line */}
      <polyline
        points={polyline}
        fill="none"
        stroke={trend}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* End dot */}
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="3" fill={trend} />
    </svg>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.75rem',
    padding: 'var(--space-8)',
    textAlign: 'center',
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: '50%',
    background: 'var(--primary-gradient)',
    color: 'var(--on-primary)',
    fontFamily: 'var(--font-display)',
    fontWeight: 800,
    fontSize: '1.75rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 16px rgba(0,90,183,0.25)',
  },
  name: {
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    fontSize: '1.25rem',
    color: 'var(--on-surface)',
    margin: 0,
  },
  email: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.7rem',
    color: 'var(--on-surface-muted)',
    margin: 0,
    letterSpacing: '0.02em',
  },
  ratingCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.25rem',
    background: 'var(--surface-high)',
    borderRadius: 'var(--radius-sm)',
    padding: '0.875rem 1.5rem',
    width: '100%',
    marginTop: '0.5rem',
  },
  ratingLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.65rem',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--on-surface-muted)',
  },
  ratingValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: '2rem',
    fontWeight: 700,
    color: 'var(--on-surface)',
    lineHeight: 1.1,
  },
  rdValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.75rem',
    color: 'var(--on-surface-muted)',
  },
  logoutBtn: {
    fontFamily: 'var(--font-body)',
    fontSize: '0.875rem',
    fontWeight: 500,
    padding: '0.375rem 0',
    border: 'none',
    background: 'none',
    color: 'var(--primary)',
    cursor: 'pointer',
    textDecoration: 'underline',
    textUnderlineOffset: 3,
    marginTop: '0.5rem',
  },
};

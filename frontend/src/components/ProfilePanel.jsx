import { useState, useEffect } from 'react';
import { apiFetch } from '../api.js';

/**
 * Left-column profile card shown in the lobby.
 * Displays the player's display name, Glicko-2 rating ± RD, and a sign-out button.
 */
export function ProfilePanel({ token, user, onLogout }) {
  const [rating, setRating] = useState(null);

  useEffect(() => {
    if (!token) return;
    apiFetch('/api/social/history/me/rating', { token })
      .then(setRating)
      .catch(() => {}); // silently ignore if ratings row doesn't exist yet
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
      </div>

      {/* Sign out */}
      <button style={s.logoutBtn} onClick={onLogout}>
        Sign out
      </button>
    </div>
  );
}

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

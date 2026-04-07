import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api.js';

/**
 * Friends panel:
 *  • Current friends list with ratings
 *  • Incoming pending requests (accept / reject)
 *  • Search-and-add by display name or email
 */
export function FriendsPanel({ token }) {
  const [friends, setFriends]     = useState([]);
  const [pending, setPending]     = useState([]);
  const [searchQ, setSearchQ]     = useState('');
  const [results, setResults]     = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [loading, setLoading]     = useState(true);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const [f, p] = await Promise.all([
        apiFetch('/api/social/friends', { token }),
        apiFetch('/api/social/friends/pending', { token }),
      ]);
      setFriends(f);
      setPending(p);
    } catch {
      /* silently ignore */
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleSearch(e) {
    e.preventDefault();
    if (searchQ.trim().length < 2) return;
    setSearching(true);
    setSearchErr('');
    setResults([]);
    try {
      const rows = await apiFetch(
        `/api/social/friends/search?q=${encodeURIComponent(searchQ.trim())}`,
        { token }
      );
      setResults(rows);
    } catch (err) {
      setSearchErr(err.message);
    } finally {
      setSearching(false);
    }
  }

  async function sendRequest(addresseeId, name) {
    try {
      await apiFetch('/api/social/friends/request', {
        method: 'POST',
        token,
        body: JSON.stringify({ addressee_id: addresseeId }),
      });
      flash(`Request sent to ${name}`);
      setResults((prev) => prev.filter((u) => u.id !== addresseeId));
    } catch (err) {
      flash(err.message);
    }
  }

  async function respondRequest(requesterId, action) {
    try {
      await apiFetch(`/api/social/friends/request/${requesterId}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ action }),
      });
      flash(action === 'accept' ? 'Friend added!' : 'Request declined');
      refresh();
    } catch (err) {
      flash(err.message);
    }
  }

  async function removeFriend(userId, name) {
    if (!confirm(`Remove ${name} from friends?`)) return;
    try {
      await apiFetch(`/api/social/friends/${userId}`, { method: 'DELETE', token });
      flash(`${name} removed`);
      setFriends((prev) => prev.filter((f) => f.id !== userId));
    } catch (err) {
      flash(err.message);
    }
  }

  function flash(msg) {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(''), 3000);
  }

  if (loading) return <p style={s.empty}>Loading…</p>;

  return (
    <div style={s.wrap}>

      {/* Flash message */}
      {actionMsg && <div style={s.flash}>{actionMsg}</div>}

      {/* Pending requests */}
      {pending.length > 0 && (
        <section>
          <h3 style={s.sectionTitle}>Pending requests</h3>
          {pending.map((u) => (
            <div key={u.id} style={s.row}>
              <div style={s.userInfo}>
                <span style={s.userName}>{u.display_name}</span>
                {u.rating != null && (
                  <span style={s.userRating}>{Math.round(Number(u.rating))}</span>
                )}
              </div>
              <div style={s.rowActions}>
                <button style={s.btnAccept} onClick={() => respondRequest(u.id, 'accept')}>Accept</button>
                <button style={s.btnReject} onClick={() => respondRequest(u.id, 'reject')}>Decline</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Friends list */}
      <section>
        <h3 style={s.sectionTitle}>
          {friends.length === 0 ? 'No friends yet' : `Friends (${friends.length})`}
        </h3>
        {friends.map((f) => (
          <div key={f.id} style={s.row}>
            <div style={s.userInfo}>
              <span style={s.userName}>{f.display_name}</span>
              {f.rating != null && (
                <span style={s.userRating}>{Math.round(Number(f.rating))}</span>
              )}
            </div>
            <button
              style={s.btnRemove}
              onClick={() => removeFriend(f.id, f.display_name)}
            >
              Remove
            </button>
          </div>
        ))}
      </section>

      {/* Search & add */}
      <section>
        <h3 style={s.sectionTitle}>Add a friend</h3>
        <form onSubmit={handleSearch} style={s.searchRow}>
          <input
            style={s.searchInput}
            placeholder="Search by name or email…"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
          />
          <button style={s.btnSearch} type="submit" disabled={searching}>
            {searching ? '…' : 'Search'}
          </button>
        </form>

        {searchErr && <p style={s.errMsg}>{searchErr}</p>}

        {results.map((u) => (
          <div key={u.id} style={s.row}>
            <div style={s.userInfo}>
              <span style={s.userName}>{u.display_name}</span>
              <span style={s.userEmail}>{u.email}</span>
            </div>
            <button
              style={s.btnAccept}
              onClick={() => sendRequest(u.id, u.display_name)}
            >
              Add
            </button>
          </div>
        ))}

        {results.length === 0 && searchQ.length >= 2 && !searching && !searchErr && (
          <p style={s.empty}>No users found matching "{searchQ}".</p>
        )}
      </section>
    </div>
  );
}

const s = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem',
  },
  empty: {
    fontFamily: 'var(--font-body)',
    fontSize: '0.875rem',
    color: 'var(--on-surface-muted)',
    margin: '0.5rem 0',
  },
  flash: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.8rem',
    background: '#dcfce7',
    color: '#15803d',
    borderRadius: 'var(--radius-sm)',
    padding: '0.5rem 0.75rem',
  },
  sectionTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: '0.875rem',
    fontWeight: 700,
    color: 'var(--on-surface-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    margin: '0 0 0.5rem 0',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
    padding: '0.625rem 0.75rem',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--surface-high)',
    marginBottom: '0.375rem',
  },
  userInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.1rem',
    minWidth: 0,
    flex: 1,
  },
  userName: {
    fontFamily: 'var(--font-body)',
    fontSize: '0.9375rem',
    fontWeight: 600,
    color: 'var(--on-surface)',
  },
  userRating: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.75rem',
    color: 'var(--primary)',
    fontWeight: 600,
  },
  userEmail: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.7rem',
    color: 'var(--on-surface-muted)',
  },
  rowActions: {
    display: 'flex',
    gap: '0.375rem',
  },
  btnAccept: {
    fontFamily: 'var(--font-body)',
    fontSize: '0.8125rem',
    fontWeight: 600,
    padding: '0.3rem 0.75rem',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    background: 'var(--primary-gradient)',
    color: 'var(--on-primary)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  btnReject: {
    fontFamily: 'var(--font-body)',
    fontSize: '0.8125rem',
    fontWeight: 500,
    padding: '0.3rem 0.75rem',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    background: 'var(--surface-low)',
    color: 'var(--on-surface-muted)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  btnRemove: {
    fontFamily: 'var(--font-body)',
    fontSize: '0.8125rem',
    fontWeight: 500,
    padding: '0.3rem 0.75rem',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    background: 'none',
    color: '#b91c1c',
    cursor: 'pointer',
    textDecoration: 'underline',
    textUnderlineOffset: 2,
  },
  searchRow: {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '0.5rem',
  },
  searchInput: {
    flex: 1,
    fontFamily: 'var(--font-body)',
    fontSize: '0.875rem',
    padding: '0.5rem 0.75rem',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    background: 'var(--surface-high)',
    color: 'var(--on-surface)',
  },
  btnSearch: {
    fontFamily: 'var(--font-display)',
    fontSize: '0.875rem',
    fontWeight: 700,
    padding: '0.5rem 1rem',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    background: 'var(--primary-gradient)',
    color: 'var(--on-primary)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  errMsg: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.8rem',
    color: '#b91c1c',
    margin: '0.25rem 0',
  },
};

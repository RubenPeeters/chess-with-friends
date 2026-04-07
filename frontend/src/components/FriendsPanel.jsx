import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api.js';

const TIME_CONTROLS = [
  { value: '1+0',   label: 'Bullet 1 min' },
  { value: '3+0',   label: 'Blitz 3 min' },
  { value: '3+2',   label: 'Blitz 3+2' },
  { value: '5+0',   label: 'Blitz 5 min' },
  { value: '10+0',  label: 'Rapid 10 min' },
  { value: '15+10', label: 'Rapid 15+10' },
  { value: '30+0',  label: 'Classical 30 min' },
];

/**
 * Friends panel:
 *  • Current friends list with ratings + inline challenge flow
 *  • Incoming pending requests (accept / reject)
 *  • Search-and-add by display name or email
 */
export function FriendsPanel({ token, onChallengeAccepted }) {
  const [friends, setFriends]     = useState([]);
  const [pending, setPending]     = useState([]);
  const [searchQ, setSearchQ]     = useState('');
  const [results, setResults]     = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [loading, setLoading]     = useState(true);

  // Challenge state: { friendId, friendName, timeControl, invite } | null
  const [challenge, setChallenge] = useState(null);
  const [challenging, setChallenging] = useState(false);

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

  // ── SSE: watch for challenge acceptance ──────────────────────────────────────
  useEffect(() => {
    if (!challenge?.invite || !token) return;

    const url = `/api/social/invites/${challenge.invite.token}/watch?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);

    es.addEventListener('accepted', (e) => {
      const data = JSON.parse(e.data);
      es.close();
      setChallenge(null);
      onChallengeAccepted?.(data);
    });

    es.onerror = () => es.close();
    return () => es.close();
  }, [challenge?.invite?.token, token, onChallengeAccepted]);

  async function openChallenge(friend) {
    setChallenge({ friendId: friend.id, friendName: friend.display_name, timeControl: '10+0', invite: null });
  }

  async function sendChallenge() {
    if (!challenge) return;
    setChallenging(true);
    try {
      const invite = await apiFetch('/api/social/invites', {
        method: 'POST',
        token,
        body: JSON.stringify({
          time_control: challenge.timeControl,
          colour: 'random',
          addressee_id: challenge.friendId,
        }),
      });
      setChallenge((prev) => ({ ...prev, invite }));
    } catch (err) {
      flash(err.message);
      setChallenge(null);
    } finally {
      setChallenging(false);
    }
  }

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

      {/* ── Challenge modal ── */}
      {challenge && (
        <div style={s.challengeBox}>
          {challenge.invite ? (
            /* Waiting for friend to accept */
            <>
              <span style={s.challengeTitle}>Challenge sent to {challenge.friendName}</span>
              <span style={s.challengeSub}>Waiting for them to accept…</span>
              <button style={s.btnReject} onClick={() => setChallenge(null)}>Cancel</button>
            </>
          ) : (
            /* Pick time control and send */
            <>
              <span style={s.challengeTitle}>Challenge {challenge.friendName}</span>
              <select
                style={s.select}
                value={challenge.timeControl}
                onChange={(e) => setChallenge((prev) => ({ ...prev, timeControl: e.target.value }))}
              >
                {TIME_CONTROLS.map((tc) => (
                  <option key={tc.value} value={tc.value}>{tc.label}</option>
                ))}
              </select>
              <div style={s.rowActions}>
                <button style={s.btnAccept} onClick={sendChallenge} disabled={challenging}>
                  {challenging ? 'Sending…' : 'Send challenge'}
                </button>
                <button style={s.btnReject} onClick={() => setChallenge(null)}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Pending requests ── */}
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

      {/* ── Friends list ── */}
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
            <div style={s.rowActions}>
              <button style={s.btnChallenge} onClick={() => openChallenge(f)}>
                Challenge
              </button>
              <button style={s.btnRemove} onClick={() => removeFriend(f.id, f.display_name)}>
                Remove
              </button>
            </div>
          </div>
        ))}
      </section>

      {/* ── Search & add ── */}
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
            <button style={s.btnAccept} onClick={() => sendRequest(u.id, u.display_name)}>
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

  challengeBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.625rem',
    background: 'var(--surface-lowest)',
    borderRadius: 'var(--radius-md)',
    padding: '1rem',
    boxShadow: 'var(--ambient-shadow-raised)',
  },
  challengeTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: '1rem',
    fontWeight: 700,
    color: 'var(--on-surface)',
  },
  challengeSub: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.75rem',
    color: 'var(--on-surface-muted)',
    letterSpacing: '0.02em',
  },
  select: {
    fontFamily: 'var(--font-body)',
    fontSize: '0.9375rem',
    padding: '0.5rem 0.75rem',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    background: 'var(--surface-high)',
    color: 'var(--on-surface)',
    width: '100%',
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
    alignItems: 'center',
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
  btnChallenge: {
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
